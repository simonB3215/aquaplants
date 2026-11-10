// CP-27: cada dispositivo envía un lote de 5 lecturas cada 10 s durante DURACION_S, como un AquaBrain.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ARCHIVO } from './comun.mjs';
const API = 'https://aquaplants-api.onrender.com/api/v1';
const DURACION_S = Number(process.argv[2] ?? 600);
const { dispositivos } = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
const lat = []; const estados = {}; const aceptados = new Set(); let errRed = 0;
const porMinuto = new Map();
const fin = Date.now() + DURACION_S * 1000;
let seq = 0;
async function enviar(d) {
  const t = new Date(); t.setUTCMilliseconds(seq++ % 1000);
  const lote = { id_lote: randomUUID(), id_dispositivo: d.id_dispositivo, lecturas: d.sensores.map((id, k) => ({ id_sensor: id, ts: t.toISOString(), valor: [6, 1.2, 21, 80, 4][k] + Math.random() * 0.1 })), meta: { firmware: 'carga-cp27', rssi_dbm: -60 } };
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}/telemetria`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.token}` }, body: JSON.stringify(lote), signal: AbortSignal.timeout(30000) });
    await r.arrayBuffer();
    const ms = performance.now() - t0;
    lat.push(ms); estados[r.status] = (estados[r.status] ?? 0) + 1;
    if (r.status === 201) aceptados.add(lote.id_lote);
    const min = Math.floor((Date.now() - inicio) / 60000);
    const m = porMinuto.get(min) ?? { n: 0, suma: 0, max: 0, mal: 0 }; m.n++; m.suma += ms; m.max = Math.max(m.max, ms); if (r.status !== 201) m.mal++; porMinuto.set(min, m);
  } catch { errRed++; }
}
async function ciclo(d) {
  await new Promise((r) => setTimeout(r, Math.random() * 10000)); // arranque escalonado
  while (Date.now() < fin) { const t = Date.now(); await enviar(d); await new Promise((r) => setTimeout(r, Math.max(0, 10000 - (Date.now() - t)))); }
}
// despertar la API antes de medir
for (let i = 0; i < 10; i++) { const s = await fetch(`${API}/health`).then((r) => r.status).catch(() => 0); if (s === 200) break; await new Promise((r) => setTimeout(r, 10000)); }
const inicio = Date.now();
const vigia = setInterval(() => process.stdout.write(`[${Math.round((Date.now() - inicio) / 1000)} s] enviados ${lat.length + errRed}\n`), 60000);
await Promise.all(dispositivos.map(ciclo));
clearInterval(vigia);
const s = [...lat].sort((a, b) => a - b); const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]?.toFixed(0);
const total = lat.length + errRed; const seg = (Date.now() - inicio) / 1000;
const resumen = { dispositivos: dispositivos.length, duracion_s: Math.round(seg), solicitudes: total, por_segundo: +(total / seg).toFixed(2), lecturas_enviadas: total * 5, estados, errores_red: errRed,
  latencia_ms: { min: s[0]?.toFixed(0), p50: p(0.5), p90: p(0.9), p95: p(0.95), p99: p(0.99), max: s.at(-1)?.toFixed(0), media: (s.reduce((a, b) => a + b, 0) / s.length).toFixed(0) },
  por_minuto: [...porMinuto].map(([m, v]) => ({ minuto: m + 1, solicitudes: v.n, media_ms: Math.round(v.suma / v.n), max_ms: Math.round(v.max), no_201: v.mal })) };
fs.writeFileSync(new URL('./resultado.json', import.meta.url), JSON.stringify({ ...resumen, aceptados: [...aceptados] }));
console.log(JSON.stringify(resumen, null, 2));
