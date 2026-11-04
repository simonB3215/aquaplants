import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { cargarConfig } from '../src/config.js';
import { crearServicios, type Servicios } from '../src/contenedor.js';
import { crearApp } from '../src/app.js';
import { migrar } from '../src/scripts/migrate.js';
import { sembrar } from '../src/scripts/seed.js';

/**
 * Entorno de pruebas de integración: base PostgreSQL de pruebas (TEST_DATABASE_URL)
 * y MongoDB (TEST_MONGO_URL). Se reinicia el esquema y se siembran datos sin historial.
 */
export const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/aquaplants_test';
export const MONGO_URL = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017';

export function config(extra: Record<string, string> = {}) {
  return cargarConfig({
    NODE_ENV: 'test',
    DATABASE_URL: DB_URL,
    MONGO_URL,
    MONGO_DB: `aquaplants_test_${process.pid}`,
    JWT_SECRET: 'secreto-de-pruebas-0123456789abcdef0123456789',
    DEVICE_RATE_LIMIT_PER_MIN: '10000',
    LOGIN_RATE_LIMIT_PER_MIN: '10000',
    ...extra,
  });
}

export type Siembra = NonNullable<Awaited<ReturnType<typeof sembrar>>>;

export async function preparar(extra: Record<string, string> = {}) {
  await migrar(DB_URL, { reset: true, silencioso: true });
  const semilla = (await sembrar(DB_URL, {
    historialHoras: 0,
    intervaloS: 60,
    simConfig: path.join(os.tmpdir(), `aq-sim-${randomUUID()}.json`),
    silencioso: true,
  }))!;
  const cfg = config(extra);
  const s = crearServicios(cfg);
  const app = crearApp(cfg, s);
  return { cfg, s, app, semilla, api: () => request(app) };
}

export async function cerrar(s: Servicios) {
  await Promise.allSettled([s.db.cerrar(), s.payloads.cerrar()]);
}

export async function login(app: Parameters<typeof request>[0], email: string, password: string): Promise<string> {
  const r = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

export function lote(idDispositivo: number, lecturas: { id_sensor: number; valor: number; ts?: string }[], idLote = randomUUID()) {
  const ahora = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  return { id_lote: idLote, id_dispositivo: idDispositivo, lecturas: lecturas.map((l) => ({ id_sensor: l.id_sensor, valor: l.valor, ts: l.ts ?? ahora })) };
}

/** Marca temporal única y reciente para evitar choques (id_sensor, ts) entre pruebas. */
let desplazamiento = 0;
export function tsUnico(): string {
  desplazamiento += 1;
  return new Date(Math.floor(Date.now() / 1000) * 1000 - 3600_000 + desplazamiento * 1000).toISOString();
}
