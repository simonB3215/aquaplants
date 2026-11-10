// Elimina la torre temporal de carga y TODO lo que generó (PostgreSQL y Neon). La auditoría se conserva.
import { supabase, neon, TORRE } from './comun.mjs';
const c = supabase(); await c.connect();
const inst = (await c.query(`SELECT id_instalacion FROM instalacion WHERE nombre = $1`, [TORRE])).rows[0]?.id_instalacion;
if (!inst) { console.log('No hay torre de carga'); process.exit(0); }
const ids = (await c.query(`SELECT id_dispositivo FROM dispositivo WHERE id_instalacion = $1`, [inst])).rows.map((r) => r.id_dispositivo);
const sens = (await c.query(`SELECT id_sensor FROM sensor WHERE id_dispositivo = ANY($1)`, [ids])).rows.map((r) => r.id_sensor);
await c.query('BEGIN');
const r = {};
r.alertas = (await c.query(`SELECT count(*)::int n FROM alerta WHERE id_sensor = ANY($1)`, [sens])).rows[0].n;
if (r.alertas) throw new Error('Hay alertas de la torre de carga: revisar antes de borrar');
r.outbox = (await c.query(`DELETE FROM outbox_evaluacion WHERE id_lote IN (SELECT id_lote FROM lote_ingesta WHERE id_dispositivo = ANY($1))`, [ids])).rowCount;
r.mediciones = (await c.query(`DELETE FROM medicion WHERE id_sensor = ANY($1)`, [sens])).rowCount;
r.umbrales = (await c.query(`DELETE FROM umbral WHERE id_sensor = ANY($1)`, [sens])).rowCount;
r.lotes = (await c.query(`DELETE FROM lote_ingesta WHERE id_dispositivo = ANY($1)`, [ids])).rowCount;
r.eventos = (await c.query(`DELETE FROM evento WHERE id_dispositivo = ANY($1)`, [ids])).rowCount;
r.sensores = (await c.query(`DELETE FROM sensor WHERE id_sensor = ANY($1)`, [sens])).rowCount;
r.dispositivos = (await c.query(`DELETE FROM dispositivo WHERE id_dispositivo = ANY($1)`, [ids])).rowCount;
r.instalacion = (await c.query(`DELETE FROM instalacion WHERE id_instalacion = $1`, [inst])).rowCount;
await c.query('COMMIT'); await c.end();
const n = neon(); await n.connect();
r.payloads_neon = (await n.query(`DELETE FROM payload_telemetria WHERE id_dispositivo = ANY($1)`, [ids])).rowCount;
await n.end();
console.log('Eliminado:', r);
