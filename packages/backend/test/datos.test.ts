import pg from 'pg';
import request from 'supertest';
import { cerrar, DB_URL, login, lote, preparar, tsUnico, type Siembra } from './entorno.js';
import type { Servicios } from '../src/contenedor.js';

/**
 * Bloque 2 — base de datos: evidencia de alertas y políticas de la Tabla 40,
 * roles de mínimo privilegio (ES2 §3.4), anonimización y aviso de respaldos.
 */
let s: Servicios;
let app: Parameters<typeof request>[0];
let semilla: Siembra;
let c: pg.Client;
let hayTimescale = false;

beforeAll(async () => {
  const e = await preparar();
  s = e.s;
  app = e.app;
  semilla = e.semilla;
  c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  hayTimescale = (await c.query(`SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`)).rowCount === 1;
});
afterAll(async () => {
  await c.end();
  await cerrar(s);
});

/** Ejecuta `fn` con los privilegios de `rol` y deshace todo al final. */
async function comoRol<T>(rol: string, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query(`SET LOCAL ROLE ${rol}`);
    return await fn();
  } finally {
    await c.query('ROLLBACK');
  }
}
async function codigoError(sql: string): Promise<string | undefined> {
  await c.query('SAVEPOINT p');
  try {
    await c.query(sql);
    await c.query('RELEASE SAVEPOINT p');
    return undefined;
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT p');
    return (e as { code?: string }).code;
  }
}

describe('Tabla 40 — evidencia de mediciones con alerta', () => {
  test('al generarse una alerta su medición se copia a medicion_evidencia y la FK apunta a la evidencia', async () => {
    const dev = semilla.dispositivos[0];
    const ph = dev.sensores.find((x) => x.clave === 'ph')!.id_sensor;
    const r = await request(app)
      .post('/api/v1/telemetria')
      .set('authorization', `Bearer ${dev.token}`)
      .send(lote(dev.id_dispositivo, [{ id_sensor: ph, valor: 3.1, ts: tsUnico() }]));
    expect(r.status).toBe(201);
    await s.motor.procesarPendientes(100);
    const a = await c.query(
      `SELECT a.id_alerta, e.valor, m.valor AS valor_medicion
         FROM alerta a
         JOIN medicion_evidencia e ON e.id_medicion = a.id_medicion AND e.ts = a.ts_medicion
         JOIN medicion m ON m.id_medicion = a.id_medicion AND m.ts = a.ts_medicion
        WHERE a.id_sensor = $1 AND a.estado = 'activa'`,
      [ph],
    );
    expect(a.rowCount).toBe(1);
    expect(a.rows[0].valor).toBe(a.rows[0].valor_medicion);
    const fk = await c.query(
      `SELECT confrelid::regclass::text AS destino FROM pg_constraint WHERE conname = 'alerta_evidencia_fk'`,
    );
    expect(fk.rows[0]?.destino).toBe('medicion_evidencia');
  });

  test('la evidencia es de solo inserción y una alerta sin medición se rechaza (23503)', async () => {
    await c.query('BEGIN');
    try {
      expect(await codigoError(`UPDATE medicion_evidencia SET valor = 0`)).toBe('P0001');
      expect(await codigoError(`DELETE FROM medicion_evidencia`)).toBe('P0001');
      const u = (await c.query(`SELECT id_umbral, id_sensor FROM umbral WHERE activo LIMIT 1`)).rows[0];
      expect(
        await codigoError(
          `INSERT INTO alerta (id_sensor, id_umbral, id_medicion, ts_medicion, valor, valor_min, valor_max, severidad, ultimo_valor, ts_ultima)
           VALUES (${u.id_sensor}, ${u.id_umbral}, 987654321, now(), 1, 0, 1, 'critica', 1, now())`,
        ),
      ).toBe('23503');
    } finally {
      await c.query('ROLLBACK');
    }
  });

  test('políticas TimescaleDB: compresión 7 d, retención 2 años, agregado horario 5 años', async () => {
    if (!hayTimescale) return console.warn('TimescaleDB no disponible: se omite');
    const jobs = await c.query<{ proc_name: string; hypertable_name: string; config: Record<string, unknown> }>(
      `SELECT proc_name, hypertable_name, config FROM timescaledb_information.jobs WHERE proc_name LIKE 'policy_%' ORDER BY 1, 2`,
    );
    const por = (p: string, h: string) => jobs.rows.find((j) => j.proc_name === p && j.hypertable_name === h)?.config;
    expect(por('policy_compression', 'medicion')?.compress_after).toBe('7 days');
    expect(por('policy_retention', 'medicion')?.drop_after).toBe('2 years');
    const cagg = await c.query(`SELECT materialization_hypertable_name FROM timescaledb_information.continuous_aggregates WHERE view_name = 'medicion_hora'`);
    expect(cagg.rowCount).toBe(1);
    expect(por('policy_retention', cagg.rows[0].materialization_hypertable_name)?.drop_after).toBe('5 years');
  });

  test('la retención elimina chunks de más de 2 años sin perder la evidencia de su alerta', async () => {
    if (!hayTimescale) return console.warn('TimescaleDB no disponible: se omite');
    const u = (await c.query(`SELECT id_umbral, id_sensor FROM umbral WHERE activo AND severidad = 'advertencia' ORDER BY id_sensor DESC LIMIT 1`)).rows[0];
    const m = (
      await c.query(
        `INSERT INTO medicion (ts, id_sensor, valor, id_lote) VALUES (date_trunc('second', now()) - interval '3 years', $1, 99, gen_random_uuid()) RETURNING id_medicion, ts`,
        [u.id_sensor],
      )
    ).rows[0];
    const a = (
      await c.query(
        `INSERT INTO alerta (id_sensor, id_umbral, id_medicion, ts_medicion, valor, valor_min, valor_max, severidad, ultimo_valor, ts_ultima)
         VALUES ($1, $2, $3, $4, 99, 0, 1, 'advertencia', 99, $4) RETURNING id_alerta`,
        [u.id_sensor, u.id_umbral, m.id_medicion, m.ts],
      )
    ).rows[0];
    const job = (await c.query(`SELECT job_id FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention' AND hypertable_name = 'medicion'`)).rows[0].job_id;
    await c.query(`CALL run_job(${Number(job)})`);
    expect((await c.query(`SELECT 1 FROM medicion WHERE id_medicion = $1`, [m.id_medicion])).rowCount).toBe(0);
    const ev = await c.query(
      `SELECT e.valor FROM alerta a JOIN medicion_evidencia e ON e.id_medicion = a.id_medicion AND e.ts = a.ts_medicion WHERE a.id_alerta = $1`,
      [a.id_alerta],
    );
    expect(ev.rows[0]?.valor).toBe(99);
  });
});

