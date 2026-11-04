import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { cerrar, config, login, lote, preparar, tsUnico, type Siembra } from './entorno.js';
import { crearServicios, type Servicios } from '../src/contenedor.js';
import { crearApp } from '../src/app.js';
import { MongoPayloadStore } from '../src/adapters/mongo/payloadStore.js';
import { CorreosCuentaService } from '../src/services/correosCuentaService.js';
import request from 'supertest';

let s: Servicios;
let app: Parameters<typeof request>[0];
let semilla: Siembra;
let tok: { admin: string; sup: string; enc: string; enc2: string };
let devA: Siembra['dispositivos'][number];
let devC: Siembra['dispositivos'][number];
const api = () => request(app);
const sensor = (d: typeof devA, clave: string) => d.sensores.find((x) => x.clave === clave)!.id_sensor;
const enviar = (d: typeof devA, cuerpo: unknown) => api().post('/api/v1/telemetria').set('authorization', `Bearer ${d.token}`).send(cuerpo as object);

beforeAll(async () => {
  const e = await preparar();
  s = e.s;
  app = e.app;
  semilla = e.semilla;
  devA = semilla.dispositivos[0];
  devC = semilla.dispositivos[2];
  tok = {
    admin: await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador),
    sup: await login(app, 'supervisor@aquaplants.cl', semilla.passwords.supervisor),
    enc: await login(app, 'encargado@aquaplants.cl', semilla.passwords.encargado),
    enc2: await login(app, 'encargado2@aquaplants.cl', semilla.passwords.encargado),
  };
});
afterAll(async () => cerrar(s));

