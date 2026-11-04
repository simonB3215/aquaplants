import { granularidadPara, type PuntoSerie, type RespuestaComparar, type RespuestaHistorico, type Severidad } from '@aquaplants/shared';
import type { IBaseDatos } from '../ports/index.js';
import { NoAutorizadoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import { exigirAccesoTorre, torreDeSensor, torresVisibles, type UsuarioCtx } from './acceso.js';

const MAX_PUNTOS = 1000;

/** Segundos de cubeta: la granularidad del CU-05 o la necesaria para no superar ~1.000 puntos. */
function cubetaSegundos(desde: Date, hasta: Date): { etiqueta: string; segundos: number } {
  const g = granularidadPara(desde, hasta);
  const rango = (hasta.getTime() - desde.getTime()) / 1000;
  const minimo = Math.ceil(rango / MAX_PUNTOS);
  if (g.segundos === 0) return minimo <= 60 ? { etiqueta: 'crudo', segundos: 0 } : { etiqueta: `${Math.ceil(minimo / 60)} min`, segundos: Math.ceil(minimo / 60) * 60 };
  return g.segundos >= minimo ? g : { etiqueta: `${Math.ceil(minimo / 60)} min`, segundos: Math.ceil(minimo / 60) * 60 };
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/** CU-05 Consultar históricos y CU-06 Comparar/Exportar. Agregación en la base de datos. */
export class HistoricoService {
  constructor(private readonly db: IBaseDatos) {}

  async historico(u: UsuarioCtx, idSensor: number, desde: Date, hasta: Date): Promise<RespuestaHistorico> {
    const idTorre = await torreDeSensor(this.db, idSensor);
    await exigirAccesoTorre(this.db, u, idTorre);
    const info = await this.db.query<{ tipo_variable: string; unidad: string; torre: string; intervalo: number }>(
      `SELECT tv.nombre AS tipo_variable, tv.unidad_medida AS unidad, i.nombre AS torre, d.intervalo_muestreo_s AS intervalo
         FROM sensor s JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
         JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo JOIN instalacion i ON i.id_instalacion = d.id_instalacion
        WHERE s.id_sensor = $1`,
      [idSensor],
    );
    const g = cubetaSegundos(desde, hasta);
    const puntos = await this.serie([idSensor], desde, hasta, g.segundos);
    const umbrales = await this.db.query<{ severidad: Severidad; valor_min: number; valor_max: number }>(
      `SELECT severidad, valor_min, valor_max FROM umbral WHERE id_sensor = $1 AND activo ORDER BY severidad`,
      [idSensor],
    );
    // Huecos: periodos sin lecturas mayores a 3 intervalos (p. ej. corte eléctrico). No se inventan valores.
    const huecos = await this.db.query<{ desde: Date; hasta: Date }>(
      `SELECT prev AS desde, ts AS hasta FROM (
         SELECT ts, lag(ts) OVER (ORDER BY ts) AS prev FROM medicion WHERE id_sensor = $1 AND ts BETWEEN $2 AND $3
       ) x WHERE prev IS NOT NULL AND ts - prev > make_interval(secs => $4) ORDER BY ts LIMIT 200`,
      [idSensor, desde, hasta, info.rows[0].intervalo * 3],
    );
    return {
      sensor: { id_sensor: idSensor, id_instalacion: idTorre, tipo_variable: info.rows[0].tipo_variable, unidad: info.rows[0].unidad, torre: info.rows[0].torre },
      granularidad: g.etiqueta,
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      umbrales: umbrales.rows,
      puntos,
      huecos: huecos.rows.map((h) => ({ desde: iso(h.desde), hasta: iso(h.hasta) })),
    };
  }

  private async serie(sensores: number[], desde: Date, hasta: Date, segundos: number): Promise<PuntoSerie[]> {
    if (segundos === 0) {
      const r = await this.db.query<{ t: Date; v: number }>(
        `SELECT ts AS t, valor AS v FROM medicion WHERE id_sensor = ANY($1::int[]) AND ts BETWEEN $2 AND $3 ORDER BY ts LIMIT 5000`,
        [sensores, desde, hasta],
      );
      return r.rows.map((x) => ({ t: iso(x.t), promedio: x.v, minimo: x.v, maximo: x.v, n: 1 }));
    }
    // date_bin funciona en PostgreSQL 14+ con o sin TimescaleDB (equivalente a time_bucket).
    const r = await this.db.query<{ t: Date; promedio: number; minimo: number; maximo: number; n: number }>(
      `SELECT date_bin(make_interval(secs => $4), ts, TIMESTAMPTZ '2000-01-01') AS t,
              avg(valor) AS promedio, min(valor) AS minimo, max(valor) AS maximo, count(*)::int AS n
         FROM medicion WHERE id_sensor = ANY($1::int[]) AND ts BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`,
      [sensores, desde, hasta, segundos],
    );
    return r.rows.map((x) => ({ t: iso(x.t), promedio: Number(x.promedio), minimo: x.minimo, maximo: x.maximo, n: x.n }));
  }

  async comparar(u: UsuarioCtx, idTipo: number, torres: number[], desde: Date, hasta: Date): Promise<RespuestaComparar> {
    const tipo = await this.db.query<{ id_tipo_variable: number; nombre: string; unidad: string }>(
      `SELECT id_tipo_variable, nombre, unidad_medida AS unidad FROM tipo_variable WHERE id_tipo_variable = $1`,
      [idTipo],
    );
    if (!tipo.rows[0]) throw new NoEncontradoError('Tipo de variable no encontrado');
    await this.verificarTorres(u, torres);
    const g = cubetaSegundos(desde, hasta);
    // La misma granularidad para todas las series (condición de comparabilidad).
    const seg = g.segundos === 0 ? 60 : g.segundos;
    const series: RespuestaComparar['series'] = [];
    const sin_datos: RespuestaComparar['sin_datos'] = [];
    for (const idT of torres) {
      const r = await this.db.query<{ id_sensor: number; torre: string }>(
        `SELECT s.id_sensor, i.nombre AS torre FROM instalacion i
           LEFT JOIN dispositivo d ON d.id_instalacion = i.id_instalacion
           LEFT JOIN sensor s ON s.id_dispositivo = d.id_dispositivo AND s.id_tipo_variable = $2
          WHERE i.id_instalacion = $1`,
        [idT, idTipo],
      );
      if (!r.rows[0]) throw new NoEncontradoError(`Torre ${idT} no encontrada`);
      const sensores = r.rows.map((x) => x.id_sensor).filter((x): x is number => x != null);
      const puntos = sensores.length ? await this.serie(sensores, desde, hasta, seg) : [];
      if (puntos.length) series.push({ id_instalacion: idT, torre: r.rows[0].torre, puntos });
      else sin_datos.push({ id_instalacion: idT, torre: r.rows[0].torre });
    }
    return { tipo_variable: tipo.rows[0], granularidad: g.segundos === 0 ? '1 min' : g.etiqueta, series, sin_datos };
  }

  private async verificarTorres(u: UsuarioCtx, torres: number[]) {
    const vis = await torresVisibles(this.db, u);
    if (vis && torres.some((t) => !vis.includes(t))) throw new NoAutorizadoError('Incluye torres no asignadas', 'TORRE_NO_ASIGNADA');
  }

  /**
   * Exporta a CSV en streaming por lotes (keyset), UTF-8, separador «;».
   * La exportación se audita ANTES de la descarga (quién, filtros y filas).
   */
  async exportar(
    u: UsuarioCtx,
    f: { torres: number[]; tipo_variable?: number; desde: Date; hasta: Date },
    escribir: (chunk: string) => Promise<void> | void,
  ): Promise<number> {
    await this.verificarTorres(u, f.torres);
    const params = [f.torres, f.tipo_variable ?? null, f.desde, f.hasta];
    const base = `FROM medicion m JOIN sensor s ON s.id_sensor = m.id_sensor
                  JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
                  JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
                  JOIN instalacion i ON i.id_instalacion = d.id_instalacion
                 WHERE i.id_instalacion = ANY($1::int[]) AND ($2::int IS NULL OR s.id_tipo_variable = $2)
                   AND m.ts BETWEEN $3 AND $4`;
    const total = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params);
    const filas = total.rows[0].n;
    if (filas === 0) throw new ReglaNegocioError('No existen mediciones para el período seleccionado');
    await this.db.transaccion((tx) =>
      auditar(tx, u, 'exportar_csv', 'medicion', null, {
        torres: f.torres,
        tipo_variable: f.tipo_variable ?? null,
        desde: f.desde.toISOString(),
        hasta: f.hasta.toISOString(),
        filas,
      }),
    );
    await escribir('﻿fecha_hora;torre;dispositivo;variable;valor;unidad\n');
    let cursorTs: Date | null = null;
    let cursorId = '0';
    const csv = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (;;) {
      const r: { rows: { id_medicion: string; ts: Date; torre: string; dispositivo: string; variable: string; valor: number; unidad: string }[] } =
        await this.db.query(
          `SELECT m.id_medicion, m.ts, i.nombre AS torre, d.nombre AS dispositivo, tv.nombre AS variable, m.valor, tv.unidad_medida AS unidad
           ${base} AND ($5::timestamptz IS NULL OR (m.ts, m.id_medicion) > ($5::timestamptz, $6::bigint))
           ORDER BY m.ts, m.id_medicion LIMIT 5000`,
          [...params, cursorTs, cursorId],
        );
      if (r.rows.length === 0) break;
      await escribir(
        r.rows.map((x) => [x.ts.toISOString(), csv(x.torre), csv(x.dispositivo), csv(x.variable), String(x.valor), csv(x.unidad)].join(';')).join('\n') + '\n',
      );
      const ult = r.rows[r.rows.length - 1];
      cursorTs = ult.ts;
      cursorId = ult.id_medicion;
    }
    return filas;
  }
}
