import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autorizado, FUNCIONALIDADES } from './permisos.js';
import { LoteSchema } from './schemas/telemetria.js';
import { UmbralSchema, HistoricoSchema } from './schemas/api.js';
import { granularidadPara } from './granularidad.js';

test('Tabla 48: Encargado no resuelve críticas, Supervisor sí', () => {
  assert.equal(autorizado('encargado', 'alertas.resolver_critica'), false);
  assert.equal(autorizado('supervisor', 'alertas.resolver_critica'), true);
  assert.equal(autorizado('encargado', 'alertas.resolver_advertencia'), true);
});

test('Tabla 48: solo lectura de umbrales para Encargado y Supervisor', () => {
  assert.equal(autorizado('encargado', 'umbrales.gestionar', 'leer'), true);
  assert.equal(autorizado('encargado', 'umbrales.gestionar', 'escribir'), false);
  assert.equal(autorizado('supervisor', 'infraestructura.gestionar', 'escribir'), false);
  assert.equal(autorizado('administrador', 'umbrales.gestionar', 'escribir'), true);
});

test('Tabla 48: telemetría solo para dispositivo; usuarios solo administrador', () => {
  for (const r of ['encargado', 'supervisor', 'administrador'] as const) {
    assert.equal(autorizado(r, 'telemetria.enviar'), false);
  }
  assert.equal(autorizado('dispositivo', 'telemetria.enviar'), true);
  assert.equal(autorizado('supervisor', 'usuarios.gestionar', 'leer'), false);
  assert.equal(autorizado('supervisor', 'cultivos.gestionar', 'escribir'), false);
  assert.equal(autorizado('encargado', 'cultivos.gestionar', 'escribir'), true);
  assert.equal(Object.keys(FUNCIONALIDADES).length, 13);
});

test('LoteSchema valida el contrato del ES2', () => {
  const ok = LoteSchema.safeParse({
    id_lote: '3b1f7c2e-8a4d-4c1e-9b7a-1f2d3c4b5a69',
    id_dispositivo: 7,
    lecturas: [{ id_sensor: 31, ts: '2026-11-03T14:04:00Z', valor: 6.12 }],
  });
  assert.equal(ok.success, true);
  assert.equal(LoteSchema.safeParse({ id_lote: 'x', id_dispositivo: 7, lecturas: [] }).success, false);
  assert.equal(
    LoteSchema.safeParse({ id_lote: '3b1f7c2e-8a4d-4c1e-9b7a-1f2d3c4b5a69', id_dispositivo: 7, lecturas: [{ id_sensor: 1, ts: 'ayer', valor: 1 }] }).success,
    false,
  );
});

test('UmbralSchema exige min < max; HistoricoSchema limita a 90 días', () => {
  assert.equal(UmbralSchema.safeParse({ severidad: 'critica', valor_min: 7, valor_max: 5 }).success, false);
  assert.equal(
    HistoricoSchema.safeParse({ sensor: '1', desde: '2026-01-01T00:00:00Z', hasta: '2026-06-01T00:00:00Z' }).success,
    false,
  );
});

test('granularidad según rango', () => {
  const d = new Date('2026-01-01T00:00:00Z');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 3600_000)).etiqueta, 'crudo');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 3 * 86400_000)).etiqueta, '15 min');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 20 * 86400_000)).etiqueta, '1 h');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 60 * 86400_000)).etiqueta, '1 día');
});
