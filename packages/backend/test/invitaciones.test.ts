import request from 'supertest';
import { cerrar, login, preparar, type Siembra } from './entorno.js';
import type { Servicios } from '../src/contenedor.js';

/**
 * D-28: registro mediante enlace de invitación por torre (amplía CU-09).
 */
let s: Servicios;
let app: Parameters<typeof request>[0];
let semilla: Siembra;
let admin: string;
const api = () => request(app);

beforeAll(async () => {
  const e = await preparar({ APP_URL: 'https://aquaplants.test' });
  s = e.s;
  app = e.app;
  semilla = e.semilla;
  admin = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
});
afterAll(async () => {
  await cerrar(s);
});

const fragmento = (url: string, clave: string) => new URLSearchParams(url.split('#')[1]).get(clave)!;

async function crearInvitacion(body: Record<string, unknown>) {
  const r = await api().post('/api/v1/invitaciones').set('authorization', `Bearer ${admin}`).send(body);
  expect(r.status).toBe(201);
  return { id: r.body.id_invitacion as number, token: fragmento(r.body.enlace, 'invitacion'), enlace: r.body.enlace as string };
}

/** Token de confirmación tomado del correo programado (como lo recibiría la persona). */
async function tokenConfirmacion(email: string) {
  const r = await s.db.query<{ texto: string }>(
    `SELECT texto FROM notificacion_correo WHERE tipo = 'confirmar_registro' AND destinatario = $1 ORDER BY id_notificacion DESC LIMIT 1`,
    [email],
  );
  const m = /confirmar-registro#token=([A-Za-z0-9_-]{43})/.exec(r.rows[0]?.texto ?? '');
  if (!m) throw new Error(`sin correo de confirmación para ${email}`);
  return m[1];
}

