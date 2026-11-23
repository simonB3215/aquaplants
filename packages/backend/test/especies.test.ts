import request from 'supertest';
import { cerrar, login, preparar, type Siembra } from './entorno.js';
import type { Servicios } from '../src/contenedor.js';

/**
 * CRUD del catálogo de especies (demostración final). Antes era fijo por el seed.
 * Prueba de integración (PostgreSQL real): se ejecuta en el CI.
 */
let s: Servicios;
let app: Parameters<typeof request>[0];
let semilla: Siembra;
let admin: string;
let enc: string;
const api = () => request(app);
const H = (t: string) => ({ authorization: `Bearer ${t}` });
let idPh: number;
let idCe: number;
let idTomate: number;
const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

beforeAll(async () => {
  const e = await preparar();
  s = e.s;
  app = e.app;
  semilla = e.semilla;
  admin = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
  enc = await login(app, 'encargado@aquaplants.cl', semilla.passwords.encargado);
  const cat = await api().get('/api/v1/catalogos').set(H(admin));
  idPh = cat.body.tipos_variable.find((t: { clave: string }) => t.clave === 'ph').id_tipo_variable;
  idCe = cat.body.tipos_variable.find((t: { clave: string }) => t.clave === 'ce').id_tipo_variable;
});
afterAll(async () => {
  await cerrar(s);
});

describe('Catálogo de especies (CRUD)', () => {
  test('solo el Administrador gestiona; todos ven las activas en /catalogos', async () => {
    expect((await api().get('/api/v1/especies').set(H(enc))).status).toBe(403);
    expect((await api().post('/api/v1/especies').set(H(enc)).send({ nombre: 'X' })).status).toBe(403);
    const cat = await api().get('/api/v1/catalogos').set(H(enc));
    expect(cat.status).toBe(200);
    expect(cat.body.especies.map((e: { nombre: string }) => e.nombre)).toContain('Lechuga');
    const l = await api().get('/api/v1/especies').set(H(admin));
    expect(l.status).toBe(200);
    expect(l.body.find((e: { nombre: string }) => e.nombre === 'Lechuga')).toMatchObject({ estado: 'activo', cultivos_en_curso: 1 });
  });

  test('crear con rangos; nombre único; rangos validados', async () => {
    const c = await api()
      .post('/api/v1/especies')
      .set(H(admin))
      .send({ nombre: 'Tomate cherry', descripcion: 'Demostración', rangos: [{ id_tipo_variable: idPh, valor_min: 5.5, valor_max: 6.5 }] });
    expect(c.status).toBe(201);
    idTomate = c.body.id_especie;
    expect((await api().post('/api/v1/especies').set(H(admin)).send({ nombre: 'tomate CHERRY' })).status).toBe(409);
    // mínimo ≥ máximo → validación del esquema
    expect((await api().post('/api/v1/especies').set(H(admin)).send({ nombre: 'Malo', rangos: [{ id_tipo_variable: idPh, valor_min: 7, valor_max: 6 }] })).status).toBe(422);
    // fuera del rango físico del pH (0–14)
    const f = await api().post('/api/v1/especies').set(H(admin)).send({ nombre: 'Malo', rangos: [{ id_tipo_variable: idPh, valor_min: 5, valor_max: 20 }] });
    expect(f.status).toBe(422);
    const l = await api().get('/api/v1/especies').set(H(admin));
    expect(l.body.find((e: { id_especie: number }) => e.id_especie === idTomate)).toMatchObject({
      nombre: 'Tomate cherry',
      estado: 'activo',
      rangos: [{ id_tipo_variable: idPh, valor_min: 5.5, valor_max: 6.5 }],
    });
  });

  test('editar nombre y reemplazar rangos (queda auditado)', async () => {
    const e = await api()
      .patch(`/api/v1/especies/${idTomate}`)
      .set(H(admin))
      .send({ nombre: 'Tomate', rangos: [{ id_tipo_variable: idPh, valor_min: 5.8, valor_max: 6.3 }, { id_tipo_variable: idCe, valor_min: 2, valor_max: 3.5 }] });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ nombre: 'Tomate' });
    const l = await api().get('/api/v1/especies').set(H(admin));
    expect(l.body.find((x: { id_especie: number }) => x.id_especie === idTomate).rangos).toHaveLength(2);
    const a = await s.db.query(`SELECT accion FROM log_auditoria WHERE entidad = 'especie' AND id_entidad = $1 ORDER BY id_log`, [String(idTomate)]);
    expect(a.rows.map((r) => (r as { accion: string }).accion)).toEqual(['crear_especie', 'editar_especie']);
  });

  test('baja lógica: no con cultivos en curso; la de baja no se ofrece ni se usa; se reactiva', async () => {
    const lechuga = (await api().get('/api/v1/especies').set(H(admin))).body.find((e: { nombre: string }) => e.nombre === 'Lechuga');
    const enUso = await api().patch(`/api/v1/especies/${lechuga.id_especie}`).set(H(admin)).send({ estado: 'baja' });
    expect(enUso.status).toBe(409);
    expect(enUso.body.codigo).toBe('ESPECIE_EN_USO');

    expect((await api().patch(`/api/v1/especies/${idTomate}`).set(H(admin)).send({ estado: 'baja' })).status).toBe(200);
    const cat = await api().get('/api/v1/catalogos').set(H(admin));
    expect(cat.body.especies.map((e: { id_especie: number }) => e.id_especie)).not.toContain(idTomate);
    const torre = semilla.torres[0];
    const c = await api().post('/api/v1/cultivos').set(H(admin)).send({ id_instalacion: torre, id_especie: idTomate, fecha_inicio: hoy });
    expect(c.status).toBe(422);

    expect((await api().patch(`/api/v1/especies/${idTomate}`).set(H(admin)).send({ estado: 'activo' })).status).toBe(200);
    const cat2 = await api().get('/api/v1/catalogos').set(H(admin));
    expect(cat2.body.especies.map((e: { id_especie: number }) => e.id_especie)).toContain(idTomate);
  });
});
