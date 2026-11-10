// CP-27 (D-35). Crea una torre temporal con 50 dispositivos × 5 sensores (sin umbrales: no generan alertas ni correos).
import fs from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { supabase, TORRE, ARCHIVO } from './comun.mjs';
const N = Number(process.argv[2] ?? 50);
const c = supabase();
await c.connect();
await c.query('BEGIN');
const ya = await c.query(`SELECT 1 FROM instalacion WHERE nombre = $1`, [TORRE]);
if (ya.rowCount) { console.error('La torre de carga ya existe: ejecute limpiar.mjs primero'); process.exit(1); }
const inst = (await c.query(`INSERT INTO instalacion (nombre, tipo, ubicacion) VALUES ($1,'aeroponica','Prueba de carga — se elimina al terminar') RETURNING id_instalacion`, [TORRE])).rows[0].id_instalacion;
const tipos = (await c.query(`SELECT id_tipo_variable, clave FROM tipo_variable WHERE clave IN ('ph','ce','temperatura','nivel','caudal') ORDER BY id_tipo_variable`)).rows;
const out = [];
for (let i = 1; i <= N; i++) {
  const token = randomBytes(32).toString('base64url');
  const d = (await c.query(`INSERT INTO dispositivo (id_instalacion, nombre, credencial_hash, intervalo_muestreo_s) VALUES ($1,$2,$3,10) RETURNING id_dispositivo`,
    [inst, `Carga-${String(i).padStart(2, '0')}`, createHash('sha256').update(token, 'utf8').digest('hex')])).rows[0].id_dispositivo;
  const sensores = [];
  for (const t of tipos) sensores.push((await c.query(`INSERT INTO sensor (id_dispositivo, id_tipo_variable) VALUES ($1,$2) RETURNING id_sensor`, [d, t.id_tipo_variable])).rows[0].id_sensor);
  out.push({ id_dispositivo: d, token, sensores });
}
await c.query(`INSERT INTO log_auditoria (accion, entidad, id_entidad, detalle) VALUES ('prueba_carga','instalacion',$1,$2)`,
  [String(inst), JSON.stringify({ caso: 'CP-27', dispositivos: N, nota: 'torre temporal; se elimina al terminar' })]);
await c.query('COMMIT');
await c.end();
fs.writeFileSync(ARCHIVO, JSON.stringify({ id_instalacion: inst, dispositivos: out }));
console.log(`Torre ${inst} con ${N} dispositivos creada (ids ${out[0].id_dispositivo}–${out.at(-1).id_dispositivo})`);
