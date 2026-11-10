import request from 'supertest';
import { cerrar, login, lote, preparar, tsUnico, type Siembra } from './entorno.js';
import type { Servicios } from '../src/contenedor.js';
import { MantenimientoService } from '../src/services/mantenimientoService.js';

/**
 * D-35: variables que menciona la empresa (caudal, consumo hídrico, fotoperiodo),
 * calidad del enlace (RSSI) y retención de mediciones sin TimescaleDB.
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

describe('D-35 — variables de la empresa', () => {
  test('el catálogo incluye caudal, consumo hídrico y fotoperiodo con sus unidades', async () => {
    const t = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
    const r = await api().get('/api/v1/catalogos').set('authorization', `Bearer ${t}`);
    expect(r.status).toBe(200);
    const tipos = r.body.tipos_variable as { clave: string; unidad: string }[];
    expect(tipos.find((x) => x.clave === 'caudal')?.unidad).toBe('L/min');
    expect(tipos.find((x) => x.clave === 'consumo_hidrico')?.unidad).toBe('L/día');
    expect(tipos.find((x) => x.clave === 'fotoperiodo')?.unidad).toBe('h/día');
  });

  test('las torres de la demostración tienen sensores de las nuevas variables y reciben mediciones', async () => {
    const dev = semilla.dispositivos[0];
    const caudal = dev.sensores.find((x) => x.clave === 'caudal');
    expect(caudal).toBeDefined();
    const r = await api()
      .post('/api/v1/telemetria')
      .set('authorization', `Bearer ${dev.token}`)
      .send(lote(dev.id_dispositivo, [{ id_sensor: caudal!.id_sensor, valor: 4.2, ts: tsUnico() }]));
    expect(r.status).toBe(201);
  });
});

describe('D-35 — configuración del dispositivo', () => {
  test('GET /telemetria/configuracion devuelve los sensores activos del dispositivo autenticado', async () => {
    const dev = semilla.dispositivos[1];
    const r = await api().get('/api/v1/telemetria/configuracion').set('authorization', `Bearer ${dev.token}`);
    expect(r.status).toBe(200);
    expect(r.body.id_dispositivo).toBe(dev.id_dispositivo);
    const ids = (r.body.sensores as { id_sensor: number; clave: string }[]).map((x) => x.id_sensor).sort((a, b) => a - b);
    expect(ids).toEqual(dev.sensores.map((x) => x.id_sensor).sort((a, b) => a - b));
    expect(r.body.sensores.every((x: { clave: string }) => typeof x.clave === 'string')).toBe(true);
  });

  test('sin credencial de dispositivo → 401; un JWT de usuario no sirve', async () => {
    expect((await api().get('/api/v1/telemetria/configuracion')).status).toBe(401);
    const t = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
    expect((await api().get('/api/v1/telemetria/configuracion').set('authorization', `Bearer ${t}`)).status).toBe(401);
  });
});

describe('D-35 — calidad del enlace', () => {
  test('meta.rssi_dbm se guarda y el estado de la torre lo clasifica', async () => {
    const dev = semilla.dispositivos[2];
    const id = dev.sensores[0].id_sensor;
    const enviar = async (rssi: number) =>
      api()
        .post('/api/v1/telemetria')
        .set('authorization', `Bearer ${dev.token}`)
        .send({ ...lote(dev.id_dispositivo, [{ id_sensor: id, valor: dev.sensores[0].base, ts: tsUnico() }]), meta: { rssi_dbm: rssi } });
    const t = await login(app, 'admin@aquaplants.cl', semilla.passwords.administrador);
    const calidad = async () => {
      const r = await api().get('/api/v1/torres/estado').set('authorization', `Bearer ${t}`);
      const d = (r.body.torres as { dispositivos: { id_dispositivo: number; rssi_dbm: number | null; calidad_enlace: string }[] }[])
        .flatMap((x) => x.dispositivos)
        .find((x) => x.id_dispositivo === dev.id_dispositivo)!;
      return [d.rssi_dbm, d.calidad_enlace];
    };
    expect((await enviar(-60)).status).toBe(201);
    expect(await calidad()).toEqual([-60, 'buena']);
    expect((await enviar(-75)).status).toBe(201);
    expect(await calidad()).toEqual([-75, 'aceptable']);
    expect((await enviar(-92)).status).toBe(201);
    expect(await calidad()).toEqual([-92, 'debil']);
  });

  test('un RSSI fuera de rango se rechaza (422)', async () => {
    const dev = semilla.dispositivos[2];
    const r = await api()
      .post('/api/v1/telemetria')
      .set('authorization', `Bearer ${dev.token}`)
      .send({ ...lote(dev.id_dispositivo, [{ id_sensor: dev.sensores[0].id_sensor, valor: 1, ts: tsUnico() }]), meta: { rssi_dbm: 12 } });
    expect(r.status).toBe(422);
  });
});

describe('D-35 — retención de mediciones', () => {
  test('con RETENCION_MEDICIONES_DIAS = 0 no se borra nada', async () => {
    expect(await new MantenimientoService(s.db, 365, 0).purgarMedicionesAntiguas()).toBe(0);
  });

  test('borra solo lo anterior a la retención; con TimescaleDB manda la política de la migración 008', async () => {
    const dev = semilla.dispositivos[0];
    const idS = dev.sensores[0].id_sensor;
    const vieja = new Date(Date.now() - 40 * 86_400_000);
    vieja.setUTCMilliseconds(123);
    const reciente = new Date(Date.now() - 2 * 86_400_000);
    reciente.setUTCMilliseconds(456);
    for (const ts of [vieja, reciente]) {
      await s.db.query(`INSERT INTO medicion (ts, id_sensor, valor, id_lote) VALUES ($1, $2, 1, gen_random_uuid()) ON CONFLICT DO NOTHING`, [ts, idS]);
    }
    const hayTimescale = ((await s.db.query(`SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`)).rowCount ?? 0) > 0;
    const borradas = await new MantenimientoService(s.db, 365, 30).purgarMedicionesAntiguas();
    const quedan = async (ts: Date) => (await s.db.query(`SELECT 1 FROM medicion WHERE id_sensor = $1 AND ts = $2`, [idS, ts])).rowCount;
    if (hayTimescale) {
      expect(borradas).toBe(0);
      expect(await quedan(vieja)).toBe(1);
    } else {
      expect(borradas).toBeGreaterThanOrEqual(1);
      expect(await quedan(vieja)).toBe(0);
    }
    expect(await quedan(reciente)).toBe(1);
  });
});
