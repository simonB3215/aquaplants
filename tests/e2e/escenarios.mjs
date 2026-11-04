/**
 * Prueba E2E de los escenarios A–G (prompt §21 / ES2 CC-04, CC-10, CC-11) contra el
 * stack REAL en ejecución: API + PostgreSQL + MongoDB + worker + simulador.
 *   node tests/e2e/escenarios.mjs [http://localhost:3000/api/v1]
 * Requiere DEMO_MODE=true. Guarda la evidencia en docs/evidencias/escenarios-e2e.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
const API = process.argv[2] ?? 'http://localhost:3000/api/v1';
const ADMIN = { email: process.env.E2E_ADMIN ?? 'admin@aquaplants.cl', password: process.env.E2E_ADMIN_PASS ?? 'AdminAqua2026' };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
let token;
async function llamar(metodo, ruta, cuerpo) {
  const r = await fetch(API + ruta, { method: metodo, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
function registrar(id, descripcion, ok, evidencia) {
  resultados.push({ id, descripcion, resultado: ok ? 'APROBADA' : 'FALLIDA', evidencia, ts: new Date().toISOString() });
  console.log(`${ok ? '✔' : '✖'} ${id} ${descripcion}`);
}
const disp = async (id) => (await llamar('GET', '/demo/estado')).body.simulador.dispositivos.find((d) => d.id_dispositivo === id);
const cont = async () => (await llamar('GET', '/continuidad')).body;

token = (await llamar('POST', '/auth/login', ADMIN)).body.token;
const ID = 2; // AquaBrain-B

// A
await llamar('POST', '/demo/escenarios/A', { id_dispositivo: ID });
const antes = (await llamar('GET', '/continuidad')).body.dispositivos.find((d) => d.id_dispositivo === ID);
await espera(25_000);
const despues = (await llamar('GET', '/continuidad')).body.dispositivos.find((d) => d.id_dispositivo === ID);
registrar('A', 'Operación normal: mediciones reales llegan a la API', despues.conectividad === 'conectado' && despues.ultima_comunicacion !== antes.ultima_comunicacion, { antes: antes.ultima_comunicacion, despues: despues.ultima_comunicacion });

// B
const alertasAntes = (await llamar('GET', '/alertas?estado=activa&por_pagina=100')).body.total;
const b = await llamar('POST', '/demo/escenarios/B', { id_dispositivo: ID });
await espera(6000);
const al = (await llamar('GET', '/alertas?estado=activa&por_pagina=100')).body;
const nueva = al.datos.find((a) => a.id_sensor === b.body.id_sensor);
registrar('B', 'Valor fuera de umbral crea alerta (una por situación)', !!nueva && al.total >= alertasAntes, { alerta: nueva && { id: nueva.id_alerta, severidad: nueva.severidad, valor: nueva.valor, ocurrencias: nueva.ocurrencias } });

// C
await llamar('POST', '/demo/escenarios/C', { id_dispositivo: ID });
await espera(35_000);
const dC = await disp(ID);
const cC = (await cont()).dispositivos.find((d) => d.id_dispositivo === ID);
registrar('C', 'Corte de Internet: lotes en cola local persistente y servidor marca «sin señal» (causa desconocida)', dC.cola_lotes > 0 && cC.conectividad === 'sin_senal', { cola_lotes: dC.cola_lotes, cola_bytes: dC.cola_bytes, conectividad_servidor: cC.conectividad });
const enCola = dC.cola_lotes;

// E (con la red aún cortada: corte eléctrico + router)
// El corte debe superar 3 × intervalo de muestreo (umbral de «hueco» del histórico): 35 s con intervalo de 10 s.
const tApagado = Date.now();
await llamar('POST', '/demo/escenarios/E', { id_dispositivo: ID });
await espera(35_000);
const dE = await disp(ID);
registrar('E', 'Corte eléctrico: no se generan mediciones; la cola en disco se conserva', !dE.energia && dE.cola_lotes >= enCola, { energia: dE.energia, cola_lotes: dE.cola_lotes });
const colaApagado = dE.cola_lotes;

// F (vuelve la energía, red aún cortada) y D (vuelve la red)
const tEncendido = Date.now();
await llamar('POST', '/demo/escenarios/F', { id_dispositivo: ID });
await espera(3000);
const dF = await disp(ID);
registrar('F', 'Reinicio: reabre la cola persistida desde disco', dF.energia && dF.cola_lotes >= colaApagado, { cola_lotes_tras_reinicio: dF.cola_lotes, cola_al_apagar: colaApagado });
const d = await llamar('POST', '/demo/escenarios/D', { id_dispositivo: ID });
await espera(8000);
const dD = await disp(ID);
const cD = await cont();
const evs = (await llamar('GET', `/eventos?dispositivo=${ID}&por_pagina=30`)).body.datos.map((e) => e.tipo);
registrar(
  'D',
  'Reconexión: sincroniza pendientes sin duplicados (reenvío deliberado → duplicado)',
  dD.cola_lotes === 0 && d.body.reenvio?.duplicado === true && evs.includes('reconexion') && evs.includes('reinicio') && evs.includes('sin_senal'),
  { cola_final: dD.cola_lotes, reenvio: d.body.reenvio, lotes_recuperados_24h: cD.lotes_recuperados_24h, eventos: evs.slice(0, 10) },
);

// Huecos del corte eléctrico visibles en el histórico (sin valores inventados)
const sensor = b.body.id_sensor;
const h = await llamar('GET', `/mediciones/historico?sensor=${sensor}&desde=${new Date(Date.now() - 15 * 60_000).toISOString()}&hasta=${new Date().toISOString()}`);
// Solo cuenta un hueco que se solape con el periodo real sin energía (evita falsos positivos por otros huecos).
const huecoDelCorte = h.body.huecos.find((x) => Date.parse(x.desde) <= tEncendido && Date.parse(x.hasta) >= tApagado);
registrar('E/F', 'El periodo sin energía aparece como hueco en el histórico', !!huecoDelCorte, {
  sin_energia: { desde: new Date(tApagado).toISOString(), hasta: new Date(tEncendido).toISOString() },
  hueco: huecoDelCorte ?? null,
  huecos: h.body.huecos,
});

// G
const g = await llamar('POST', '/demo/escenarios/G');
registrar('G', 'Encargado intenta crear un usuario → 403', g.body.status === 403, g.body);

await llamar('POST', '/demo/escenarios/A', { id_dispositivo: ID });
mkdirSync(new URL('../../docs/evidencias/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../docs/evidencias/escenarios-e2e.json', import.meta.url), JSON.stringify({ api: API, ejecutado_en: new Date().toISOString(), resultados }, null, 2));
process.exit(resultados.every((r) => r.resultado === 'APROBADA') ? 0 : 1);
