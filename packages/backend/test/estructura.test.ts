import request from 'supertest';
import { cerrar, DB_URL, login, preparar, type Siembra } from './entorno.js';
import type { Servicios } from '../src/contenedor.js';
import { designarPrincipal } from '../src/scripts/principal.js';

/**
 * D-37 (Anexo C): clientes separados, Supervisor con sus Encargados, Técnico con
 * incidencias, GPS por dispositivo y Administrador principal. Prueba de integración
 * (PostgreSQL real): se ejecuta en el CI.
 */
let s: Servicios;
let app: Parameters<typeof request>[0];
let semilla: Siembra;
let admin: string;
let sup: string;
const api = () => request(app);
const H = (t: string) => ({ authorization: `Bearer ${t}` });

let idNorte: number;
/** Torres creadas con nombre automático en el Cliente Norte (D-40). */
const torresAuto: number[] = [];
let torreNorte: number;
let dispNorte: number;

beforeAll(async () => {
  const e = await preparar();
  s = e.s;
  app = e.app;
  semilla = e.semilla;
  admin = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
  sup = await login(app, 'supervisor@aquaplants.cl', semilla.passwords.supervisor);
});
afterAll(async () => {
  await cerrar(s);
});

describe('RN-11 clientes y aislamiento', () => {
  test('la migración deja los datos existentes en el «Cliente inicial»', async () => {
    const r = await api().get('/api/v1/clientes').set(H(admin));
    expect(r.status).toBe(200);
    expect(r.body).toEqual([expect.objectContaining({ id_cliente: 1, nombre: 'Cliente inicial', torres: 3 })]);
    expect((await api().get('/api/v1/clientes').set(H(sup))).status).toBe(403);
    const me = await api().get('/api/v1/auth/me').set(H(sup));
    expect(me.body).toMatchObject({ id_cliente: 1, cliente: 'Cliente inicial' });
  });

  test('el Administrador crea un cliente y una torre suya; el nombre se repite solo entre clientes', async () => {
    const c = await api().post('/api/v1/clientes').set(H(admin)).send({ nombre: 'Cliente Norte' });
    expect(c.status).toBe(201);
    idNorte = c.body.id_cliente;
    // Con dos clientes ya no hay cliente por defecto.
    expect((await api().post('/api/v1/torres').set(H(admin)).send({ nombre: 'Sin cliente', tipo: 'aeroponica' })).status).toBe(422);
    const t = await api().post('/api/v1/torres').set(H(admin)).send({ nombre: 'Torre A · Lechuga', tipo: 'aeroponica', id_cliente: idNorte });
    expect(t.status).toBe(201);
    torreNorte = t.body.id_instalacion;
    expect((await api().post('/api/v1/torres').set(H(admin)).send({ nombre: 'torre a · lechuga', tipo: 'aeroponica', id_cliente: idNorte })).status).toBe(409);
    // D-40: sin nombre, el servidor asigna el siguiente libre del cliente y el ID lo da la base.
    const auto1 = await api().post('/api/v1/torres').set(H(admin)).send({ nombre: '  ', tipo: 'aeroponica', id_cliente: idNorte });
    expect(auto1.status).toBe(201);
    expect(auto1.body.nombre).toBe('Torre 1');
    expect(auto1.body.id_instalacion).toBeGreaterThan(torreNorte);
    const auto2 = await api().post('/api/v1/torres').set(H(admin)).send({ tipo: 'hidroponica', id_cliente: idNorte });
    expect(auto2.body.nombre).toBe('Torre 2');
    torresAuto.push(auto1.body.id_instalacion, auto2.body.id_instalacion);
    const d = await api().post('/api/v1/dispositivos').set(H(admin)).send({ nombre: 'AquaBrain-Norte', id_instalacion: torreNorte, latitud: -33.45, longitud: -70.66 });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ latitud: -33.45, longitud: -70.66 });
    dispNorte = d.body.id_dispositivo;
  });

  test('el Supervisor del cliente inicial no ve la torre de otro cliente', async () => {
    const r = await api().get('/api/v1/torres/estado').set(H(sup));
    expect(r.body.torres.map((t: { id_instalacion: number }) => t.id_instalacion)).not.toContain(torreNorte);
    expect(r.body.torres).toHaveLength(3);
    expect((await api().get(`/api/v1/torres/${torreNorte}/estado`).set(H(sup))).status).toBe(403);
    expect((await api().get(`/api/v1/alertas?torre=${torreNorte}`).set(H(sup))).status).toBe(403);
    const disp = await api().get('/api/v1/dispositivos').set(H(sup));
    expect(disp.body.map((x: { id_dispositivo: number }) => x.id_dispositivo)).not.toContain(dispNorte);
  });

  test('un dispositivo no pasa a la torre de otro cliente; una torre con datos no cambia de cliente', async () => {
    const r = await api().patch(`/api/v1/dispositivos/${dispNorte}`).set(H(admin)).send({ id_instalacion: semilla.torres[0] });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('DISPOSITIVO_OTRO_CLIENTE');
    const m = await api().patch(`/api/v1/torres/${torreNorte}`).set(H(admin)).send({ id_cliente: 1 });
    expect(m.status).toBe(409);
    expect(m.body.codigo).toBe('TORRE_CON_HISTORICO');
  });

  test('GPS: latitud y longitud juntas, dentro de rango; null la borra', async () => {
    expect((await api().patch(`/api/v1/dispositivos/${dispNorte}`).set(H(admin)).send({ latitud: -33 })).status).toBe(422);
    expect((await api().patch(`/api/v1/dispositivos/${dispNorte}`).set(H(admin)).send({ latitud: -95, longitud: 0 })).status).toBe(422);
    expect((await api().patch(`/api/v1/dispositivos/${dispNorte}`).set(H(sup)).send({ latitud: 1, longitud: 1 })).status).toBe(403);
    const ok = await api().patch(`/api/v1/dispositivos/${dispNorte}`).set(H(admin)).send({ latitud: -36.82, longitud: -73.05 });
    expect(ok.status).toBe(200);
    const est = await api().get(`/api/v1/torres/${torreNorte}/estado`).set(H(admin));
    expect(est.body.torres[0]).toMatchObject({ id_cliente: idNorte, cliente: 'Cliente Norte' });
    expect(est.body.torres[0].dispositivos[0]).toMatchObject({ latitud: -36.82, longitud: -73.05 });
    const borrar = await api().patch(`/api/v1/dispositivos/${dispNorte}`).set(H(admin)).send({ latitud: null, longitud: null });
    expect(borrar.body).toMatchObject({ latitud: null, longitud: null });
  });
});