describe('D-28 — enlaces de invitación', () => {
  test('solo el Administrador crea, lista y anula enlaces (Tabla 48)', async () => {
    const sup = await login(app, 'supervisor@aquaplants.cl', semilla.passwords.supervisor);
    const enc = await login(app, 'encargado@aquaplants.cl', semilla.passwords.encargado);
    for (const t of [sup, enc]) {
      expect((await api().post('/api/v1/invitaciones').set('authorization', `Bearer ${t}`).send({ torres: [semilla.torres[0]] })).status).toBe(403);
      expect((await api().get('/api/v1/invitaciones').set('authorization', `Bearer ${t}`)).status).toBe(403);
    }
    expect((await api().post('/api/v1/invitaciones').set('authorization', `Bearer ${admin}`).send({ torres: [] })).status).toBe(422);
    expect((await api().post('/api/v1/invitaciones').set('authorization', `Bearer ${admin}`).send({ torres: [999999] })).status).toBe(422);
    // El cuerpo no permite elegir rol: un enlace nunca otorga más que Encargado.
    const r = await api().post('/api/v1/invitaciones').set('authorization', `Bearer ${admin}`).send({ torres: [semilla.torres[0]], rol: 'administrador' });
    expect(r.status).toBe(201);
    expect(r.body.rol).toBe('encargado');
    expect(r.body.enlace).toMatch(/^https:\/\/aquaplants\.test\/registro#invitacion=[A-Za-z0-9_-]{43}$/);
  });

  test('flujo completo: consultar → registrarse → confirmar email → Encargado de esas torres', async () => {
    const inv = await crearInvitacion({ torres: [semilla.torres[0], semilla.torres[2]], dias: 7, max_usos: 5, descripcion: 'Turno mañana' });
    // Solo se guarda el resumen del token.
    const h = await s.db.query<{ hash_token: string }>(`SELECT hash_token FROM invitacion WHERE id_invitacion = $1`, [inv.id]);
    expect(h.rows[0].hash_token).not.toBe(inv.token);

    const info = await api().post('/api/v1/auth/invitacion').send({ token: inv.token });
    expect(info.status).toBe(200);
    expect(info.body.torres).toHaveLength(2);
    expect(info.body.rol).toBe('encargado');

    const email = 'nueva.persona@aquaplants.cl';
    const reg = await api().post('/api/v1/auth/registro').send({ token: inv.token, nombre: 'Nueva Persona', email: email.toUpperCase(), password: 'Huerto2026abc' });
    expect(reg.status).toBe(202);
    // Aún no existe la cuenta: no se puede iniciar sesión sin confirmar el email.
    expect((await api().post('/api/v1/auth/login').send({ email, password: 'Huerto2026abc' })).status).toBe(401);

    const conf = await tokenConfirmacion(email);
    const ok = await api().post('/api/v1/auth/registro/confirmar').send({ token: conf });
    expect(ok.status).toBe(201);
    // Un solo uso.
    expect((await api().post('/api/v1/auth/registro/confirmar').send({ token: conf })).status).toBe(422);

    const t = await login(app, email, 'Huerto2026abc');
    const me = await api().get('/api/v1/auth/me').set('authorization', `Bearer ${t}`);
    expect(me.body).toMatchObject({ rol: 'encargado', debe_cambiar_password: false, nombre: 'Nueva Persona' });
    const torres = await s.db.query<{ id_instalacion: number }>(`SELECT id_instalacion FROM usuario_instalacion WHERE id_usuario = $1 ORDER BY 1`, [me.body.id_usuario]);
    expect(torres.rows.map((x) => x.id_instalacion)).toEqual([semilla.torres[0], semilla.torres[2]].sort((a, b) => a - b));
    // RN-10: el nuevo Encargado no ve la torre que no está en la invitación.
    expect((await api().get(`/api/v1/torres/${semilla.torres[1]}/estado`).set('authorization', `Bearer ${t}`)).status).toBe(403);

    const lista = await api().get('/api/v1/invitaciones').set('authorization', `Bearer ${admin}`);
    expect(lista.body.find((x: { id_invitacion: number }) => x.id_invitacion === inv.id)).toMatchObject({ usos: 1, estado: 'vigente', descripcion: 'Turno mañana' });
    // Auditoría sin datos personales y hash de la contraseña borrado de la solicitud.
    const aud = await s.db.query<{ detalle: Record<string, unknown> }>(`SELECT detalle FROM log_auditoria WHERE accion = 'registro_por_invitacion' AND id_entidad = $1`, [String(me.body.id_usuario)]);
    expect(JSON.stringify(aud.rows[0].detalle)).not.toContain(email);
    const p = await s.db.query(`SELECT 1 FROM registro_pendiente WHERE lower(email) = $1 AND hash_password IS NULL AND id_usuario = $2`, [email, me.body.id_usuario]);
    expect(p.rowCount).toBe(1);
    // El texto del correo (con el enlace) se borra tras el envío.
    await s.correosCuenta.procesarPendientes(50);
    const n = await s.db.query<{ texto: string; id_usuario: number }>(`SELECT texto, id_usuario FROM notificacion_correo WHERE tipo = 'confirmar_registro' AND destinatario = $1`, [email]);
    expect(n.rows[0].texto).not.toContain('#token=');
    expect(n.rows[0].id_usuario).toBe(me.body.id_usuario);
  });

  test('email ya registrado: misma respuesta, no se crea otra cuenta y se avisa al titular', async () => {
    const inv = await crearInvitacion({ torres: [semilla.torres[1]] });
    const r = await api().post('/api/v1/auth/registro').send({ token: inv.token, nombre: 'Impostor', email: 'admin@aquaplants.cl', password: 'Huerto2026abc' });
    expect(r.status).toBe(202);
    expect((await s.db.query(`SELECT 1 FROM registro_pendiente WHERE email = 'admin@aquaplants.cl'`)).rowCount).toBe(0);
    expect((await s.db.query(`SELECT 1 FROM notificacion_correo WHERE tipo = 'cuenta_existente' AND destinatario = 'admin@aquaplants.cl'`)).rowCount).toBe(1);
    // Repetir no llena la bandeja del titular.
    await api().post('/api/v1/auth/registro').send({ token: inv.token, nombre: 'Impostor', email: 'admin@aquaplants.cl', password: 'Huerto2026abc' });
    expect((await s.db.query(`SELECT 1 FROM notificacion_correo WHERE tipo = 'cuenta_existente' AND destinatario = 'admin@aquaplants.cl'`)).rowCount).toBe(1);
  });

  test('cupo, anulación, vencimiento y enlaces inválidos', async () => {
    const inv = await crearInvitacion({ torres: [semilla.torres[1]], max_usos: 1 });
    for (const [i, email] of ['cupo.uno@aquaplants.cl', 'cupo.dos@aquaplants.cl'].entries()) {
      expect((await api().post('/api/v1/auth/registro').send({ token: inv.token, nombre: `Cupo ${i}`, email, password: 'Huerto2026abc' })).status).toBe(202);
    }
    const t1 = await tokenConfirmacion('cupo.uno@aquaplants.cl');
    const t2 = await tokenConfirmacion('cupo.dos@aquaplants.cl');
    expect((await api().post('/api/v1/auth/registro/confirmar').send({ token: t1 })).status).toBe(201);
    // Cupo lleno: la segunda solicitud ya no crea cuenta y el enlace deja de funcionar.
    const lleno = await api().post('/api/v1/auth/registro/confirmar').send({ token: t2 });
    expect(lleno.status).toBe(422);
    expect(lleno.body.codigo).toBe('INVITACION_NO_DISPONIBLE');
    expect((await api().post('/api/v1/auth/invitacion').send({ token: inv.token })).status).toBe(422);

    const anulada = await crearInvitacion({ torres: [semilla.torres[1]] });
    expect((await api().patch(`/api/v1/invitaciones/${anulada.id}/anular`).set('authorization', `Bearer ${admin}`)).status).toBe(200);
    expect((await api().post('/api/v1/auth/registro').send({ token: anulada.token, nombre: 'X', email: 'anulada@aquaplants.cl', password: 'Huerto2026abc' })).status).toBe(422);
    const aud = await s.db.query(`SELECT 1 FROM log_auditoria WHERE accion = 'anular_invitacion' AND id_entidad = $1`, [String(anulada.id)]);
    expect(aud.rowCount).toBe(1);

    const vencida = await crearInvitacion({ torres: [semilla.torres[1]] });
    await s.db.query(`UPDATE invitacion SET creada_en = now() - interval '9 days', vence_en = now() - interval '1 day' WHERE id_invitacion = $1`, [vencida.id]);
    expect((await api().post('/api/v1/auth/invitacion').send({ token: vencida.token })).status).toBe(422);

    expect((await api().post('/api/v1/auth/invitacion').send({ token: 'x'.repeat(43) })).status).toBe(422);
    expect((await api().post('/api/v1/auth/invitacion').send({ token: 'corto' })).status).toBe(422);
    // La política de contraseñas también rige aquí.
    const otra = await crearInvitacion({ torres: [semilla.torres[1]] });
    expect((await api().post('/api/v1/auth/registro').send({ token: otra.token, nombre: 'Débil', email: 'debil@aquaplants.cl', password: 'corta' })).status).toBe(422);
  });

  test('las solicitudes no confirmadas se borran un día después de vencer (minimización)', async () => {
    const inv = await crearInvitacion({ torres: [semilla.torres[0]] });
    const email = 'nunca.confirma@aquaplants.cl';
    await api().post('/api/v1/auth/registro').send({ token: inv.token, nombre: 'Nunca Confirma', email, password: 'Huerto2026abc' });
    await s.correosCuenta.procesarPendientes(50);
    await s.db.query(`UPDATE registro_pendiente SET expira_en = now() - interval '2 days' WHERE email = $1`, [email]);
    expect(await s.mantenimiento.purgarRegistrosVencidos()).toBeGreaterThanOrEqual(1);
    expect((await s.db.query(`SELECT 1 FROM registro_pendiente WHERE email = $1`, [email])).rowCount).toBe(0);
    expect((await s.db.query(`SELECT 1 FROM notificacion_correo WHERE destinatario = $1`, [email])).rowCount).toBe(0);
  });
});