describe('ES2 §3.4 — roles de mínimo privilegio', () => {
  test('app_rw: opera el negocio pero no altera auditoría, evidencia ni mediciones, ni crea objetos', async () => {
    await comoRol('app_rw', async () => {
      expect(await codigoError(`SELECT count(*) FROM usuario`)).toBeUndefined();
      expect(await codigoError(`UPDATE instalacion SET ubicacion = ubicacion`)).toBeUndefined();
      expect(await codigoError(`DELETE FROM usuario_instalacion WHERE false`)).toBeUndefined();
      expect(await codigoError(`UPDATE log_auditoria SET accion = 'x'`)).toBe('42501');
      expect(await codigoError(`DELETE FROM log_auditoria`)).toBe('42501');
      expect(await codigoError(`DELETE FROM medicion WHERE false`)).toBe('42501');
      expect(await codigoError(`DELETE FROM medicion_evidencia WHERE false`)).toBe('42501');
      expect(await codigoError(`DELETE FROM usuario WHERE false`)).toBe('42501');
      expect(await codigoError(`INSERT INTO respaldo_registro (iniciado_en, estado) VALUES (now(), 'ok')`)).toBe('42501');
      expect(await codigoError(`CREATE TABLE intruso (x int)`)).toBe('42501');
    });
  });

  test('backup_ro: lee todo y solo puede registrar respaldos', async () => {
    await comoRol('backup_ro', async () => {
      expect(await codigoError(`SELECT count(*) FROM medicion`)).toBeUndefined();
      expect(await codigoError(`SELECT count(*) FROM log_auditoria`)).toBeUndefined();
      expect(await codigoError(`INSERT INTO respaldo_registro (iniciado_en, estado) VALUES (now(), 'ok')`)).toBeUndefined();
      expect(await codigoError(`UPDATE usuario SET nombre = nombre`)).toBe('42501');
      expect(await codigoError(`INSERT INTO evento (id_dispositivo, tipo, descripcion) VALUES (1, 'alta', 'x')`)).toBe('42501');
    });
  });

  test('app_ro: solo lectura', async () => {
    await comoRol('app_ro', async () => {
      expect(await codigoError(`SELECT count(*) FROM medicion`)).toBeUndefined();
      expect(await codigoError(`UPDATE umbral SET valor_min = valor_min`)).toBe('42501');
    });
  });
});