describe('CU-09 / RN-12 Supervisor gestiona solo sus Encargados', () => {
  test('crea Encargados de su cliente con sus torres, nada más', async () => {
    const ok = await api().post('/api/v1/usuarios').set(H(sup)).send({ nombre: 'Encargado del Sup', email: 'enc.sup@aquaplants.cl', rol: 'encargado', torres: [semilla.torres[0]] });
    expect(ok.status).toBe(201);
    expect(ok.body.password_temporal).toBeTruthy();
    expect((await api().post('/api/v1/usuarios').set(H(sup)).send({ nombre: 'X', email: 'x1@aquaplants.cl', rol: 'supervisor' })).status).toBe(403);
    expect((await api().post('/api/v1/usuarios').set(H(sup)).send({ nombre: 'X', email: 'x2@aquaplants.cl', rol: 'encargado', id_cliente: idNorte })).status).toBe(403);
    expect((await api().post('/api/v1/usuarios').set(H(sup)).send({ nombre: 'X', email: 'x3@aquaplants.cl', rol: 'encargado', torres: [torreNorte] })).status).toBe(422);
    const roles = await api().get('/api/v1/roles').set(H(sup));
    expect(roles.body.map((r: { nombre: string }) => r.nombre)).toEqual(['encargado']);
  });

  test('lista solo los Encargados de su cliente y no toca a otros usuarios', async () => {
    const lista = await api().get('/api/v1/usuarios').set(H(sup));
    expect(lista.status).toBe(200);
    expect(lista.body.length).toBeGreaterThan(0);
    expect(lista.body.every((u: { rol: string; id_cliente: number }) => u.rol === 'encargado' && u.id_cliente === 1)).toBe(true);
    const todos = await api().get('/api/v1/usuarios').set(H(admin));
    const adm = todos.body.find((u: { email: string }) => u.email === 'admin@aquaplants.cl');
    expect((await api().patch(`/api/v1/usuarios/${adm.id_usuario}`).set(H(sup)).send({ activo: false })).status).toBe(404);
    expect((await api().post(`/api/v1/usuarios/${adm.id_usuario}/restablecer-password`).set(H(sup))).status).toBe(404);
    const enc = lista.body.find((u: { email: string }) => u.email === 'enc.sup@aquaplants.cl');
    expect((await api().patch(`/api/v1/usuarios/${enc.id_usuario}`).set(H(sup)).send({ rol: 'supervisor' })).status).toBe(403);
    expect((await api().patch(`/api/v1/usuarios/${enc.id_usuario}`).set(H(sup)).send({ activo: false })).status).toBe(200);
  });

  test('el Encargado de otro cliente no recibe torres del cliente inicial', async () => {
    const r = await api().post('/api/v1/usuarios').set(H(admin)).send({ nombre: 'Enc Norte', email: 'enc.norte@aquaplants.cl', rol: 'encargado', id_cliente: idNorte, torres: [semilla.torres[0]] });
    expect(r.status).toBe(422);
    const ok = await api().post('/api/v1/usuarios').set(H(admin)).send({ nombre: 'Enc Norte', email: 'enc.norte@aquaplants.cl', rol: 'encargado', id_cliente: idNorte, torres: [torreNorte] });
    expect(ok.status).toBe(201);
    const t = await login(app, 'enc.norte@aquaplants.cl', ok.body.password_temporal);
    const est = await api().get('/api/v1/torres/estado').set(H(t));
    expect(est.body.torres.map((x: { id_instalacion: number }) => x.id_instalacion)).toEqual([torreNorte]);
  });
});