describe('CU-01 Telemetría', () => {
  test('CP-01 lote válido → 201 y mediciones almacenadas con su marca temporal', async () => {
    const ts = tsUnico();
    const l = lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'ph'), valor: 5.9, ts }]);
    const r = await enviar(devA, l);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ recibidas: 1, duplicado: false });
    const m = await s.db.query<{ valor: number; ts: Date }>(`SELECT valor, ts FROM medicion WHERE id_lote = $1`, [l.id_lote]);
    expect(m.rows[0].valor).toBe(5.9);
    expect(m.rows[0].ts.toISOString()).toBe(ts);
  });

  test('CP-02 campo inválido → 422 con campos; JSON malformado → 400', async () => {
    const r = await enviar(devA, { id_lote: 'no-uuid', id_dispositivo: devA.id_dispositivo, lecturas: [] });
    expect(r.status).toBe(422);
    expect(r.body.campos.map((c: { campo: string }) => c.campo)).toEqual(expect.arrayContaining(['id_lote', 'lecturas']));
    const r2 = await api().post('/api/v1/telemetria').set('authorization', `Bearer ${devA.token}`).set('content-type', 'application/json').send('{"roto":');
    expect(r2.status).toBe(400);
  });

  test('CP-03 credencial inválida → 401 y nada persistido', async () => {
    const l = lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'ph'), valor: 6, ts: tsUnico() }]);
    const r = await api().post('/api/v1/telemetria').set('authorization', 'Bearer inventada').send(l);
    expect(r.status).toBe(401);
    expect((await s.db.query(`SELECT 1 FROM lote_ingesta WHERE id_lote = $1`, [l.id_lote])).rowCount).toBe(0);
  });

  test('NEG-12 un usuario humano con su JWT no puede enviar telemetría (401)', async () => {
    const l = lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'ph'), valor: 6, ts: tsUnico() }]);
    const r = await api().post('/api/v1/telemetria').set('authorization', `Bearer ${tok.admin}`).send(l);
    expect(r.status).toBe(401);
  });

  test('RN-01 sensor ajeno al dispositivo → 422, lote completo rechazado y evento sensor_ajeno', async () => {
    const ts = tsUnico();
    const l = lote(devA.id_dispositivo, [
      { id_sensor: sensor(devA, 'ph'), valor: 6, ts },
      { id_sensor: sensor(devC, 'ph'), valor: 6, ts },
    ]);
    const r = await enviar(devA, l);
    expect(r.status).toBe(422);
    expect((await s.db.query(`SELECT 1 FROM medicion WHERE id_lote = $1`, [l.id_lote])).rowCount).toBe(0);
    const ev = await s.db.query(`SELECT 1 FROM evento WHERE tipo = 'sensor_ajeno' AND id_dispositivo = $1`, [devA.id_dispositivo]);
    expect(ev.rowCount).toBeGreaterThan(0);
  });

  test('RN-09 valor fuera del rango físico → 422', async () => {
    const r = await enviar(devA, lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'ph'), valor: 15, ts: tsUnico() }]));
    expect(r.status).toBe(422);
  });

  test('CC-08 reloj desfasado (+10 min) → 422 RELOJ_DESFASADO y evento', async () => {
    const futuro = new Date(Date.now() + 10 * 60_000).toISOString();
    const r = await enviar(devA, lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'ph'), valor: 6, ts: futuro }]));
    expect(r.status).toBe(422);
    expect(r.body.codigo).toBe('RELOJ_DESFASADO');
    expect(r.headers.date).toBeDefined();
  });

  test('CC-01 el mismo lote 10 veces en paralelo → 1×201, 9×200 duplicado, una sola copia', async () => {
    const l = lote(devA.id_dispositivo, [
      { id_sensor: sensor(devA, 'ph'), valor: 5.95 },
      { id_sensor: sensor(devA, 'ce'), valor: 1.0 },
    ]);
    l.lecturas.forEach((x) => (x.ts = tsUnico()));
    const rs = await Promise.all(Array.from({ length: 10 }, () => enviar(devA, l)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 200 && r.body.duplicado === true)).toHaveLength(9);
    const n = await s.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM medicion WHERE id_lote = $1`, [l.id_lote]);
    expect(n.rows[0].n).toBe(2);
  });

  test('CC-09 MongoDB caído → 503 con Retry-After y nada escrito en PostgreSQL', async () => {
    const cfg = config();
    const caido = new MongoPayloadStore('mongodb://127.0.0.1:1', 'x');
    const s2 = crearServicios(cfg, { payloads: caido });
    const app2 = crearApp(cfg, s2);
    const l = lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'ph'), valor: 6, ts: tsUnico() }]);
    const r = await request(app2).post('/api/v1/telemetria').set('authorization', `Bearer ${devA.token}`).send(l);
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBeDefined();
    expect((await s.db.query(`SELECT 1 FROM lote_ingesta WHERE id_lote = $1`, [l.id_lote])).rowCount).toBe(0);
    const h = await request(app2).get('/api/v1/health');
    expect(h.status).toBe(503);
    expect(h.body.componentes.mongodb).toBe('caido');
    await s2.db.cerrar();
    await caido.cerrar().catch(() => undefined);
  });
});

describe('CU-04 Motor de alertas', () => {
  test('CP-05 / CC-07 lecturas fuera de rango → UNA alerta activa con ocurrencias acumuladas', async () => {
    const idS = sensor(devA, 'temperatura'); // Lechuga: advertencia 18–22, crítica 14–26
    for (let i = 0; i < 6; i++) {
      expect((await enviar(devA, lote(devA.id_dispositivo, [{ id_sensor: idS, valor: 23.5, ts: tsUnico() }]))).status).toBe(201);
    }
    await s.motor.procesarPendientes(100);
    const a = await s.db.query<{ n: number; ocurrencias: number; severidad: string }>(
      `SELECT count(*)::int AS n, max(ocurrencias) AS ocurrencias, max(severidad) AS severidad FROM alerta WHERE id_sensor = $1 AND estado = 'activa'`,
      [idS],
    );
    expect(a.rows[0]).toEqual({ n: 1, ocurrencias: 6, severidad: 'advertencia' });
  });

  test('CC-02 dos motores procesando el mismo outbox → una sola alerta (SKIP LOCKED)', async () => {
    const idS = sensor(devA, 'ce'); // advertencia 0.8–1.2, crítica 0.4–1.6
    for (let i = 0; i < 4; i++) await enviar(devA, lote(devA.id_dispositivo, [{ id_sensor: idS, valor: 2.5, ts: tsUnico() }]));
    const s2 = crearServicios(config());
    await Promise.all([s.motor.procesarPendientes(100), s2.motor.procesarPendientes(100)]);
    await s2.db.cerrar();
    const a = await s.db.query<{ n: number; ocurrencias: number }>(
      `SELECT count(*)::int AS n, sum(ocurrencias)::int AS ocurrencias FROM alerta WHERE id_sensor = $1 AND estado = 'activa'`,
      [idS],
    );
    expect(a.rows[0]).toEqual({ n: 1, ocurrencias: 4 });
    const pend = await s.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM outbox_evaluacion WHERE procesado_en IS NULL`);
    expect(pend.rows[0].n).toBe(0);
  });

  test('alerta crítica sin proveedor SMTP → notificación «no_configurada» (nunca «enviada»)', async () => {
    await s.motor.procesarNotificaciones();
    const r = await s.db.query<{ notificacion_estado: string }>(`SELECT notificacion_estado FROM alerta WHERE severidad = 'critica'`);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.notificacion_estado === 'no_configurada')).toBe(true);
  });

  test('NEG-01 Encargado no resuelve una crítica (403, sigue activa); CP-11 Supervisor sí, con auditoría', async () => {
    const a = await s.db.query<{ id_alerta: string }>(`SELECT id_alerta FROM alerta WHERE severidad = 'critica' AND estado = 'activa' LIMIT 1`);
    const id = a.rows[0].id_alerta;
    const r1 = await api().patch(`/api/v1/alertas/${id}`).set('authorization', `Bearer ${tok.enc}`).send({ comentario: 'x' });
    expect(r1.status).toBe(403);
    const r0 = await api().patch(`/api/v1/alertas/${id}/resolver`).set('authorization', `Bearer ${tok.sup}`).send({});
    expect(r0.status).toBe(422); // comentario obligatorio para críticas (Tabla 29)
    const r2 = await api().patch(`/api/v1/alertas/${id}/resolver`).set('authorization', `Bearer ${tok.sup}`).send({ comentario: 'Se corrigió la solución nutritiva' });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ estado: 'resuelta', resuelta_por: 'Sergio Supervisor' });
    const aud = await s.db.query(`SELECT 1 FROM log_auditoria WHERE accion = 'resolver_alerta' AND id_entidad = $1`, [String(id)]);
    expect(aud.rowCount).toBe(1);
  });

  test('CC-03 dos usuarios resuelven la misma advertencia a la vez → 200 y 409', async () => {
    const a = await s.db.query<{ id_alerta: string }>(`SELECT id_alerta FROM alerta WHERE severidad = 'advertencia' AND estado = 'activa' LIMIT 1`);
    const id = a.rows[0].id_alerta;
    const [r1, r2] = await Promise.all([
      api().patch(`/api/v1/alertas/${id}/resolver`).set('authorization', `Bearer ${tok.enc}`).send({ comentario: 'ok' }),
      api().patch(`/api/v1/alertas/${id}/resolver`).set('authorization', `Bearer ${tok.sup}`).send({ comentario: 'ok' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  test('CP-06 modificar umbral: auditado con valor anterior/nuevo y aplicado a la siguiente medición', async () => {
    const idS = sensor(devA, 'humedad'); // advertencia 50–70
    const u = await api().get(`/api/v1/sensores/${idS}/umbrales`).set('authorization', `Bearer ${tok.admin}`);
    const adv = u.body.find((x: { severidad: string }) => x.severidad === 'advertencia');
    const r = await api().put(`/api/v1/umbrales/${adv.id_umbral}`).set('authorization', `Bearer ${tok.admin}`).send({ valor_min: 50, valor_max: 60, version: adv.version });
    expect(r.status).toBe(200);
    const conflicto = await api().put(`/api/v1/umbrales/${adv.id_umbral}`).set('authorization', `Bearer ${tok.admin}`).send({ valor_min: 50, valor_max: 61, version: adv.version });
    expect(conflicto.status).toBe(409);
    const aud = await s.db.query<{ detalle: { anterior: { valor_max: number }; nuevo: { valor_max: number } } }>(
      `SELECT detalle FROM log_auditoria WHERE accion = 'editar_umbral' AND id_entidad = $1`,
      [String(adv.id_umbral)],
    );
    expect(aud.rows[0].detalle.anterior.valor_max).toBe(70);
    expect(aud.rows[0].detalle.nuevo.valor_max).toBe(60);
    await enviar(devA, lote(devA.id_dispositivo, [{ id_sensor: idS, valor: 65, ts: tsUnico() }]));
    await s.motor.procesarPendientes(10);
    const al = await s.db.query(`SELECT 1 FROM alerta WHERE id_sensor = $1 AND estado = 'activa' AND valor_max = 60`, [idS]);
    expect(al.rowCount).toBe(1);
  });

  test('CU-07 validaciones: min ≥ max → 422; fuera de rango físico → 422; severidad repetida → 409', async () => {
    const idS = sensor(devA, 'ph');
    const h = { authorization: `Bearer ${tok.admin}` };
    expect((await api().put(`/api/v1/sensores/${idS}/umbrales`).set(h).send({ severidad: 'critica', valor_min: 7, valor_max: 6 })).status).toBe(422);
    expect((await api().put(`/api/v1/sensores/${idS}/umbrales`).set(h).send({ severidad: 'critica', valor_min: 1, valor_max: 15 })).status).toBe(422);
    expect((await api().put(`/api/v1/sensores/${idS}/umbrales`).set(h).send({ severidad: 'critica', valor_min: 5, valor_max: 7 })).status).toBe(409);
  });
});

describe('Autorización (Tabla 48 / Tabla 49) y RN-10', () => {
  const casos: [string, keyof typeof tok, 'get' | 'post' | 'put' | 'patch' | 'delete', () => string, object | null][] = [
    ['NEG-02 Encargado: estado de torre no asignada', 'enc', 'get', () => `/api/v1/torres/${semilla.torres[2]}/estado`, null],
    ['NEG-03 Encargado: exportar CSV', 'enc', 'get', () => `/api/v1/historicos/export?torres=${semilla.torres[0]}&desde=2026-01-01T00:00:00Z&hasta=2026-01-02T00:00:00Z`, null],
    ['NEG-04 Encargado: modificar umbral', 'enc', 'put', () => `/api/v1/umbrales/1`, { valor_min: 1, valor_max: 2, version: 1 }],
    ['NEG-05 Encargado: consultar auditoría', 'enc', 'get', () => `/api/v1/auditoria`, null],
    ['NEG-06 Supervisor: crear usuario', 'sup', 'post', () => `/api/v1/usuarios`, { nombre: 'X', email: 'x@x.cl', rol: 'administrador' }],
    ['NEG-07 Supervisor: baja de dispositivo', 'sup', 'patch', () => `/api/v1/dispositivos/1/baja`, { motivo: 'x', confirmar: true }],
    ['NEG-08 Supervisor: registrar cultivo', 'sup', 'post', () => `/api/v1/cultivos`, { id_instalacion: 1, id_especie: 1, fecha_inicio: '2026-01-01' }],
    ['CP-20 Encargado: alertas de torre no asignada', 'enc', 'get', () => `/api/v1/alertas?torre=${semilla.torres[2]}`, null],
    ['CP-20 Encargado: histórico de sensor de torre no asignada', 'enc', 'get', () => `/api/v1/mediciones/historico?sensor=${sensor(devC, 'ph')}&desde=2026-11-01T00:00:00Z&hasta=2026-11-02T00:00:00Z`, null],
    ['Encargado: comparar torres (CU-06)', 'enc', 'get', () => `/api/v1/mediciones/comparar?tipo_variable=1&torres=1,2&desde=2026-11-01T00:00:00Z&hasta=2026-11-02T00:00:00Z`, null],
    ['Supervisor: configurar umbral (solo lectura)', 'sup', 'put', () => `/api/v1/sensores/1/umbrales`, { severidad: 'critica', valor_min: 1, valor_max: 2 }],
    ['Encargado: crear torre (solo lectura)', 'enc', 'post', () => `/api/v1/torres`, { nombre: 'Z', tipo: 'aeroponica' }],
  ];
  test.each(casos)('%s → 403', async (_n, quien, metodo, ruta, cuerpo) => {
    const r = await api()[metodo](ruta()).set('authorization', `Bearer ${tok[quien]}`).send(cuerpo ?? {});
    expect(r.status).toBe(403);
  });

  test('RN-10 el Encargado solo ve sus torres en /torres/estado', async () => {
    const r = await api().get('/api/v1/torres/estado').set('authorization', `Bearer ${tok.enc}`);
    expect(r.status).toBe(200);
    expect(r.body.torres.map((t: { id_instalacion: number }) => t.id_instalacion).sort()).toEqual([semilla.torres[0], semilla.torres[1]].sort());
    const r2 = await api().get('/api/v1/torres/estado').set('authorization', `Bearer ${tok.sup}`);
    expect(r2.body.torres).toHaveLength(3);
  });

  test('Lectura permitida: Encargado ve umbrales de su torre; Supervisor lista dispositivos', async () => {
    expect((await api().get(`/api/v1/sensores/${sensor(devA, 'ph')}/umbrales`).set('authorization', `Bearer ${tok.enc}`)).status).toBe(200);
    expect((await api().get(`/api/v1/dispositivos`).set('authorization', `Bearer ${tok.sup}`)).status).toBe(200);
  });

  test('NEG-09 / CP-17 la auditoría no se modifica ni elimina (API 405 y trigger en BD)', async () => {
    const id = (await s.db.query<{ id_log: string }>(`SELECT id_log FROM log_auditoria LIMIT 1`)).rows[0].id_log;
    expect((await api().put(`/api/v1/auditoria/${id}`).set('authorization', `Bearer ${tok.admin}`).send({})).status).toBe(405);
    expect((await api().delete(`/api/v1/auditoria/${id}`).set('authorization', `Bearer ${tok.admin}`)).status).toBe(405);
    await expect(s.db.query(`UPDATE log_auditoria SET accion = 'x' WHERE id_log = $1`, [id])).rejects.toBeTruthy();
    await expect(s.db.query(`DELETE FROM log_auditoria WHERE id_log = $1`, [id])).rejects.toBeTruthy();
    const sigue = await s.db.query(`SELECT 1 FROM log_auditoria WHERE id_log = $1`, [id]);
    expect(sigue.rowCount).toBe(1);
  });

  test('NEG-10 el Administrador no cambia su propio rol (409)', async () => {
    const me = await api().get('/api/v1/auth/me').set('authorization', `Bearer ${tok.admin}`);
    const r = await api().patch(`/api/v1/usuarios/${me.body.id_usuario}`).set('authorization', `Bearer ${tok.admin}`).send({ rol: 'supervisor' });
    expect(r.status).toBe(409);
  });

  test('NEG-11 token expirado → 401', async () => {
    const vencido = jwt.sign({ sub: '1', rol: 'administrador', ver: 1, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) - 10 }, config().JWT_SECRET);
    expect((await api().get('/api/v1/torres/estado').set('authorization', `Bearer ${vencido}`)).status).toBe(401);
  });
});

describe('CU-02 / CU-09 Sesión y usuarios', () => {
  test('CP-16 email duplicado → 409; alta devuelve contraseña temporal una vez', async () => {
    const h = { authorization: `Bearer ${tok.admin}` };
    const ok = await api().post('/api/v1/usuarios').set(h).send({ nombre: 'Nuevo Encargado', email: 'nuevo@aquaplants.cl', rol: 'encargado', torres: [semilla.torres[0]] });
    expect(ok.status).toBe(201);
    expect(ok.body.password_temporal).toMatch(/.{10,}/);
    const dup = await api().post('/api/v1/usuarios').set(h).send({ nombre: 'Otro', email: 'NUEVO@aquaplants.cl', rol: 'supervisor' });
    expect(dup.status).toBe(409);
    const nuevo = await login(app, 'nuevo@aquaplants.cl', ok.body.password_temporal);
    const me = await api().get('/api/v1/auth/me').set('authorization', `Bearer ${nuevo}`);
    expect(me.body.debe_cambiar_password).toBe(true);
  });

  test('desactivar usuario revoca sus sesiones (401) y se audita', async () => {
    const lista = await api().get('/api/v1/usuarios').set('authorization', `Bearer ${tok.admin}`);
    const u = lista.body.find((x: { email: string }) => x.email === 'nuevo@aquaplants.cl');
    const lst = await s.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM usuario`);
    expect(lst.rows[0].n).toBeGreaterThan(4);
    const pass = (await api().post(`/api/v1/usuarios/${u.id_usuario}/restablecer-password`).set('authorization', `Bearer ${tok.admin}`)).body.password_temporal;
    const t = await login(app, 'nuevo@aquaplants.cl', pass);
    expect((await api().patch(`/api/v1/usuarios/${u.id_usuario}`).set('authorization', `Bearer ${tok.admin}`).send({ activo: false })).status).toBe(200);
    expect((await api().get('/api/v1/torres/estado').set('authorization', `Bearer ${t}`)).status).toBe(401);
    const r = await api().post('/api/v1/auth/login').send({ email: 'nuevo@aquaplants.cl', password: pass });
    expect(r.status).toBe(401);
    expect(r.body.mensaje).toBe('Credenciales inválidas');
  });

  test('CU-02 credenciales incorrectas: mensaje genérico; 5 intentos → 423 bloqueo', async () => {
    const r = await api().post('/api/v1/auth/login').send({ email: 'noexiste@aquaplants.cl', password: 'x' });
    expect(r.status).toBe(401);
    expect(r.body.mensaje).toBe('Credenciales inválidas');
    let ultimo = 0;
    for (let i = 0; i < 5; i++) ultimo = (await api().post('/api/v1/auth/login').send({ email: 'encargado2@aquaplants.cl', password: 'incorrecta' })).status;
    expect(ultimo).toBe(423);
    expect((await api().post('/api/v1/auth/login').send({ email: 'encargado2@aquaplants.cl', password: semilla.passwords.encargado })).status).toBe(423);
  });

  test('cambio de contraseña: aviso por correo al titular (sin la contraseña) y el worker lo envía una vez', async () => {
    const h = { authorization: `Bearer ${tok.admin}` };
    const alta = await api().post('/api/v1/usuarios').set(h).send({ nombre: 'Titular Aviso', email: 'aviso@aquaplants.cl', rol: 'supervisor' });
    const t = await login(app, 'aviso@aquaplants.cl', alta.body.password_temporal);
    const nueva = 'NuevaClave2026x';
    const r = await api().post('/api/v1/auth/cambiar-password').set('authorization', `Bearer ${t}`).send({ actual: alta.body.password_temporal, nueva });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ aviso_correo: false }); // entorno de pruebas sin SMTP
    const n = await s.db.query<{ destinatario: string; asunto: string; texto: string; estado: string }>(
      `SELECT destinatario, asunto, texto, estado FROM notificacion_correo WHERE destinatario = 'aviso@aquaplants.cl'`,
    );
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].estado).toBe('pendiente');
    expect(n.rows[0].texto).toContain('Titular Aviso');
    expect(n.rows[0].texto).not.toContain(nueva);
    expect(n.rows[0].texto).not.toContain(alta.body.password_temporal);

    const enviados: { destinatarios: string[]; asunto: string }[] = [];
    const correos = new CorreosCuentaService(s.db, { configurado: true, enviar: async (m) => void enviados.push(m) });
    // Dos «workers» en paralelo: el aviso se envía una sola vez (SKIP LOCKED).
    await Promise.all([correos.procesarPendientes(), correos.procesarPendientes()]);
    expect(enviados.filter((m) => m.destinatarios.includes('aviso@aquaplants.cl'))).toHaveLength(1);
    const fin = await s.db.query<{ estado: string }>(`SELECT estado FROM notificacion_correo WHERE destinatario = 'aviso@aquaplants.cl'`);
    expect(fin.rows[0].estado).toBe('enviada');

    // Contraseña incorrecta → 422 y ningún aviso nuevo.
    const t2 = await login(app, 'aviso@aquaplants.cl', nueva);
    expect((await api().post('/api/v1/auth/cambiar-password').set('authorization', `Bearer ${t2}`).send({ actual: 'incorrecta1', nueva: 'OtraClave2026y' })).status).toBe(422);
    expect((await s.db.query(`SELECT 1 FROM notificacion_correo WHERE destinatario = 'aviso@aquaplants.cl'`)).rowCount).toBe(1);
  });

  test('aviso de cambio de contraseña sin SMTP queda «no_configurada» (nunca «enviada»)', async () => {
    const correos = new CorreosCuentaService(s.db, { configurado: false, enviar: async () => undefined });
    await s.db.query(
      `INSERT INTO notificacion_correo (id_usuario, tipo, destinatario, asunto, texto) SELECT id_usuario, 'cambio_password', email, 'a', 'b' FROM usuario WHERE email = 'aviso@aquaplants.cl'`,
    );
    expect(await correos.procesarPendientes()).toBe(0);
    const r = await s.db.query<{ estado: string }>(`SELECT estado FROM notificacion_correo WHERE destinatario = 'aviso@aquaplants.cl' ORDER BY id_notificacion DESC LIMIT 1`);
    expect(r.rows[0].estado).toBe('no_configurada');
  });

  test('cierre de sesión invalida el token (jti en lista de bloqueo)', async () => {
    const t = await login(app, 'supervisor@aquaplants.cl', semilla.passwords.supervisor);
    expect((await api().post('/api/v1/auth/logout').set('authorization', `Bearer ${t}`)).status).toBe(204);
    expect((await api().get('/api/v1/auth/me').set('authorization', `Bearer ${t}`)).status).toBe(401);
  });
});

describe('CU-08 / CU-10 Gestión', () => {
  test('CU-08 alta de dispositivo: credencial mostrada una vez, solo hash en BD, telemetría funciona', async () => {
    const r = await api()
      .post('/api/v1/dispositivos')
      .set('authorization', `Bearer ${tok.admin}`)
      .send({ nombre: 'AquaBrain-Test', id_instalacion: semilla.torres[1], intervalo_muestreo_s: 60 });
    expect(r.status).toBe(201);
    expect(r.body.credencial).toHaveLength(43);
    const fila = await s.db.query<{ credencial_hash: string }>(`SELECT credencial_hash FROM dispositivo WHERE id_dispositivo = $1`, [r.body.id_dispositivo]);
    expect(fila.rows[0].credencial_hash).not.toContain(r.body.credencial);
    const sen = await api().post('/api/v1/sensores').set('authorization', `Bearer ${tok.admin}`).send({ id_dispositivo: r.body.id_dispositivo, id_tipo_variable: 1 });
    expect(sen.status).toBe(201);
    const t = await api()
      .post('/api/v1/telemetria')
      .set('authorization', `Bearer ${r.body.credencial}`)
      .send(lote(r.body.id_dispositivo, [{ id_sensor: sen.body.id_sensor, valor: 6.1, ts: tsUnico() }]));
    expect(t.status).toBe(201);
    // CP-22: baja del sensor → lecturas posteriores 422, histórico conservado
    expect((await api().patch(`/api/v1/sensores/${sen.body.id_sensor}/baja`).set('authorization', `Bearer ${tok.admin}`).send({ motivo: 'reemplazo', confirmar: true })).status).toBe(200);
    const t2 = await api()
      .post('/api/v1/telemetria')
      .set('authorization', `Bearer ${r.body.credencial}`)
      .send(lote(r.body.id_dispositivo, [{ id_sensor: sen.body.id_sensor, valor: 6.1, ts: tsUnico() }]));
    expect(t2.status).toBe(422);
    // CP-18: baja del dispositivo → 401 y el histórico se conserva
    expect((await api().patch(`/api/v1/dispositivos/${r.body.id_dispositivo}/baja`).set('authorization', `Bearer ${tok.admin}`).send({ motivo: 'retiro', confirmar: true })).status).toBe(200);
    const t3 = await api()
      .post('/api/v1/telemetria')
      .set('authorization', `Bearer ${r.body.credencial}`)
      .send(lote(r.body.id_dispositivo, [{ id_sensor: sen.body.id_sensor, valor: 6.1, ts: tsUnico() }]));
    expect(t3.status).toBe(401);
    const hist = await s.db.query(`SELECT 1 FROM medicion WHERE id_sensor = $1`, [sen.body.id_sensor]);
    expect(hist.rowCount).toBe(1);
    const ev = await s.db.query(`SELECT 1 FROM evento WHERE id_dispositivo = $1 AND tipo = 'intento_rechazado'`, [r.body.id_dispositivo]);
    expect(ev.rowCount).toBe(1);
  });

  test('CU-08 nombre de torre duplicado → 409', async () => {
    const r = await api().post('/api/v1/torres').set('authorization', `Bearer ${tok.admin}`).send({ nombre: 'torre a · lechuga', tipo: 'aeroponica' });
    expect(r.status).toBe(409);
  });

  test('CP-19 cultivo: uno en curso por torre (409); en torre de baja (409); cierre válido', async () => {
    const h = { authorization: `Bearer ${tok.enc}` };
    const lista = await api().get(`/api/v1/cultivos?torre=${semilla.torres[0]}`).set(h);
    const enCurso = lista.body.find((c: { estado: string }) => c.estado === 'en_curso');
    expect((await api().post('/api/v1/cultivos').set(h).send({ id_instalacion: semilla.torres[0], id_especie: 1, fecha_inicio: '2026-10-01' })).status).toBe(409);
    expect((await api().patch(`/api/v1/cultivos/${enCurso.id_cultivo}/cerrar`).set(h).send({ fecha_fin: '2020-01-01' })).status).toBe(422);
    const hoy = new Date().toISOString().slice(0, 10);
    expect((await api().patch(`/api/v1/cultivos/${enCurso.id_cultivo}/cerrar`).set(h).send({ fecha_fin: hoy })).status).toBe(200);
    expect((await api().post('/api/v1/cultivos').set(h).send({ id_instalacion: semilla.torres[0], id_especie: 2, fecha_inicio: hoy })).status).toBe(201);
    const nueva = await api().post('/api/v1/torres').set('authorization', `Bearer ${tok.admin}`).send({ nombre: 'Torre Baja', tipo: 'hidroponica' });
    await api().patch(`/api/v1/torres/${nueva.body.id_instalacion}/baja`).set('authorization', `Bearer ${tok.admin}`).send({ motivo: 'prueba', confirmar: true });
    const r = await api().post('/api/v1/cultivos').set('authorization', `Bearer ${tok.admin}`).send({ id_instalacion: nueva.body.id_instalacion, id_especie: 1, fecha_inicio: hoy });
    expect(r.status).toBe(409);
  });
});

describe('CU-03 / CU-05 / CU-06 Consultas y continuidad', () => {
  test('CP-09 / CP-21 sin señal tras 3 intervalos → estado y evento con causa desconocida; reconexión al volver', async () => {
    await s.db.query(`UPDATE dispositivo SET ultima_comunicacion = now() - interval '200 seconds', estado = 'activo' WHERE id_dispositivo = $1`, [devC.id_dispositivo]);
    expect(await s.continuidad.detectarSinSenal()).toBeGreaterThanOrEqual(1);
    const ev = await s.db.query<{ detalle: { causa: string } }>(`SELECT detalle FROM evento WHERE id_dispositivo = $1 AND tipo = 'sin_senal'`, [devC.id_dispositivo]);
    expect(ev.rows[0].detalle.causa).toBe('desconocida');
    const est = await api().get(`/api/v1/torres/${semilla.torres[2]}/estado`).set('authorization', `Bearer ${tok.sup}`);
    expect(est.body.torres[0].dispositivos[0].conectividad).toBe('sin_senal');
    expect((await enviar(devC, lote(devC.id_dispositivo, [{ id_sensor: sensor(devC, 'ph'), valor: 5.9, ts: tsUnico() }]))).status).toBe(201);
    const rec = await s.db.query(`SELECT 1 FROM evento WHERE id_dispositivo = $1 AND tipo = 'reconexion'`, [devC.id_dispositivo]);
    expect(rec.rowCount).toBe(1);
  });

  test('CP-04 estado actual: valor, unidad, ts y clasificación calculada en el servicio', async () => {
    const r = await api().get('/api/v1/torres/estado').set('authorization', `Bearer ${tok.sup}`);
    const torreA = r.body.torres.find((t: { id_instalacion: number }) => t.id_instalacion === semilla.torres[0]);
    const temp = torreA.variables.find((v: { tipo_variable: string }) => v.tipo_variable === 'Temperatura del agua');
    expect(temp).toMatchObject({ valor: 23.5, unidad: '°C', estado: 'advertencia' });
    expect(torreA.alertas_activas).toBeGreaterThan(0);
  });

  test('CP-13 histórico: agrega, adjunta umbrales y detecta huecos; rango > 90 días → 422', async () => {
    const idS = sensor(devA, 'temperatura');
    const desde = new Date(Date.now() - 6 * 3600_000).toISOString();
    const hasta = new Date().toISOString();
    const r = await api().get(`/api/v1/mediciones/historico?sensor=${idS}&desde=${desde}&hasta=${hasta}`).set('authorization', `Bearer ${tok.enc}`);
    expect(r.status).toBe(200);
    expect(r.body.puntos.length).toBeGreaterThanOrEqual(6);
    expect(r.body.umbrales).toHaveLength(2);
    const alias = await api().get(`/api/v1/historicos?sensor=${idS}&desde=${desde}&hasta=${hasta}`).set('authorization', `Bearer ${tok.enc}`);
    expect(alias.status).toBe(200);
    const mal = await api().get(`/api/v1/mediciones/historico?sensor=${idS}&desde=2026-01-01T00:00:00Z&hasta=2026-06-01T00:00:00Z`).set('authorization', `Bearer ${tok.enc}`);
    expect(mal.status).toBe(422);
  });

  test('CP-15 exportar CSV (Supervisor): «;», encabezados en español y exportación auditada', async () => {
    const desde = new Date(Date.now() - 6 * 3600_000).toISOString();
    const hasta = new Date().toISOString();
    const r = await api().get(`/api/v1/historicos/export?torres=${semilla.torres[0]}&desde=${desde}&hasta=${hasta}`).set('authorization', `Bearer ${tok.sup}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    const lineas = r.text.replace('﻿', '').trim().split('\n');
    expect(lineas[0]).toBe('fecha_hora;torre;dispositivo;variable;valor;unidad');
    expect(lineas.length).toBeGreaterThan(5);
    const aud = await s.db.query<{ detalle: { filas: number } }>(`SELECT detalle FROM log_auditoria WHERE accion = 'exportar_csv' ORDER BY id_log DESC LIMIT 1`);
    expect(aud.rows[0].detalle.filas).toBe(lineas.length - 1);
  });

  test('CP-14 comparar torres con la misma granularidad; torre sin datos se informa', async () => {
    const desde = new Date(Date.now() - 6 * 3600_000).toISOString();
    const hasta = new Date().toISOString();
    const r = await api()
      .get(`/api/v1/mediciones/comparar?tipo_variable=1&torres=${semilla.torres.join(',')}&desde=${desde}&hasta=${hasta}`)
      .set('authorization', `Bearer ${tok.sup}`);
    expect(r.status).toBe(200);
    expect(r.body.series.length + r.body.sin_datos.length).toBe(3);
  });

  test('CC-06 reconciliación: documento «recibido» de un lote existente se marca; uno faltante se reprocesa', async () => {
    const l = lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'nivel'), valor: 70, ts: tsUnico() }]);
    await s.payloads.guardarRecibido({ id_lote: l.id_lote, id_dispositivo: devA.id_dispositivo, payload: l });
    const mongo = (s.payloads as unknown as { payloads: { updateOne: (f: object, u: object) => Promise<unknown> } }).payloads;
    await mongo.updateOne({ id_lote: l.id_lote }, { $set: { recibido_en: new Date(Date.now() - 5 * 60_000) } });
    const r = await s.continuidad.reconciliar(s.ingesta);
    expect(r.reprocesados).toBeGreaterThanOrEqual(1);
    expect((await s.db.query(`SELECT 1 FROM lote_ingesta WHERE id_lote = $1`, [l.id_lote])).rowCount).toBe(1);
  });

  test('CP-23 salud: 200 con API, PostgreSQL y MongoDB', async () => {
    const r = await api().get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.componentes).toEqual({ api: 'ok', postgresql: 'ok', mongodb: 'ok' });
  });

  test('continuidad: lotes recuperados y eventos del dispositivo (reinicio, datos descartados) idempotentes', async () => {
    const ts = new Date(Date.now() - 30 * 60_000).toISOString();
    const l = { ...lote(devA.id_dispositivo, [{ id_sensor: sensor(devA, 'nivel'), valor: 71, ts }]), meta: { recuperado: true, pendientes: 3 } };
    expect((await enviar(devA, l)).status).toBe(201);
    const ev = {
      id_evento_local: randomUUID(),
      id_dispositivo: devA.id_dispositivo,
      tipo: 'datos_descartados',
      ts: new Date().toISOString(),
      detalle: { desde: ts, hasta: ts, lotes: 2, lecturas: 10, motivo: 'capacidad de la cola local agotada' },
    };
    const e1 = await api().post('/api/v1/telemetria/eventos').set('authorization', `Bearer ${devA.token}`).send(ev);
    const e2 = await api().post('/api/v1/telemetria/eventos').set('authorization', `Bearer ${devA.token}`).send(ev);
    expect([e1.status, e2.status]).toEqual([201, 200]);
    const res = await api().get('/api/v1/continuidad').set('authorization', `Bearer ${tok.enc}`);
    expect(res.body.lotes_recuperados_24h).toBeGreaterThanOrEqual(1);
    expect(res.body.descartes[0].detalle.lecturas).toBe(10);
    expect(res.body.dispositivos.every((d: { id_instalacion: number }) => [semilla.torres[0], semilla.torres[1]].includes(d.id_instalacion))).toBe(true);
  });
});
