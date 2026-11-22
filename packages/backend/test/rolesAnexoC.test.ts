import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Rol } from '@aquaplants/shared';
import { cargarConfig } from '../src/config.js';
import { crearServicios } from '../src/contenedor.js';
import { crearApp } from '../src/app.js';
import { torresVisibles } from '../src/services/acceso.js';
import { UsuarioService } from '../src/services/usuarioService.js';
import type { IBaseDatos, IPayloadStore } from '../src/ports/index.js';

/**
 * D-37 (Anexo C, Tabla 70) sin base de datos: comprueba que cada ruta responde 403
 * exactamente a los roles que no la tienen. La base simulada devuelve filas vacías, así
 * que una ruta permitida puede terminar en 200, 404 o 500 (sin datos), pero nunca en 403.
 * El aislamiento real por cliente (SQL) lo cubre estructura.test.ts con PostgreSQL.
 */
const consultas: string[] = [];
const db: IBaseDatos = {
  query: async (sql: string) => {
    consultas.push(sql);
    // authJWT: versión de credenciales del usuario (sesión vigente).
    if (/SELECT version_token, activo FROM usuario/.test(sql)) return { rows: [{ version_token: 1, activo: true }], rowCount: 1 } as never;
    return { rows: [], rowCount: 0 } as never;
  },
  transaccion: async (fn) => fn(db),
  ping: async () => undefined,
  cerrar: async () => undefined,
} as IBaseDatos;
const payloads = { ping: async () => undefined, cerrar: async () => undefined } as unknown as IPayloadStore;

const cfg = cargarConfig({ DATABASE_URL: 'postgres://x@localhost/x', PAYLOADS_DATABASE_URL: 'postgres://x@localhost/y', JWT_SECRET: 'x'.repeat(32) });
const app = crearApp(cfg, crearServicios(cfg, { db, payloads }));
const silenciar = jest.spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => silenciar.mockRestore());

const token = (rol: Rol) =>
  jwt.sign({ sub: '7', rol, nombre: 'N', email: 'n@x.cl', ver: 1, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 }, cfg.JWT_SECRET, { algorithm: 'HS256' });

const TODOS: Rol[] = ['encargado', 'supervisor', 'tecnico', 'administrador', 'administrador_principal'];
type Metodo = 'get' | 'post' | 'patch' | 'put';
const casos: [Metodo, string, object | null, Rol[]][] = [
  // [método, ruta, cuerpo válido, roles que SÍ pueden]
  ['get', '/incidencias', null, ['supervisor', 'tecnico', 'administrador', 'administrador_principal']],
  ['patch', '/incidencias/1/atender', null, ['tecnico', 'administrador', 'administrador_principal']],
  ['patch', '/incidencias/1/cerrar', { comentario: 'ok' }, ['tecnico', 'administrador', 'administrador_principal']],
  ['get', '/alertas', null, ['encargado', 'supervisor', 'administrador', 'administrador_principal']],
  ['get', '/clientes', null, ['administrador', 'administrador_principal']],
  ['post', '/clientes', { nombre: 'C' }, ['administrador', 'administrador_principal']],
  ['patch', '/clientes/1', { estado: 'baja' }, ['administrador', 'administrador_principal']],
  ['get', '/usuarios', null, ['supervisor', 'administrador', 'administrador_principal']],
  ['get', '/invitaciones', null, ['supervisor', 'administrador', 'administrador_principal']],
  ['get', '/auditoria', null, ['administrador', 'administrador_principal']],
  ['get', '/cultivos?torre=1', null, ['encargado', 'supervisor', 'administrador', 'administrador_principal']],
  ['post', '/torres', { nombre: 'T', tipo: 'aeroponica' }, ['administrador', 'administrador_principal']],
  ['patch', '/dispositivos/1', { latitud: -33, longitud: -70 }, ['administrador', 'administrador_principal']],
  ['get', '/dispositivos', null, TODOS],
  ['get', '/torres/estado', null, TODOS],
  ['get', '/mediciones/comparar?tipo_variable=1&torres=1&desde=2026-01-01T00:00:00Z&hasta=2026-01-02T00:00:00Z', null, ['supervisor', 'administrador', 'administrador_principal']],
];

describe('Tabla 70: 403 solo para los roles sin permiso', () => {
  for (const [metodo, ruta, cuerpo, pueden] of casos) {
    test.each(TODOS)(`${metodo.toUpperCase()} ${ruta} — %s`, async (rol) => {
      const r = await request(app)[metodo](`/api/v1${ruta}`).set('authorization', `Bearer ${token(rol)}`).send(cuerpo ?? {});
      if (pueden.includes(rol)) expect(r.status).not.toBe(403);
      else expect(r.status).toBe(403);
    });
  }
});

describe('RN-10 modificada: alcance por rol', () => {
  test('cada rol consulta su propio alcance; los Administradores ven todo', async () => {
    const ctx = (rol: Rol) => ({ id_usuario: 7, rol, ip: null });
    consultas.length = 0;
    expect(await torresVisibles(db, ctx('administrador'))).toBeNull();
    expect(await torresVisibles(db, ctx('administrador_principal'))).toBeNull();
    expect(consultas).toHaveLength(0);
    await torresVisibles(db, ctx('supervisor'));
    expect(consultas.pop()).toMatch(/i\.id_cliente = us\.id_cliente/);
    await torresVisibles(db, ctx('encargado'));
    expect(consultas.pop()).toMatch(/usuario_instalacion[\s\S]*i\.id_cliente = us\.id_cliente/);
    await torresVisibles(db, ctx('tecnico'));
    expect(consultas.pop()).toMatch(/tecnico_cliente/);
    expect(await torresVisibles(db, ctx('otro' as Rol))).toEqual([]);
  });
});

describe('RN-12: se rechaza antes de tocar la base', () => {
  const sinBase = {
    query: async () => {
      throw new Error('no debía consultar la base');
    },
    transaccion: async () => {
      throw new Error('no debía abrir transacción');
    },
  } as unknown as IBaseDatos;
  const svc = new UsuarioService(sinBase, () => undefined);
  test.each([
    ['supervisor', 'supervisor'],
    ['supervisor', 'administrador'],
    ['administrador', 'administrador'],
    ['administrador', 'administrador_principal'],
    ['administrador_principal', 'administrador_principal'],
    ['tecnico', 'encargado'],
  ] as [Rol, Rol][])('%s no crea %s', async (actor, rol) => {
    await expect(svc.crear({ id_usuario: 1, rol: actor, ip: null }, { nombre: 'X', email: 'x@x.cl', rol })).rejects.toMatchObject({ status: 403, codigo: 'ROL_NO_GESTIONABLE' });
  });
  test('torres solo para Encargados y clientes solo para Técnicos', async () => {
    const ctx = { id_usuario: 1, rol: 'administrador' as Rol, ip: null };
    await expect(svc.crear(ctx, { nombre: 'X', email: 'x@x.cl', rol: 'supervisor', torres: [1] })).rejects.toMatchObject({ status: 422 });
    await expect(svc.crear(ctx, { nombre: 'X', email: 'x@x.cl', rol: 'encargado', clientes: [1] })).rejects.toMatchObject({ status: 422 });
  });
});