describe('RN-13 Técnico e incidencias', () => {
  let tec: string;
  test('el Técnico ve las torres de sus clientes, sin alertas de cultivo', async () => {
    const r = await api().post('/api/v1/usuarios').set(H(admin)).send({ nombre: 'Tania Técnica', email: 'tecnico@aquaplants.cl', rol: 'tecnico', clientes: [idNorte] });
    expect(r.status).toBe(201);
    tec = await login(app, 'tecnico@aquaplants.cl', r.body.password_temporal);
    const est = await api().get('/api/v1/torres/estado').set(H(tec));
    expect(est.body.torres.map((x: { id_instalacion: number }) => x.id_instalacion).sort((a: number, b: number) => a - b)).toEqual([torreNorte, ...torresAuto]);
    expect((await api().get('/api/v1/alertas').set(H(tec))).status).toBe(403);
    expect((await api().get(`/api/v1/cultivos?torre=${torreNorte}`).set(H(tec))).status).toBe(403);
    expect((await api().get('/api/v1/usuarios').set(H(tec))).status).toBe(403);
  });

  test('«sin señal» abre una incidencia para el Técnico del cliente; se cierra cuando vuelve', async () => {
    await s.db.query(`UPDATE dispositivo SET ultima_comunicacion = now() - interval '1 day' WHERE id_dispositivo = $1`, [dispNorte]);
    expect(await s.continuidad.detectarSinSenal()).toBeGreaterThanOrEqual(1);
    const lista = await api().get('/api/v1/incidencias?estado=activas').set(H(tec));
    expect(lista.status).toBe(200);
    const inc = lista.body.datos.find((x: { id_dispositivo: number }) => x.id_dispositivo === dispNorte);
    expect(inc).toMatchObject({ estado: 'abierta', sigue_sin_senal: true, cliente: 'Cliente Norte' });
    // El Supervisor del cliente inicial no la ve; el Encargado no tiene acceso.
    const desdeSup = await api().get('/api/v1/incidencias').set(H(sup));
    expect(desdeSup.body.datos.some((x: { id_dispositivo: number }) => x.id_dispositivo === dispNorte)).toBe(false);
    expect((await api().patch(`/api/v1/incidencias/${inc.id_incidencia}/atender`).set(H(sup))).status).toBe(403);
    expect((await api().patch(`/api/v1/incidencias/${inc.id_incidencia}/cerrar`).set(H(tec)).send({ comentario: 'x' })).status).toBe(409);
    expect((await api().patch(`/api/v1/incidencias/${inc.id_incidencia}/atender`).set(H(tec))).body.estado).toBe('en_atencion');
    // El equipo vuelve: queda anotado y ya se puede cerrar.
    await s.db.query(`UPDATE dispositivo SET estado = 'activo', ultima_comunicacion = now() WHERE id_dispositivo = $1`, [dispNorte]);
    expect((await api().patch(`/api/v1/incidencias/${inc.id_incidencia}/cerrar`).set(H(tec)).send({ comentario: '' })).status).toBe(422);
    const cerrada = await api().patch(`/api/v1/incidencias/${inc.id_incidencia}/cerrar`).set(H(tec)).send({ comentario: 'Se cambió la fuente de poder' });
    expect(cerrada.status).toBe(200);
    expect(cerrada.body).toMatchObject({ estado: 'cerrada', cerrada_por: 'Tania Técnica', comentario_cierre: 'Se cambió la fuente de poder' });
  });
});

