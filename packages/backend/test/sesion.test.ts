import request from 'supertest';
import { cerrar, login, lote, preparar, tsUnico, type Siembra } from './entorno.js';
import type { Servicios } from '../src/contenedor.js';
import { MotorAlertas } from '../src/services/motorAlertas.js';
import { PgAlertaRepo, PgMedicionRepo, PgOutbox } from '../src/adapters/pg/repositorios.js';
import { hashToken } from '../src/services/authService.js';

/**
 * D-31: la sesión sobrevive al refrescar (cookie httpOnly → JWT nuevo).
 * D-32: preferencia de correos de alerta crítica («todas», «solo urgentes», «ninguna»).
 */
let s: Servicios;
let app: Parameters<typeof request>[0];
let semilla: Siembra;
const api = () => request(app);

beforeAll(async () => {
  const e = await preparar();
  s = e.s;
  app = e.app;
  semilla = e.semilla;
});
afterAll(async () => cerrar(s));

/** Inicia sesión y devuelve el JWT y la cookie de sesión tal como la guarda el navegador. */
async function ingresar(email: string, password: string) {
  const r = await api().post('/api/v1/auth/login').send({ email, password });
  expect(r.status).toBe(200);
  const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('aq_sesion='));
  return { token: r.body.token as string, cookie: cookie!, valor: cookie!.split(';')[0], cuerpo: r.body };
}

