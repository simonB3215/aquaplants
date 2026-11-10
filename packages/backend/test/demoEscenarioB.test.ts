import { jest } from '@jest/globals';
import { DemoService } from '../src/services/demoService.js';
import type { Config } from '../src/config.js';
import type { IBaseDatos } from '../src/ports/index.js';

/** Escenario B: avisa si la alerta crítica ya está activa (no habrá correo nuevo). */
const cfg = { SIM_CONTROL_URL: 'http://127.0.0.1:9999', SIM_CONTROL_TOKEN: 't' } as unknown as Config;
const dbCon = (filas: { id_alerta: string }[]) => ({ query: async () => ({ rows: filas, rowCount: filas.length }) }) as unknown as IBaseDatos;

beforeEach(() => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ codigo: 'B', mensaje: 'ok', id_sensor: 1 }), { status: 200 }));
});
afterEach(() => jest.restoreAllMocks());

test('sin alerta crítica activa anuncia alerta y correo nuevos', async () => {
  const r = (await new DemoService(cfg, dbCon([])).ejecutar('B', 1)) as Record<string, unknown>;
  expect(r.alerta_activa_previa).toBeNull();
  expect(r.correo).toMatch(/Se creará una alerta crítica nueva/);
});

test('con alerta crítica activa explica que no se enviará correo', async () => {
  const r = (await new DemoService(cfg, dbCon([{ id_alerta: '2' }])).ejecutar('B', 1)) as Record<string, unknown>;
  expect(r.alerta_activa_previa).toBe(2);
  expect(r.correo).toMatch(/No se enviará correo.*#2/);
});

test('los demás escenarios no agregan el aviso', async () => {
  const r = (await new DemoService(cfg, dbCon([{ id_alerta: '2' }])).ejecutar('A', 1)) as Record<string, unknown>;
  expect(r.correo).toBeUndefined();
});