describe('RN-12 Administrador y Administrador principal', () => {
  test('el Administrador no crea Administradores ni gestiona otro Administrador', async () => {
    expect((await api().post('/api/v1/usuarios').set(H(admin)).send({ nombre: 'Otro Admin', email: 'admin2@aquaplants.cl', rol: 'administrador' })).status).toBe(403);
    expect((await api().post('/api/v1/usuarios').set(H(admin)).send({ nombre: 'Otro P', email: 'p@aquaplants.cl', rol: 'administrador_principal' })).status).toBe(403);
  });

  test('el principal se designa fuera de la app y entonces gestiona Administradores', async () => {
    await expect(designarPrincipal(DB_URL, 'supervisor@aquaplants.cl', false)).rejects.toThrow(/Solo una cuenta de Administrador/);
    const idAdmin = (await api().get('/api/v1/auth/me').set(H(admin))).body.id_usuario;
    await designarPrincipal(DB_URL, 'admin@aquaplants.cl', false);
    // La designación cierra la sesión anterior: el script corre fuera de la API, que guarda la
    // versión de cada usuario hasta 30 s; se simula que ese plazo ya pasó.
    s.auth.invalidarCache(idAdmin);
    expect((await api().get('/api/v1/auth/me').set(H(admin))).status).toBe(401);
    const p = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
    expect((await api().get('/api/v1/auth/me').set(H(p))).body.rol).toBe('administrador_principal');
    const nuevo = await api().post('/api/v1/usuarios').set(H(p)).send({ nombre: 'Admin Dos', email: 'admin2@aquaplants.cl', rol: 'administrador' });
    expect(nuevo.status).toBe(201);
    // Nadie modifica a un Administrador principal desde la aplicación.
    const yo = (await api().get('/api/v1/auth/me').set(H(p))).body.id_usuario;
    const a2 = await login(app, 'admin2@aquaplants.cl', nuevo.body.password_temporal);
    expect((await api().patch(`/api/v1/usuarios/${yo}`).set(H(a2)).send({ activo: false })).status).toBe(403);
    // Mínimo dos Administradores: con uno solo no se puede desactivar.
    expect((await api().patch(`/api/v1/usuarios/${nuevo.body.id_usuario}`).set(H(p)).send({ activo: false })).body.codigo).toBe('MINIMO_ADMINISTRADORES');
    // El principal ve la auditoría de su designación.
    const aud = await api().get('/api/v1/auditoria?accion=designar_administrador_principal').set(H(p));
    expect(aud.body.total).toBe(1);
  });
});
