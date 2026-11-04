import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ColaPersistente } from '../src/cola.js';
import { DispositivoVirtual } from '../src/dispositivo.js';
import { valorSensor } from '../src/generador.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'aq-sim-'));
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
type Lote = { id_lote: string; lecturas: { ts: string; id_sensor: number; valor: number }[]; meta?: { recuperado?: boolean } };

/** Servidor de prueba que imita la API: idempotente por id_lote y con modo «caído». */
function apiFalsa() {
  const recibidos = new Map<string, Lote>();
  const eventos: { tipo: string; detalle?: unknown }[] = [];
  const estado = { caida: false, duplicadosVistos: 0 };
  const srv: Server = createServer(async (req, res) => {
    let cuerpo = '';
    for await (const c of req) cuerpo += c;
    if (estado.caida) {
      res.writeHead(503, { 'retry-after': '1', 'content-type': 'application/json' });
      return res.end('{"codigo":"SERVICIO_NO_DISPONIBLE"}');
    }
    const b = JSON.parse(cuerpo);
    if (req.url?.endsWith('/telemetria/eventos')) {
      eventos.push(b);
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end('{"registrado":true}');
    }
    const dup = recibidos.has(b.id_lote);
    if (dup) estado.duplicadosVistos++;
    recibidos.set(b.id_lote, b);
    res.writeHead(dup ? 200 : 201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id_lote: b.id_lote, recibidas: b.lecturas.length, duplicado: dup }));
  });
  return new Promise<{ url: string; recibidos: typeof recibidos; eventos: typeof eventos; estado: typeof estado; cerrar: () => void }>((ok) =>
    srv.listen(0, '127.0.0.1', () =>
      ok({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, recibidos, eventos, estado, cerrar: () => srv.close() }),
    ),
  );
}

const cfgDisp = () => ({
  id_dispositivo: 1,
  nombre: 'AquaBrain-T',
  torre: 'Torre T',
  token: 'tok',
  intervalo_s: 3600,
  sensores: [
    { id_sensor: 1, clave: 'ph', base: 5.9, amplitud: 0.1 },
    { id_sensor: 2, clave: 'ce', base: 1.0, amplitud: 0.08 },
  ],
});

test('generador determinista: mismo sensor y tiempo → mismo valor', () => {
  const s = { id_sensor: 1, clave: 'ph', base: 5.9, amplitud: 0.1 };
  assert.equal(valorSensor(s, 1_700_000_000_000), valorSensor(s, 1_700_000_000_000));
});

test('cola persistente: sobrevive a la reapertura (reinicio) y respeta FIFO', () => {
  const dir = tmp();
  const c1 = new ColaPersistente<Lote>(dir, 1024 * 1024);
  c1.encolar('a', { id_lote: 'a', lecturas: [{ ts: '2026-11-03T10:00:00Z', id_sensor: 1, valor: 1 }] });
  c1.encolar('b', { id_lote: 'b', lecturas: [{ ts: '2026-11-03T10:01:00Z', id_sensor: 1, valor: 1 }] });
  const c2 = new ColaPersistente<Lote>(dir, 1024 * 1024); // «reinicio»
  assert.equal(c2.longitud, 2);
  assert.equal(c2.primero()!.item.id_lote, 'a');
  c2.encolar('c', { id_lote: 'c', lecturas: [] });
  c2.confirmar(c2.primero()!.archivo);
  assert.deepEqual([c2.primero()!.item.id_lote, c2.longitud], ['b', 2]);
});

test('CC-12 capacidad agotada: descarta los más antiguos y registra el periodo perdido', () => {
  const dir = tmp();
  const c = new ColaPersistente<Lote>(dir, 600);
  for (let i = 0; i < 10; i++) {
    c.encolar(`l${i}`, { id_lote: `l${i}`, lecturas: [{ ts: `2026-11-03T10:0${i}:00Z`, id_sensor: 1, valor: i }] });
  }
  const d = c.descartes()!;
  assert.ok(c.tamanoBytes <= 600);
  assert.ok(d.lotes >= 1);
  assert.equal(d.desde, '2026-11-03T10:00:00Z');
  assert.equal(c.longitud + d.lotes, 10);
  assert.ok(new ColaPersistente<Lote>(dir, 600).descartes(), 'el registro de descartes también es persistente');
});

