import { LoteSchema, type EventoOperativo, type Paginado, type ResumenContinuidad } from '@aquaplants/shared';
import type { IBaseDatos, IPayloadStore } from '../ports/index.js';
import type { Config } from '../config.js';
import { registrarEvento } from './auditoria.js';
import { conectividad } from './estadoService.js';
import { torresVisibles, type UsuarioCtx } from './acceso.js';
import type { IngestaService } from './ingestaService.js';

const SELECT_EVENTO = `
  SELECT e.id_evento, e.id_dispositivo, d.nombre AS dispositivo, i.nombre AS torre, e.tipo, e.descripcion, e.origen, e.detalle, e.ts
    FROM evento e JOIN dispositivo d ON d.id_dispositivo = e.id_dispositivo JOIN instalacion i ON i.id_instalacion = d.id_instalacion`;

const aIso = (e: EventoOperativo): EventoOperativo => {
  const ts = e.ts as unknown;
  return { ...e, id_evento: Number(e.id_evento), ts: ts instanceof Date ? ts.toISOString() : String(ts) };
};

/** Continuidad operativa: «sin señal» (RN-04), reconciliación MongoDB ↔ PostgreSQL y panel. */
export class ContinuidadService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly payloads: IPayloadStore,
    private readonly cfg: Config,
  ) {}

  /**
   * Marca «sin señal» a los dispositivos activos sin comunicación por más de
   * SIN_SENAL_FACTOR × intervalo. La causa se registra como DESCONOCIDA: la sola
   * ausencia de datos no permite distinguir corte eléctrico, falla de red o del equipo.
   */
  async detectarSinSenal(): Promise<number> {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ id_dispositivo: number; ultima_comunicacion: Date; limite: number }>(
        `UPDATE dispositivo SET estado = 'sin_senal'
          WHERE estado = 'activo' AND ultima_comunicacion IS NOT NULL
            AND ultima_comunicacion < now() - make_interval(secs => intervalo_muestreo_s * $1::float8)
        RETURNING id_dispositivo, ultima_comunicacion, (intervalo_muestreo_s * $1::float8)::int AS limite`,
        [this.cfg.SIN_SENAL_FACTOR],
      );
      for (const d of r.rows) {
        await registrarEvento(
          tx,
          d.id_dispositivo,
          'sin_senal',
          `Sin comunicaciones por más de ${d.limite} s. Causa desconocida (no es posible distinguir entre falla de Internet, corte eléctrico o falla del equipo).`,
          { ultima_comunicacion: d.ultima_comunicacion.toISOString(), umbral_s: d.limite, causa: 'desconocida' },
        );
      }
      return r.rows.length;
    });
  }

  /** Reconciliación cada 5 min: documentos «recibido» con más de 2 min (sección 3.2). */
  async reconciliar(ingesta: IngestaService): Promise<{ marcados: number; reprocesados: number }> {
    const docs = await this.payloads.recibidosSinProcesar(2, 200);
    let marcados = 0;
    let reprocesados = 0;
    for (const d of docs) {
      const existe = await this.db.query(`SELECT 1 FROM lote_ingesta WHERE id_lote = $1`, [d.id_lote]);
      if (existe.rowCount) {
        await this.payloads.marcarProcesado(d.id_lote);
        marcados++;
        continue;
      }
      const lote = LoteSchema.safeParse(d.payload);
      if (!lote.success) continue;
      try {
        await ingesta.reprocesar(d.id_dispositivo, lote.data);
        reprocesados++;
      } catch (e) {
        console.warn('[reconciliación] no se pudo reprocesar', d.id_lote, (e as Error).message);
      }
    }
    return { marcados, reprocesados };
  }

  async eventos(u: UsuarioCtx, f: { dispositivo?: number; torre?: number; tipo?: string; pagina: number; por_pagina: number }): Promise<Paginado<EventoOperativo>> {
    const vis = await torresVisibles(this.db, u);
    const where = `WHERE ($1::int[] IS NULL OR d.id_instalacion = ANY($1::int[])) AND ($2::int IS NULL OR e.id_dispositivo = $2)
                     AND ($3::int IS NULL OR d.id_instalacion = $3) AND ($4::text IS NULL OR e.tipo = $4)`;
    const p = [vis, f.dispositivo ?? null, f.torre ?? null, f.tipo ?? null];
    const total = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM evento e JOIN dispositivo d ON d.id_dispositivo = e.id_dispositivo ${where}`,
      p,
    );
    const r = await this.db.query<EventoOperativo>(`${SELECT_EVENTO} ${where} ORDER BY e.ts DESC, e.id_evento DESC LIMIT $5 OFFSET $6`, [
      ...p,
      f.por_pagina,
      (f.pagina - 1) * f.por_pagina,
    ]);
    return { datos: r.rows.map(aIso), total: total.rows[0].n, pagina: f.pagina, por_pagina: f.por_pagina };
  }

  async resumen(u: UsuarioCtx): Promise<ResumenContinuidad> {
    const vis = await torresVisibles(this.db, u);
    const d = await this.db.query<{
      id_dispositivo: number;
      nombre: string;
      id_instalacion: number;
      torre: string;
      estado: 'activo' | 'baja' | 'sin_senal';
      ultima_comunicacion: Date | null;
      ultima_lectura_ts: Date | null;
      intervalo_muestreo_s: number;
      pendientes_reportados: number | null;
      pendientes_reportados_en: Date | null;
    }>(
      `SELECT d.id_dispositivo, d.nombre, d.id_instalacion, i.nombre AS torre, d.estado, d.ultima_comunicacion, d.ultima_lectura_ts,
              d.intervalo_muestreo_s, d.pendientes_reportados, d.pendientes_reportados_en
         FROM dispositivo d JOIN instalacion i ON i.id_instalacion = d.id_instalacion
        WHERE ($1::int[] IS NULL OR d.id_instalacion = ANY($1::int[])) ORDER BY i.nombre, d.nombre`,
      [vis],
    );
    const ahora = Date.now();
    const f = this.cfg.SIN_SENAL_FACTOR;
    const dispositivos = d.rows.map((x) => ({
      id_dispositivo: x.id_dispositivo,
      nombre: x.nombre,
      id_instalacion: x.id_instalacion,
      torre: x.torre,
      estado_registro: x.estado,
      conectividad: conectividad(x, f, ahora),
      ultima_comunicacion: x.ultima_comunicacion?.toISOString() ?? null,
      segundos_sin_reportar: x.ultima_comunicacion ? Math.round((ahora - x.ultima_comunicacion.getTime()) / 1000) : null,
      intervalo_muestreo_s: x.intervalo_muestreo_s,
      umbral_sin_senal_s: x.intervalo_muestreo_s * f,
      pendientes_reportados: x.pendientes_reportados,
      datos_desactualizados: !x.ultima_lectura_ts || ahora - x.ultima_lectura_ts.getTime() > x.intervalo_muestreo_s * f * 1000,
    }));
    const lotes = await this.db.query<{ recuperados: number; lecturas: number; duplicados: number }>(
      `SELECT count(*) FILTER (WHERE l.recuperado)::int AS recuperados,
              COALESCE(sum(l.lecturas) FILTER (WHERE l.recuperado), 0)::int AS lecturas,
              COALESCE(sum(l.duplicados_recibidos), 0)::int AS duplicados
         FROM lote_ingesta l JOIN dispositivo d ON d.id_dispositivo = l.id_dispositivo
        WHERE l.recibido_en > now() - interval '24 hours' AND ($1::int[] IS NULL OR d.id_instalacion = ANY($1::int[]))`,
      [vis],
    );
    const filtro = `WHERE ($1::int[] IS NULL OR d.id_instalacion = ANY($1::int[]))`;
    const descartes = await this.db.query<EventoOperativo>(`${SELECT_EVENTO} ${filtro} AND e.tipo = 'datos_descartados' ORDER BY e.ts DESC LIMIT 20`, [vis]);
    const recientes = await this.db.query<EventoOperativo>(
      `${SELECT_EVENTO} ${filtro} AND e.tipo IN ('sin_senal','reconexion','reinicio','reconexion_local','datos_descartados','intento_rechazado','reloj_desfasado','baja','cuarentena')
       ORDER BY e.ts DESC LIMIT 30`,
      [vis],
    );
    return {
      generado_en: new Date().toISOString(),
      dispositivos,
      lotes_recuperados_24h: lotes.rows[0].recuperados,
      lecturas_recuperadas_24h: lotes.rows[0].lecturas,
      lotes_duplicados_24h: lotes.rows[0].duplicados,
      descartes: descartes.rows.map(aIso),
      eventos_recientes: recientes.rows.map(aIso),
    };
  }

  /** RF-14: salud de API, PostgreSQL y MongoDB. */
  async salud() {
    const comp: Record<string, 'ok' | 'caido'> = { api: 'ok', postgresql: 'ok', mongodb: 'ok' };
    let timescale = false;
    try {
      const r = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'timescaledb'`);
      timescale = r.rows[0].n > 0;
    } catch {
      comp.postgresql = 'caido';
    }
    try {
      await this.payloads.ping();
    } catch {
      comp.mongodb = 'caido';
    }
    const ok = Object.values(comp).every((v) => v === 'ok');
    let outbox: { pendientes: number; cuarentena: number } | null = null;
    if (comp.postgresql === 'ok') {
      const o = await this.db.query<{ pendientes: number; cuarentena: number }>(
        `SELECT count(*) FILTER (WHERE procesado_en IS NULL AND NOT cuarentena)::int AS pendientes, count(*) FILTER (WHERE cuarentena)::int AS cuarentena FROM outbox_evaluacion`,
      );
      outbox = o.rows[0];
    }
    return { estado: ok ? 'ok' : 'degradado', componentes: comp, timescaledb: timescale, outbox, ts: new Date().toISOString() };
  }
}
