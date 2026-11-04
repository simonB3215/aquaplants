import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { DispositivoVirtual, type ConfigDispositivo, type OpcionesSim } from './dispositivo.js';
import { deltaCritico } from './generador.js';

/**
 * Simulador AquaBrain — proceso independiente del navegador.
 *   npm run sim                         (usa packages/simulador/data/dispositivos.json)
 * Variables: API_URL, SIM_CONFIG_PATH, SIM_DATA_DIR, SIM_COLA_BYTES (512 KB),
 *            SIM_BACKOFF_BASE_MS (5000), SIM_BACKOFF_MAX_MS (300000), SIM_INTERVALO_S,
 *            SIM_CONTROL_PORT (4100), SIM_CONTROL_HOST (127.0.0.1), SIM_CONTROL_TOKEN.
 * La API de control (local) permite activar escenarios reales de la demostración.
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SIM_CONFIG_PATH ?? path.resolve(aqui, '../data/dispositivos.json');
if (!existsSync(configPath)) {
  console.error(`No existe ${configPath}. Ejecute primero: npm run db:migrate && npm run db:seed`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8')) as { dispositivos: ConfigDispositivo[] };
const op: OpcionesSim = {
  apiUrl: (process.env.API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, ''),
  dataDir: process.env.SIM_DATA_DIR ?? path.resolve(aqui, '../data/estado'),
  capacidadBytes: Number(process.env.SIM_COLA_BYTES ?? 512 * 1024),
  backoffBaseMs: Number(process.env.SIM_BACKOFF_BASE_MS ?? 5000),
  backoffMaxMs: Number(process.env.SIM_BACKOFF_MAX_MS ?? 300_000),
};
const token = process.env.SIM_CONTROL_TOKEN ?? '';
const intervaloForzado = process.env.SIM_INTERVALO_S ? Number(process.env.SIM_INTERVALO_S) : undefined;

const dispositivos = new Map<number, DispositivoVirtual>();
for (const c of config.dispositivos) {
  if (intervaloForzado) c.intervalo_s = intervaloForzado;
  const d = new DispositivoVirtual(c, op);
  dispositivos.set(c.id_dispositivo, d);
  d.encender('inicio del simulador');
}
console.log(`[sim] ${dispositivos.size} dispositivos → ${op.apiUrl} (cola ${Math.round(op.capacidadBytes / 1024)} KB c/u)`);

function objetivo(id?: number): DispositivoVirtual {
  const d = id ? dispositivos.get(id) : [...dispositivos.values()][0];
  if (!d) throw Object.assign(new Error('Dispositivo inexistente en el simulador'), { status: 404 });
  return d;
}

/** Escenarios de la demostración (prompt maestro §21), ejecutados sobre el simulador real. */
async function escenario(codigo: string, id?: number) {
  const d = objetivo(id);
  switch (codigo) {
    case 'A':
      for (const x of dispositivos.values()) {
        x.modos = {};
        x.setRed(true);
        x.encender('escenario A');
      }
      return { codigo, mensaje: 'Operación normal: todos los dispositivos encendidos, con red y valores normales' };
    case 'B': {
      const s = d.cfg.sensores.find((x) => x.clave === 'ph') ?? d.cfg.sensores[0];
      d.modos[s.id_sensor] = { tipo: 'desplazado', delta: deltaCritico(s.clave), motivo: 'escenario B' };
      d.medir();
      return { codigo, mensaje: `${d.cfg.nombre}: el sensor ${s.clave} (#${s.id_sensor}) envía valores fuera del umbral crítico`, id_sensor: s.id_sensor };
    }
    case 'C':
      d.setRed(false);
      return { codigo, mensaje: `${d.cfg.nombre}: Internet cortado. Sigue midiendo y guarda los lotes en su cola persistente`, estado: d.estado() };
    case 'D': {
      d.modos = {};
      d.setRed(true);
      await new Promise((ok) => setTimeout(ok, 1500));
      await d.bombear();
      let reenvio: unknown = null;
      if (d.ultimoLoteConfirmado) {
        const r = await d.reenviarLote(d.ultimoLoteConfirmado);
        reenvio = { status: r.status, duplicado: r.json.duplicado === true, id_lote: d.ultimoLoteConfirmado.id_lote };
      }
      return { codigo, mensaje: `${d.cfg.nombre}: red restablecida; lotes pendientes sincronizados. Se reenvió a propósito el último lote para comprobar la idempotencia`, reenvio, estado: d.estado() };
    }
    case 'E':
      d.apagar();
      return { codigo, mensaje: `${d.cfg.nombre}: corte eléctrico simulado. No genera mediciones; su cola en disco se conserva`, estado: d.estado() };
    case 'F':
      d.encender('retorno de energía (escenario F)');
      return { codigo, mensaje: `${d.cfg.nombre}: energía restablecida. Reabre la cola, informa el reinicio y reenvía lo persistido`, estado: d.estado() };
    default:
      throw Object.assign(new Error('Escenario desconocido (A–F; el G se ejecuta en la API)'), { status: 404 });
  }
}

// ------------------------------------------------------------------ API de control
function autorizado(req: IncomingMessage) {
  if (!token) return true; // sin token configurado solo escucha en 127.0.0.1
  const h = Buffer.from(req.headers.authorization ?? '');
  const e = Buffer.from(`Bearer ${token}`);
  return h.length === e.length && timingSafeEqual(h, e);
}
const responder = (res: ServerResponse, status: number, cuerpo: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};
async function leerCuerpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 10_000) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
  }
  return s ? JSON.parse(s) : {};
}

const control = createServer(async (req, res) => {
  try {
    if (!autorizado(req)) return responder(res, 401, { mensaje: 'Token de control inválido' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = url.pathname.match(/^\/dispositivos\/(\d+)\/(red|energia|intervalo|credencial-invalida)$/);
    if (req.method === 'GET' && url.pathname === '/estado') {
      return responder(res, 200, { api: op.apiUrl, dispositivos: [...dispositivos.values()].map((d) => d.estado()) });
    }
    if (req.method === 'POST' && url.pathname === '/escenario') {
      const b = await leerCuerpo(req);
      return responder(res, 200, await escenario(String(b.codigo ?? '').toUpperCase(), b.id_dispositivo ? Number(b.id_dispositivo) : undefined));
    }
    if (req.method === 'POST' && m) {
      const d = objetivo(Number(m[1]));
      const b = await leerCuerpo(req);
      if (m[2] === 'red') d.setRed(Boolean(b.conectado));
      if (m[2] === 'energia') (b.encendido ? d.encender('control manual') : d.apagar());
      if (m[2] === 'intervalo') d.setIntervalo(Math.max(1, Number(b.intervalo_s) || 60));
      if (m[2] === 'credencial-invalida') return responder(res, 200, await d.probarCredencialInvalida());
      return responder(res, 200, d.estado());
    }
    responder(res, 404, { mensaje: 'Ruta de control inexistente' });
  } catch (e) {
    responder(res, (e as { status?: number }).status ?? 500, { mensaje: (e as Error).message });
  }
});
const host = process.env.SIM_CONTROL_HOST ?? '127.0.0.1';
if (!token && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('[sim] SIM_CONTROL_TOKEN es obligatorio si la API de control escucha fuera de localhost');
  process.exit(1);
}
const puerto = Number(process.env.SIM_CONTROL_PORT ?? 4100);
control.listen(puerto, host, () => console.log(`[sim] API de control en http://${host}:${puerto}`));

const salir = () => {
  for (const d of dispositivos.values()) d.apagar();
  control.close();
  process.exit(0);
};
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
