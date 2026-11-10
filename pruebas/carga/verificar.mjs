// Consistencia: lotes aceptados (201) = lotes en PostgreSQL = payloads en Neon; mediciones = 5 × lotes; sin duplicados.
import fs from 'node:fs';
import { supabase, neon, ARCHIVO } from './comun.mjs';
const { dispositivos } = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
const res = JSON.parse(fs.readFileSync(new URL('./resultado.json', import.meta.url), 'utf8'));
const ids = dispositivos.map((d) => d.id_dispositivo); const sens = dispositivos.flatMap((d) => d.sensores);
const c = supabase(); await c.connect(); const n = neon(); await n.connect();
// esperar a que el worker termine de procesar la cola de evaluación
for (let i = 0; i < 30; i++) {
  const p = (await c.query(`SELECT count(*)::int n FROM outbox_evaluacion o JOIN lote_ingesta l USING (id_lote) WHERE l.id_dispositivo = ANY($1) AND o.procesado_en IS NULL`, [ids]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
  if (p <= 0) break; await new Promise((r) => setTimeout(r, 5000));
}
const lotes = (await c.query(`SELECT count(*)::int n, sum(duplicados_recibidos)::int dup FROM lote_ingesta WHERE id_dispositivo = ANY($1)`, [ids])).rows[0];
const med = (await c.query(`SELECT count(*)::int n FROM medicion WHERE id_sensor = ANY($1)`, [sens])).rows[0].n;
const aceptadosEnBD = (await c.query(`SELECT count(*)::int n FROM lote_ingesta WHERE id_lote = ANY($1::uuid[])`, [res.aceptados])).rows[0].n;
const pay = (await n.query(`SELECT count(*)::int n FROM payload_telemetria WHERE id_dispositivo = ANY($1)`, [ids])).rows[0].n;
const ev = (await c.query(`SELECT tipo, count(*)::int n FROM evento WHERE id_dispositivo = ANY($1) GROUP BY 1`, [ids])).rows;
const out = { lotes_aceptados_201: res.aceptados.length, lotes_en_postgresql: lotes.n, aceptados_encontrados: aceptadosEnBD, duplicados: lotes.dup, mediciones: med, mediciones_esperadas: res.aceptados.length * 5, payloads_en_neon: pay, eventos: ev };
fs.writeFileSync(new URL('./consistencia.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await c.end(); await n.end();