describe('Tabla 40 — anonimización de usuarios desactivados (Ley 19.628)', () => {
  test('tras 1 año se anonimiza nombre y email, se conserva el id, no puede iniciar sesión ni reactivarse', async () => {
    const reciente = (await c.query(`SELECT id_usuario FROM usuario WHERE email = 'encargado@aquaplants.cl'`)).rows[0].id_usuario;
    const antiguo = (await c.query(`SELECT id_usuario FROM usuario WHERE email = 'encargado2@aquaplants.cl'`)).rows[0].id_usuario;
    await c.query(`UPDATE usuario SET activo = false, desactivado_en = now() - interval '13 months' WHERE id_usuario = $1`, [antiguo]);
    await c.query(`UPDATE usuario SET activo = false, desactivado_en = now() - interval '1 month' WHERE id_usuario = $1`, [reciente]);
    try {
      expect(await s.mantenimiento.anonimizarDesactivados()).toBe(1);
      expect(await s.mantenimiento.anonimizarDesactivados()).toBe(0); // idempotente
      const u = (await c.query(`SELECT id_usuario, nombre, email, anonimizado_en FROM usuario WHERE id_usuario = $1`, [antiguo])).rows[0];
      expect(u.nombre).toBe(`Usuario anonimizado #${antiguo}`);
      expect(u.email).toBe(`anonimizado-${antiguo}@anonimizado.invalid`);
      expect(u.anonimizado_en).not.toBeNull();
      const otro = (await c.query(`SELECT email, anonimizado_en FROM usuario WHERE id_usuario = $1`, [reciente])).rows[0];
      expect(otro).toEqual({ email: 'encargado@aquaplants.cl', anonimizado_en: null });
      const aud = await c.query(`SELECT 1 FROM log_auditoria WHERE accion = 'anonimizar_usuario' AND id_entidad = $1`, [String(antiguo)]);
      expect(aud.rowCount).toBe(1);

      const viejoLogin = await request(app).post('/api/v1/auth/login').send({ email: 'encargado2@aquaplants.cl', password: semilla.passwords.encargado });
      expect(viejoLogin.status).toBe(401);
      const admin = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
      const r = await request(app).patch(`/api/v1/usuarios/${antiguo}`).set('authorization', `Bearer ${admin}`).send({ activo: true });
      expect(r.status).toBe(409);
      expect(r.body.codigo).toBe('USUARIO_ANONIMIZADO');
    } finally {
      await c.query(`UPDATE usuario SET activo = true, desactivado_en = NULL WHERE id_usuario = $1`, [reciente]);
    }
  });
});

describe('Tabla 16 — aviso por correo cuando falla un respaldo', () => {
  test('un respaldo fallido programa un correo a cada Administrador activo, una sola vez', async () => {
    await c.query(`INSERT INTO respaldo_registro (iniciado_en, estado, detalle) VALUES (now(), 'fallido', 'pg_dump: conexión rechazada')`);
    expect(await s.mantenimiento.avisarRespaldosFallidos()).toBe(1);
    expect(await s.mantenimiento.avisarRespaldosFallidos()).toBe(0);
    const n = await c.query(
      `SELECT n.destinatario, n.texto FROM notificacion_correo n WHERE n.tipo = 'respaldo_fallido' AND n.estado = 'pendiente'`,
    );
    const admins = await c.query(`SELECT u.email FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE r.nombre = 'administrador' AND u.activo`);
    expect(n.rows.map((x) => x.destinatario).sort()).toEqual(admins.rows.map((x) => x.email).sort());
    expect(n.rows[0].texto).toContain('pg_dump: conexión rechazada');
  });
});