test('CP-10 / CC-04 sin Internet: sigue midiendo, guarda en cola y al reconectar sincroniza en orden sin duplicados', async () => {
  const api = await apiFalsa();
  const d = new DispositivoVirtual(cfgDisp(), { apiUrl: api.url, dataDir: tmp(), capacidadBytes: 512 * 1024, backoffBaseMs: 50, backoffMaxMs: 200, medicionAutomatica: false });
  d.encender('prueba');
  d.medir();
  await esperar(150);
  assert.equal(api.recibidos.size, 1);
  d.setRed(false);
  for (let i = 0; i < 4; i++) {
    d.medir();
    await esperar(1100); // marcas temporales distintas
  }
  assert.equal(api.recibidos.size, 1, 'sin red no se envía nada');
  assert.equal(d.estado().cola_lotes, 4);
  d.setRed(true);
  await esperar(500);
  assert.equal(api.recibidos.size, 5);
  assert.equal(d.estado().cola_lotes, 0);
  const recuperados = [...api.recibidos.values()].filter((l) => l.meta?.recuperado);
  assert.equal(recuperados.length, 4, 'los lotes generados sin red viajan marcados como recuperados');
  const orden = recuperados.map((l) => l.lecturas[0].ts);
  assert.deepEqual(orden, [...orden].sort(), 'se envían en orden FIFO con su ts original');
  assert.ok(api.eventos.some((e) => e.tipo === 'reconexion_local'));
  d.apagar();
  api.cerrar();
});

test('API caída (503): conserva el lote y reintenta con espera exponencial', async () => {
  const api = await apiFalsa();
  api.estado.caida = true;
  const d = new DispositivoVirtual(cfgDisp(), { apiUrl: api.url, dataDir: tmp(), capacidadBytes: 512 * 1024, backoffBaseMs: 50, backoffMaxMs: 200, medicionAutomatica: false });
  d.encender('prueba');
  d.medir();
  await esperar(200);
  assert.equal(d.estado().cola_lotes, 1);
  assert.match(d.estado().ultimo_error ?? '', /503|eventos/);
  api.estado.caida = false;
  await esperar(1500); // Retry-After: 1 s
  assert.equal(d.estado().cola_lotes, 0);
  assert.equal(api.recibidos.size, 1);
  d.apagar();
  api.cerrar();
});

test('CC-10 / CC-11 corte eléctrico: sin mediciones durante el apagado; al volver reabre la cola, informa reinicio y no duplica', async () => {
  const api = await apiFalsa();
  const dataDir = tmp();
  const d = new DispositivoVirtual(cfgDisp(), { apiUrl: api.url, dataDir, capacidadBytes: 512 * 1024, backoffBaseMs: 50, backoffMaxMs: 200, medicionAutomatica: false });
  d.encender('prueba');
  d.setRed(false); // router también sin energía / sin Internet
  d.medir();
  await esperar(1100);
  d.medir();
  assert.equal(d.estado().cola_lotes, 2);
  d.apagar();
  d.medir(); // apagado: no debe generar nada
  assert.equal(d.estado().cola_lotes, 2);
  // Nuevo proceso (reinicio real): otra instancia sobre el mismo directorio.
  const d2 = new DispositivoVirtual(cfgDisp(), { apiUrl: api.url, dataDir, capacidadBytes: 512 * 1024, backoffBaseMs: 50, backoffMaxMs: 200, medicionAutomatica: false });
  d2.setRed(false);
  d2.encender('retorno de energía');
  assert.equal(d2.estado().cola_lotes, 2, 'lo persistido sobrevive al reinicio');
  d2.setRed(true);
  await esperar(500);
  assert.equal(api.recibidos.size, 2);
  assert.equal(api.estado.duplicadosVistos, 0);
  assert.ok(api.eventos.some((e) => e.tipo === 'reinicio'));
  d2.apagar();
  api.cerrar();
});