describe('D-31 — sesión que sobrevive al refrescar', () => {
  test('login: cookie httpOnly, SameSite=Strict, limitada a /api/v1/auth; el token de sesión no va en el cuerpo', async () => {
    const i = await ingresar('supervisor@aquaplants.cl', semilla.passwords.supervisor);
    expect(i.cookie).toMatch(/HttpOnly/i);
    expect(i.cookie).toMatch(/SameSite=Strict/i);
    expect(i.cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(i.cookie).toMatch(/Expires=/);
    const sesion = i.valor.split('=')[1];
    expect(JSON.stringify(i.cuerpo)).not.toContain(sesion);
    // En la base solo está el resumen SHA-256.
    expect((await s.db.query(`SELECT 1 FROM sesion WHERE hash_token = $1`, [hashToken(sesion)])).rowCount).toBe(1);
    expect((await s.db.query(`SELECT 1 FROM sesion WHERE hash_token = $1`, [sesion])).rowCount).toBe(0);
  });

  test('refrescar: la cookie da un JWT nuevo que funciona, con el mismo vencimiento; sin cookie → 401', async () => {
    const i = await ingresar('encargado@aquaplants.cl', semilla.passwords.encargado);
    const r = await api().post('/api/v1/auth/sesion').set('cookie', i.valor);
    expect(r.status).toBe(200);
    expect(r.body.token).not.toBe(i.token);
    expect(r.body.expira_en).toBe(i.cuerpo.expira_en);
    expect(r.body.usuario).toMatchObject({ email: 'encargado@aquaplants.cl', rol: 'encargado', aviso_alertas: 'todas' });
    expect((await api().get('/api/v1/auth/me').set('authorization', `Bearer ${r.body.token}`)).status).toBe(200);

    expect((await api().post('/api/v1/auth/sesion')).status).toBe(401);
    expect((await api().post('/api/v1/auth/sesion').set('cookie', 'aq_sesion=' + 'x'.repeat(43))).status).toBe(401);
    expect((await api().post('/api/v1/auth/sesion').set('cookie', 'aq_sesion=corto')).status).toBe(401);
  });

  test('cerrar sesión revoca la cookie; cambiar la contraseña invalida las demás sesiones', async () => {
    const a = await ingresar('encargado2@aquaplants.cl', semilla.passwords.encargado);
    const salir = await api().post('/api/v1/auth/logout').set('authorization', `Bearer ${a.token}`).set('cookie', a.valor);
    expect(salir.status).toBe(204);
    expect(([] as string[]).concat(salir.headers['set-cookie'] ?? []).some((c) => /^aq_sesion=;/.test(c))).toBe(true);
    expect((await api().post('/api/v1/auth/sesion').set('cookie', a.valor)).status).toBe(401);

    const b = await ingresar('encargado2@aquaplants.cl', semilla.passwords.encargado);
    const nueva = 'OtraClave2026xyz';
    expect(
      (await api().post('/api/v1/auth/cambiar-password').set('authorization', `Bearer ${b.token}`).send({ actual: semilla.passwords.encargado, nueva })).status,
    ).toBe(200);
    expect((await api().post('/api/v1/auth/sesion').set('cookie', b.valor)).status).toBe(401);
    // Se deja como estaba para el resto de las pruebas.
    const c = await ingresar('encargado2@aquaplants.cl', nueva);
    await api().post('/api/v1/auth/cambiar-password').set('authorization', `Bearer ${c.token}`).send({ actual: nueva, nueva: semilla.passwords.encargado });
  });

  test('sesión vencida → 401; las vencidas hace más de un día se purgan', async () => {
    const i = await ingresar('supervisor@aquaplants.cl', semilla.passwords.supervisor);
    const h = hashToken(i.valor.split('=')[1]);
    await s.db.query(`UPDATE sesion SET creada_en = now() - interval '3 days', expira_en = now() - interval '2 days' WHERE hash_token = $1`, [h]);
    expect((await api().post('/api/v1/auth/sesion').set('cookie', i.valor)).status).toBe(401);
    expect(await s.mantenimiento.purgarSesionesVencidas()).toBeGreaterThanOrEqual(1);
    expect((await s.db.query(`SELECT 1 FROM sesion WHERE hash_token = $1`, [h])).rowCount).toBe(0);
  });
});

describe('D-32 — preferencia de avisos por correo', () => {
  test('cada usuario elige la suya; «ninguna» solo para Administrador; queda auditado', async () => {
    const enc = await login(app, 'encargado@aquaplants.cl', semilla.passwords.encargado);
    const admin = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
    expect((await api().get('/api/v1/auth/me').set('authorization', `Bearer ${admin}`)).body.aviso_alertas).toBe('ninguna');

    expect((await api().patch('/api/v1/auth/avisos').set('authorization', `Bearer ${enc}`).send({ aviso_alertas: 'ninguna' })).status).toBe(422);
    expect((await api().patch('/api/v1/auth/avisos').set('authorization', `Bearer ${enc}`).send({ aviso_alertas: 'otra' })).status).toBe(422);
    const r = await api().patch('/api/v1/auth/avisos').set('authorization', `Bearer ${enc}`).send({ aviso_alertas: 'urgentes' });
    expect(r.status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set('authorization', `Bearer ${enc}`)).body.aviso_alertas).toBe('urgentes');
    const aud = await s.db.query<{ detalle: unknown }>(`SELECT detalle FROM log_auditoria WHERE accion = 'cambiar_avisos' ORDER BY id_log DESC LIMIT 1`);
    expect(aud.rows[0].detalle).toEqual({ anterior: 'todas', nuevo: 'urgentes' });

    expect((await api().patch('/api/v1/auth/avisos').set('authorization', `Bearer ${admin}`).send({ aviso_alertas: 'todas' })).status).toBe(200);
    expect((await api().patch('/api/v1/auth/avisos').send({ aviso_alertas: 'todas' })).status).toBe(401);
  });

  test('alerta crítica: al momento solo a «todas»; tras ALERTA_URGENTE_MIN, una vez a «solo urgentes»', async () => {
    // Estado tras la prueba anterior: encargado (torres A y B) = urgentes; admin = todas;
    // supervisor = todas; encargado2 (torre C) = todas.
    const enviados: { destinatarios: string[]; asunto: string }[] = [];
    const motor = new MotorAlertas(s.db, new PgMedicionRepo(), new PgAlertaRepo(), new PgOutbox(s.db), {
      configurado: true,
      enviar: async (m) => void enviados.push(m),
    }, 30);
    const devA = semilla.dispositivos[0]; // Torre A
    const idS = devA.sensores.find((x) => x.clave === 'ce')!.id_sensor; // crítica fuera de 0.4–1.6
    const r = await api().post('/api/v1/telemetria').set('authorization', `Bearer ${devA.token}`).send(lote(devA.id_dispositivo, [{ id_sensor: idS, valor: 2.5, ts: tsUnico() }]));
    expect(r.status).toBe(201);
    await motor.procesarPendientes(100);
    await motor.procesarNotificaciones();
    const inmediato = enviados.find((m) => /CRÍTICA/.test(m.asunto))!;
    expect(inmediato.destinatarios.sort()).toEqual(['admin@aquaplants.cl', 'supervisor@aquaplants.cl']);

    // Aún no es urgente.
    expect(await motor.procesarUrgentes()).toBe(0);
    await s.db.query(`UPDATE alerta SET fecha_generacion = now() - interval '31 minutes' WHERE id_sensor = $1 AND estado = 'activa'`, [idS]);
    expect(await motor.procesarUrgentes()).toBe(1);
    const urgente = enviados.find((m) => /URGENTE/.test(m.asunto))!;
    expect(urgente.destinatarios).toEqual(['encargado@aquaplants.cl']);
    // Un solo aviso urgente por alerta.
    expect(await motor.procesarUrgentes()).toBe(0);
  });

  test('si todos eligieron «solo urgentes», la alerta queda «sin_destinatarios» al momento', async () => {
    for (const [email, pass] of [
      ['admin@aquaplants.cl', semilla.passwords.administrador],
      ['supervisor@aquaplants.cl', semilla.passwords.supervisor],
    ]) {
      const t = await login(app, email, pass);
      await api().patch('/api/v1/auth/avisos').set('authorization', `Bearer ${t}`).send({ aviso_alertas: email.startsWith('admin') ? 'ninguna' : 'urgentes' });
    }
    const motor = new MotorAlertas(s.db, new PgMedicionRepo(), new PgAlertaRepo(), new PgOutbox(s.db), { configurado: true, enviar: async () => undefined }, 30);
    const devA = semilla.dispositivos[0];
    const idS = devA.sensores.find((x) => x.clave === 'ph')!.id_sensor;
    await api().post('/api/v1/telemetria').set('authorization', `Bearer ${devA.token}`).send(lote(devA.id_dispositivo, [{ id_sensor: idS, valor: 1.0, ts: tsUnico() }]));
    await motor.procesarPendientes(100);
    await motor.procesarNotificaciones();
    const a = await s.db.query<{ notificacion_estado: string }>(`SELECT notificacion_estado FROM alerta WHERE id_sensor = $1 AND estado = 'activa'`, [idS]);
    expect(a.rows[0].notificacion_estado).toBe('sin_destinatarios');
  });
});
