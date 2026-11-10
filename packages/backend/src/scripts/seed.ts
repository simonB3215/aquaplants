import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { generarTokenDispositivo, hashToken } from '../services/authService.js';
import { resolverCertificado } from '../conexion.js';

/**
 * Datos de prueba REPRODUCIBLES (solo desarrollo/demostración).
 * - Catálogos de variables y especies con rangos de referencia.
 * - 3 torres, 3 dispositivos AquaBrain, sensores, umbrales y cultivos.
 * - 4 usuarios de prueba (contraseñas de desarrollo, ver README).
 * - Historial sintético opcional (lote_ingesta.origen = 'seed', identificado como tal).
 * Escribe las credenciales de los dispositivos SOLO en el archivo local del simulador
 * (packages/simulador/data/dispositivos.json, ignorado por git).
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));

/** PRNG determinista (mulberry32) para que el historial sea reproducible. */
function prng(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIPOS = [
  { clave: 'ph', nombre: 'pH', unidad: 'pH', min: 0, max: 14, delta: 2 },
  { clave: 'ce', nombre: 'Conductividad eléctrica', unidad: 'mS/cm', min: 0, max: 10, delta: 1.5 },
  { clave: 'temperatura', nombre: 'Temperatura del agua', unidad: '°C', min: -10, max: 60, delta: 5 },
  { clave: 'nivel', nombre: 'Nivel de agua', unidad: '%', min: 0, max: 100, delta: 25 },
  { clave: 'humedad', nombre: 'Humedad relativa', unidad: '%', min: 0, max: 100, delta: 25 },
  // D-35 (migración 011): variables que menciona la empresa.
  { clave: 'caudal', nombre: 'Caudal de riego', unidad: 'L/min', min: 0, max: 30, delta: 10 },
  { clave: 'consumo_hidrico', nombre: 'Consumo hídrico', unidad: 'L/día', min: 0, max: 500, delta: 100 },
  { clave: 'fotoperiodo', nombre: 'Fotoperiodo', unidad: 'h/día', min: 0, max: 24, delta: 24 },
] as const;
type Clave = (typeof TIPOS)[number]['clave'];

const ESPECIES: { nombre: string; descripcion: string; rangos: Partial<Record<Clave, [number, number]>> }[] = [
  { nombre: 'Lechuga', descripcion: 'Lactuca sativa', rangos: { ph: [5.6, 6.2], ce: [0.8, 1.2], temperatura: [18, 22], nivel: [40, 95], humedad: [50, 70], caudal: [2, 6], consumo_hidrico: [15, 40], fotoperiodo: [12, 16] } },
  { nombre: 'Albahaca', descripcion: 'Ocimum basilicum', rangos: { ph: [5.5, 6.5], ce: [1.0, 1.6], temperatura: [20, 25], nivel: [40, 95], humedad: [40, 60], caudal: [2, 6], consumo_hidrico: [15, 45], fotoperiodo: [14, 16] } },
  { nombre: 'Frutilla', descripcion: 'Fragaria × ananassa', rangos: { ph: [5.5, 6.2], ce: [1.0, 1.4], temperatura: [18, 24], nivel: [40, 95], humedad: [60, 75], caudal: [2, 6], consumo_hidrico: [20, 50], fotoperiodo: [12, 16] } },
  { nombre: 'Espinaca', descripcion: 'Spinacia oleracea', rangos: { ph: [6.0, 7.0], ce: [1.8, 2.3], temperatura: [16, 21], nivel: [40, 95] } },
  { nombre: 'Rúcula', descripcion: 'Eruca vesicaria', rangos: { ph: [6.0, 6.8], ce: [0.8, 1.2], temperatura: [16, 22], nivel: [40, 95] } },
];
/** Margen para el umbral crítico respecto del advertencia (ancho del rango de referencia). */
const CRITICO_EXTRA: Record<Clave, number> = { ph: 0.5, ce: 0.4, temperatura: 4, nivel: 20, humedad: 15, caudal: 1.5, consumo_hidrico: 15, fotoperiodo: 2 };

const TORRES = [
  { nombre: 'Torre A · Lechuga', tipo: 'aeroponica', ubicacion: 'Invernadero 1, fila norte', especie: 'Lechuga', sensores: ['ph', 'ce', 'temperatura', 'nivel', 'humedad', 'caudal', 'consumo_hidrico', 'fotoperiodo'] as Clave[] },
  { nombre: 'Torre B · Albahaca', tipo: 'hidroponica', ubicacion: 'Invernadero 1, fila sur', especie: 'Albahaca', sensores: ['ph', 'ce', 'temperatura', 'nivel', 'caudal', 'consumo_hidrico', 'fotoperiodo'] as Clave[] },
  { nombre: 'Torre C · Frutilla', tipo: 'aeroponica', ubicacion: 'Invernadero 2', especie: 'Frutilla', sensores: ['ph', 'ce', 'temperatura', 'nivel', 'caudal', 'consumo_hidrico', 'fotoperiodo'] as Clave[] },
];

export async function sembrar(url: string, opciones: { historialHoras?: number; intervaloS?: number; simConfig?: string; silencioso?: boolean } = {}) {
  const log = opciones.silencioso ? () => undefined : console.log;
  const intervalo = opciones.intervaloS ?? Number(process.env.SEED_INTERVALO_S ?? 60);
  const historialHoras = opciones.historialHoras ?? Number(process.env.SEED_HISTORIAL_HORAS ?? 48);
  const pwd = {
    administrador: process.env.SEED_PASSWORD_ADMIN ?? 'AdminAqua2026',
    supervisor: process.env.SEED_PASSWORD_SUPERVISOR ?? 'SuperAqua2026',
    encargado: process.env.SEED_PASSWORD_ENCARGADO ?? 'EncargadoAqua2026',
  };
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const ya = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM usuario');
    if (ya.rows[0].n > 0) {
      log('[seed] la base ya tiene usuarios: no se siembra de nuevo (use npm run db:migrate -- --reset en desarrollo).');
      return null;
    }
    await c.query('BEGIN');
    await c.query(`INSERT INTO rol (nombre, descripcion) VALUES
      ('encargado','Encargado de cultivo: monitorea sus torres asignadas'),
      ('supervisor','Supervisor: revisa, compara, exporta y resuelve alertas críticas'),
      ('administrador','Administrador: gestiona usuarios, infraestructura, umbrales y auditoría')`);
    const tipoId: Record<string, number> = {};
    for (const t of TIPOS) {
      const r = await c.query<{ id: number }>(
        `INSERT INTO tipo_variable (nombre, clave, unidad_medida, min_fisico, max_fisico, max_delta_minuto) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id_tipo_variable AS id`,
        [t.nombre, t.clave, t.unidad, t.min, t.max, t.delta],
      );
      tipoId[t.clave] = r.rows[0].id;
    }
    const especieId: Record<string, number> = {};
    for (const e of ESPECIES) {
      const r = await c.query<{ id: number }>(`INSERT INTO especie (nombre, descripcion) VALUES ($1,$2) RETURNING id_especie AS id`, [e.nombre, e.descripcion]);
      especieId[e.nombre] = r.rows[0].id;
      for (const [k, [mn, mx]] of Object.entries(e.rangos)) {
        await c.query(`INSERT INTO rango_referencia (id_especie, id_tipo_variable, valor_min, valor_max) VALUES ($1,$2,$3,$4)`, [r.rows[0].id, tipoId[k], mn, mx]);
      }
    }
    const usuarios = [
      { nombre: 'Ana Administradora', email: 'admin@aquaplants.cl', rol: 'administrador', pass: pwd.administrador, torres: [] as number[] },
      { nombre: 'Sergio Supervisor', email: 'supervisor@aquaplants.cl', rol: 'supervisor', pass: pwd.supervisor, torres: [] },
      { nombre: 'Elena Encargada', email: 'encargado@aquaplants.cl', rol: 'encargado', pass: pwd.encargado, torres: [0, 1] },
      { nombre: 'Tomás Encargado', email: 'encargado2@aquaplants.cl', rol: 'encargado', pass: pwd.encargado, torres: [2] },
    ];
    const torreIds: number[] = [];
    for (const t of TORRES) {
      const r = await c.query<{ id: number }>(`INSERT INTO instalacion (nombre, tipo, ubicacion) VALUES ($1,$2,$3) RETURNING id_instalacion AS id`, [t.nombre, t.tipo, t.ubicacion]);
      torreIds.push(r.rows[0].id);
    }
    let idAdmin = 0;
    for (const u of usuarios) {
      const hash = await bcrypt.hash(u.pass, 10);
      const r = await c.query<{ id: number }>(
        `INSERT INTO usuario (nombre, email, hash_password, id_rol, debe_cambiar_password, aviso_alertas)
         VALUES ($1,$2,$3,(SELECT id_rol FROM rol WHERE nombre=$4), false,
                 CASE WHEN $4 = 'administrador' THEN 'ninguna' ELSE 'todas' END) RETURNING id_usuario AS id`,
        [u.nombre, u.email, hash, u.rol],
      );
      if (u.rol === 'administrador') idAdmin = r.rows[0].id;
      for (const ti of u.torres) await c.query(`INSERT INTO usuario_instalacion (id_usuario, id_instalacion) VALUES ($1,$2)`, [r.rows[0].id, torreIds[ti]]);
    }

    const simDispositivos: { id_dispositivo: number; nombre: string; torre: string; token: string; intervalo_s: number; sensores: { id_sensor: number; clave: Clave; base: number; amplitud: number }[] }[] = [];
    const sensoresHist: { id: number; clave: Clave; base: number; amp: number; idDisp: number }[] = [];
    for (const [i, t] of TORRES.entries()) {
      const token = generarTokenDispositivo();
      const nombreDisp = `AquaBrain-${String.fromCharCode(65 + i)}`;
      const d = await c.query<{ id: number }>(
        `INSERT INTO dispositivo (id_instalacion, nombre, credencial_hash, intervalo_muestreo_s) VALUES ($1,$2,$3,$4) RETURNING id_dispositivo AS id`,
        [torreIds[i], nombreDisp, hashToken(token), intervalo],
      );
      await c.query(`INSERT INTO evento (id_dispositivo, tipo, descripcion) VALUES ($1,'alta','Dispositivo registrado (seed)')`, [d.rows[0].id]);
      const esp = ESPECIES.find((e) => e.nombre === t.especie)!;
      const sens: (typeof simDispositivos)[number]['sensores'] = [];
      for (const k of t.sensores) {
        const s = await c.query<{ id: number }>(`INSERT INTO sensor (id_dispositivo, id_tipo_variable) VALUES ($1,$2) RETURNING id_sensor AS id`, [d.rows[0].id, tipoId[k]]);
        const [mn, mx] = esp.rangos[k]!;
        const tipo = TIPOS.find((x) => x.clave === k)!;
        await c.query(`INSERT INTO umbral (id_sensor, valor_min, valor_max, severidad) VALUES ($1,$2,$3,'advertencia')`, [s.rows[0].id, mn, mx]);
        await c.query(`INSERT INTO umbral (id_sensor, valor_min, valor_max, severidad) VALUES ($1,$2,$3,'critica')`, [
          s.rows[0].id,
          Math.max(tipo.min, +(mn - CRITICO_EXTRA[k]).toFixed(2)),
          Math.min(tipo.max, +(mx + CRITICO_EXTRA[k]).toFixed(2)),
        ]);
        const base = +((mn + mx) / 2).toFixed(2);
        const amplitud = +((mx - mn) / 5).toFixed(3);
        sens.push({ id_sensor: s.rows[0].id, clave: k, base, amplitud });
        sensoresHist.push({ id: s.rows[0].id, clave: k, base, amp: amplitud, idDisp: d.rows[0].id });
      }
      await c.query(`INSERT INTO cultivo (id_instalacion, id_especie, fecha_inicio, creado_por) VALUES ($1,$2,(current_date - 21),$3)`, [
        torreIds[i],
        especieId[t.especie],
        idAdmin,
      ]);
      simDispositivos.push({ id_dispositivo: d.rows[0].id, nombre: nombreDisp, torre: t.nombre, token, intervalo_s: intervalo, sensores: sens });
    }
    await c.query(`INSERT INTO log_auditoria (id_usuario, accion, entidad, detalle) VALUES ($1, 'seed', 'sistema', $2)`, [
      idAdmin,
      JSON.stringify({ nota: 'Carga inicial de datos de prueba reproducibles', historial_horas: historialHoras }),
    ]);

    // Historial sintético identificado (origen = 'seed'), con el mismo intervalo de muestreo
    // del dispositivo (así no aparecen falsos «huecos»), hasta 10 min antes de ahora.
    if (historialHoras > 0) {
      const rnd = prng(20261103);
      const paso = Math.max(intervalo, 10) * 1000;
      const fin = Math.floor((Date.now() - 10 * 60_000) / paso) * paso;
      const inicio = fin - historialHoras * 3600_000;
      for (const disp of simDispositivos) {
        const sens = sensoresHist.filter((s) => s.idDisp === disp.id_dispositivo);
        const tsArr: string[] = [];
        const idArr: number[] = [];
        const valArr: number[] = [];
        for (let t = inicio; t <= fin; t += paso) {
          const dia = Math.sin(((t / 3600_000) % 24) / 24 * 2 * Math.PI);
          for (const s of sens) {
            const ruido = (rnd() - 0.5) * s.amp;
            const v =
              s.clave === 'nivel'
                ? 85 - ((t - inicio) / 3600_000) % 24 * 1.2 + ruido * 4
                : s.clave === 'fotoperiodo'
                  ? s.base + ruido * 0.1 // programado: casi constante
                  : s.base + dia * s.amp * 1.5 + ruido;
            tsArr.push(new Date(t).toISOString());
            idArr.push(s.id);
            valArr.push(+v.toFixed(3));
          }
        }
        const idLote = randomUUID();
        await c.query(
          `INSERT INTO lote_ingesta (id_lote, id_dispositivo, lecturas, ts_min, ts_max, origen) VALUES ($1,$2,$3,$4,$5,'seed')`,
          [idLote, disp.id_dispositivo, tsArr.length, new Date(inicio).toISOString(), new Date(fin).toISOString()],
        );
        await c.query(
          `INSERT INTO medicion (ts, id_sensor, valor, id_lote) SELECT * , $4::uuid FROM unnest($1::timestamptz[], $2::int[], $3::float8[])`,
          [tsArr, idArr, valArr, idLote],
        );
        await c.query(`UPDATE dispositivo SET ultima_lectura_ts = $2 WHERE id_dispositivo = $1`, [disp.id_dispositivo, new Date(fin).toISOString()]);
      }
    }
    await c.query('COMMIT');

    const destino = opciones.simConfig ?? process.env.SIM_CONFIG_PATH ?? path.resolve(aqui, '../../../simulador/data/dispositivos.json');
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, JSON.stringify({ generado_en: new Date().toISOString(), aviso: 'Credenciales de desarrollo. No versionar.', dispositivos: simDispositivos }, null, 2), {
      mode: 0o600,
    });
    log(`[seed] listo. Credenciales de dispositivos escritas en ${destino}`);
    log('[seed] usuarios de prueba: admin@aquaplants.cl, supervisor@aquaplants.cl, encargado@aquaplants.cl (torres A y B), encargado2@aquaplants.cl (torre C)');
    return { torres: torreIds, dispositivos: simDispositivos, passwords: pwd };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

const esPrincipal = process.argv[1] && /seed\.(t|j)s$/.test(process.argv[1]);
if (esPrincipal) {
  const url = resolverCertificado(process.env.DATABASE_URL);
  if (!url) {
    console.error('Defina DATABASE_URL');
    process.exit(1);
  }
  sembrar(url, { historialHoras: process.argv.includes('--sin-historial') ? 0 : undefined }).catch((e) => {
    console.error('[seed]', e.message);
    process.exit(1);
  });
}
