import request from 'supertest';
import { cerrar, login, preparar, type Siembra } from './entorno.js';
import type { Servicios } from '../src/contenedor.js';

/**
 * Informe de gestión (Evaluación 3): permisos, alcance por cliente y validación del periodo.
 * Prueba de integración (PostgreSQL real): se ejecuta en el CI.
 */
let s: Servicios;
let app: Parameters<typeof request>[0];
let semilla: Siembra;
let admin: string;
let sup: string;
let enc: string;
const api = () => request(app);
const H = (t: string) => ({ authorization: `Bearer ${t}` });
const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
const hace30 = new Date(Date.now() - 29 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
const informe = (t: string, qs = `desde=${hace30}&hasta=${hoy}`) => api().get(`/api/v1/informes/gestion?${qs}`).set(H(t));

beforeAll(async () => {
  const e = await preparar();
  s = e.s;
  app = e.app;
  semilla = e.semilla;
  admin = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
  sup = await login(app, 'supervisor@aquaplants.cl', semilla.passwords.supervisor);
  enc = await login(app, 'encargado@aquaplants.cl', semilla.passwords.encargado);
});
afterAll(async () => {
  await cerrar(s);
});

describe('Informe de gestión', () => {
  test('el Encargado no tiene acceso (403)', async () => {
    expect((await informe(enc)).status).toBe(403);
  });

  test('el Administrador ve todo el sistema, el detalle por torre, la serie diaria y la auditoría', async () => {
    const r = await informe(admin);
    expect(r.status).toBe(200);
    expect(r.body.periodo).toEqual({ desde: hace30, hasta: hoy });
    expect(r.body.inventario.torres).toBeGreaterThanOrEqual(3);
    expect(r.body.inventario.cultivos_en_curso).toBeGreaterThanOrEqual(1);
    expect(r.body.por_torre.length).toBeGreaterThanOrEqual(3);
    expect(r.body.por_dia).toHaveLength(30);
    expect(r.body.por_dia[29].dia).toBe(hoy);
    expect(Array.isArray(r.body.auditoria)).toBe(true);
    expect(r.body.auditoria.map((a: { accion: string }) => a.accion)).toContain('login');
    for (const k of ['total', 'criticas', 'resueltas', 'activas']) expect(typeof r.body.alertas[k]).toBe('number');
  });

  test('el Supervisor solo ve las torres de su cliente y no la auditoría', async () => {
    const c = await api().post('/api/v1/clientes').set(H(admin)).send({ nombre: 'Cliente ajeno informe' });
    expect(c.status).toBe(201);
    const t = await api().post('/api/v1/torres').set(H(admin)).send({ nombre: 'Torre ajena', tipo: 'hidroponica', ubicacion: 'X', id_cliente: c.body.id_cliente });
    expect(t.status).toBe(201);

    const r = await informe(sup);
    expect(r.status).toBe(200);
    expect(r.body.auditoria).toBeNull();
    expect(r.body.por_torre.map((x: { torre: string }) => x.torre)).not.toContain('Torre ajena');
    // Aunque pida el otro cliente, el alcance del backend no lo deja ver nada.
    const otro = await informe(sup, `desde=${hace30}&hasta=${hoy}&cliente=${c.body.id_cliente}`);
    expect(otro.status).toBe(200);
    expect(otro.body.por_torre).toHaveLength(0);
    // El Administrador sí la ve filtrando por ese cliente.
    const a = await informe(admin, `desde=${hace30}&hasta=${hoy}&cliente=${c.body.id_cliente}`);
    expect(a.body.cliente).toBe('Cliente ajeno informe');
    expect(a.body.por_torre.map((x: { torre: string }) => x.torre)).toEqual(['Torre ajena']);
  });

  test('periodo inválido → 422', async () => {
    expect((await informe(admin, `desde=${hoy}&hasta=${hace30}`)).status).toBe(422);
    expect((await informe(admin, 'desde=2024-01-01&hasta=2026-01-01')).status).toBe(422);
    expect((await informe(admin, 'desde=ayer&hasta=hoy')).status).toBe(422);
  });
});
