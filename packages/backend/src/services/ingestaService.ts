import type { EventoDispositivo, Lote, ResultadoIngesta } from '@aquaplants/shared';
import type { Consulta, IBaseDatos, IMedicionRepo, IOutbox, IPayloadStore } from '../ports/index.js';
import type { Config } from '../config.js';
import type { DispositivoAutenticado } from './authService.js';
import { ErrorApp, ReglaNegocioError } from '../errores.js';
import { registrarEvento } from './auditoria.js';

interface SensorInfo {
  id_sensor: number;
  id_dispositivo: number;
  estado: string;
  min_fisico: number;
  max_fisico: number;
  max_delta_minuto: number | null;
  tipo: string;
  ultimo_valor: number | null;
  ultimo_ts: Date | null;
}

/**
 * CU-01 Enviar mediciones de telemetría.
 * Orden defensivo: autenticar (middleware) → validar → MongoDB «recibido» →
 * transacción PostgreSQL (lote, mediciones, última comunicación, outbox) →
 * MongoDB «procesado». Respuesta 201 solo tras el COMMIT en PostgreSQL.
 */
export class IngestaService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly mediciones: IMedicionRepo,
    private readonly outbox: IOutbox,
    private readonly payloads: IPayloadStore,
    private readonly cfg: Config,
  ) {}

  async registrarLote(disp: DispositivoAutenticado, lote: Lote, ip: string | null): Promise<ResultadoIngesta> {
    if (lote.id_dispositivo !== disp.id_dispositivo) {
      await this.db.transaccion((tx) =>
        registrarEvento(tx, disp.id_dispositivo, 'lote_rechazado', 'El id_dispositivo del lote no coincide con la credencial', {
          id_lote: lote.id_lote,
          declarado: lote.id_dispositivo,
          ip,
        }),
      );
      throw new ReglaNegocioError('El identificador del dispositivo no coincide con la credencial', [
        { campo: 'id_dispositivo', mensaje: 'No coincide con la credencial' },
      ]);
    }

    // Idempotencia: lote ya procesado → 200 duplicado (Tabla 12).
    const previo = await this.loteExistente(lote.id_lote);
    if (previo) return this.responderDuplicado(previo, disp, lote.id_lote);

    this.validarMarcasTemporales(lote, disp);
    await this.validarSensores(lote, disp);

    // Paso 1: payload crudo en MongoDB. Si falla → 503 y nada en PostgreSQL.
    await this.payloads.guardarRecibido({ id_lote: lote.id_lote, id_dispositivo: disp.id_dispositivo, payload: lote });

    // Paso 2: transacción única en PostgreSQL.
    const resultado = await this.persistir(disp, lote);

    // Paso 3: marcar procesado. Si falla, la reconciliación lo corrige.
    if (!resultado.duplicado) {
      this.payloads.marcarProcesado(lote.id_lote).catch((e) => console.warn('[ingesta] marca procesado pendiente:', (e as Error).message));
    }
    return resultado;
  }

  /** Usado por la reconciliación: reprocesa un payload que quedó «recibido». */
  async reprocesar(idDispositivo: number, lote: Lote): Promise<ResultadoIngesta> {
    const r = await this.db.query<{ id_instalacion: number; intervalo_muestreo_s: number }>(
      `SELECT id_instalacion, intervalo_muestreo_s FROM dispositivo WHERE id_dispositivo = $1`,
      [idDispositivo],
    );
    if (!r.rows[0]) throw new ReglaNegocioError('Dispositivo inexistente');
    const disp = { id_dispositivo: idDispositivo, ...r.rows[0] };
    const previo = await this.loteExistente(lote.id_lote);
    if (previo) {
      await this.payloads.marcarProcesado(lote.id_lote);
      return { id_lote: lote.id_lote, recibidas: previo.lecturas, duplicado: true };
    }
    const res = await this.persistir(disp, lote);
    await this.payloads.marcarProcesado(lote.id_lote);
    return res;
  }

  private async loteExistente(idLote: string) {
    const r = await this.db.query<{ id_dispositivo: number; lecturas: number }>(
      `SELECT id_dispositivo, lecturas FROM lote_ingesta WHERE id_lote = $1`,
      [idLote],
    );
    return r.rows[0] ?? null;
  }

  private async responderDuplicado(previo: { id_dispositivo: number; lecturas: number }, disp: DispositivoAutenticado, idLote: string) {
    if (previo.id_dispositivo !== disp.id_dispositivo) {
      throw new ErrorApp(409, 'LOTE_AJENO', 'El identificador de lote ya fue usado por otro dispositivo');
    }
    await this.db.query(
      `UPDATE lote_ingesta SET duplicados_recibidos = duplicados_recibidos + 1 WHERE id_lote = $1`,
      [idLote],
    );
    await this.db.query(`UPDATE dispositivo SET ultima_comunicacion = now() WHERE id_dispositivo = $1`, [disp.id_dispositivo]);
    return { id_lote: idLote, recibidas: previo.lecturas, duplicado: true };
  }

  private validarMarcasTemporales(lote: Lote, disp: DispositivoAutenticado) {
    const ahora = Date.now();
    const maxFuturo = ahora + this.cfg.TS_FUTURO_MAX_S * 1000;
    const minPasado = ahora - this.cfg.TS_ANTIGUEDAD_MAX_H * 3600_000;
    for (const [i, l] of lote.lecturas.entries()) {
      const t = Date.parse(l.ts);
      if (t > maxFuturo || t < minPasado) {
        const motivo = t > maxFuturo ? 'futuro' : 'antiguo';
        void this.db
          .transaccion((tx) =>
            registrarEvento(tx, disp.id_dispositivo, 'reloj_desfasado', `Marca temporal fuera de tolerancia (${motivo})`, {
              id_lote: lote.id_lote,
              ts: l.ts,
              motivo,
            }),
          )
          .catch(() => undefined);
        throw new ErrorApp(422, 'RELOJ_DESFASADO', `Marca temporal fuera de tolerancia (${motivo})`, [
          { campo: `lecturas.${i}.ts`, mensaje: motivo === 'futuro' ? `Más de ${this.cfg.TS_FUTURO_MAX_S} s en el futuro` : `Más de ${this.cfg.TS_ANTIGUEDAD_MAX_H} h de antigüedad` },
        ]);
      }
    }
  }

  private async validarSensores(lote: Lote, disp: DispositivoAutenticado) {
    const ids = [...new Set(lote.lecturas.map((l) => l.id_sensor))];
    const r = await this.db.query<SensorInfo>(
      `SELECT s.id_sensor, s.id_dispositivo, s.estado, tv.min_fisico, tv.max_fisico, tv.max_delta_minuto, tv.nombre AS tipo,
              ult.valor AS ultimo_valor, ult.ts AS ultimo_ts
         FROM sensor s
         JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
         LEFT JOIN LATERAL (SELECT valor, ts FROM medicion m WHERE m.id_sensor = s.id_sensor ORDER BY ts DESC LIMIT 1) ult ON true
        WHERE s.id_sensor = ANY($1::int[])`,
      [ids],
    );
    const porId = new Map(r.rows.map((s) => [s.id_sensor, s]));
    const errores: { campo: string; mensaje: string }[] = [];
    const vistos = new Set<string>();
    const sospechosos: Record<string, unknown>[] = [];

    lote.lecturas.forEach((l, i) => {
      const s = porId.get(l.id_sensor);
      const clave = `${l.id_sensor}|${Date.parse(l.ts)}`;
      if (vistos.has(clave)) errores.push({ campo: `lecturas.${i}`, mensaje: 'Lectura repetida (mismo sensor y marca temporal) dentro del lote' });
      vistos.add(clave);
      if (!s) {
        errores.push({ campo: `lecturas.${i}.id_sensor`, mensaje: `Sensor ${l.id_sensor} inexistente` });
      } else if (s.id_dispositivo !== disp.id_dispositivo) {
        errores.push({ campo: `lecturas.${i}.id_sensor`, mensaje: `Sensor ${l.id_sensor} no asociado al dispositivo` });
        sospechosos.push({ id_sensor: l.id_sensor, ts: l.ts });
      } else if (s.estado !== 'activo') {
        errores.push({ campo: `lecturas.${i}.id_sensor`, mensaje: `Sensor ${l.id_sensor} dado de baja` });
      } else if (l.valor < s.min_fisico || l.valor > s.max_fisico) {
        errores.push({ campo: `lecturas.${i}.valor`, mensaje: `Valor fuera del rango físico de ${s.tipo} (${s.min_fisico}–${s.max_fisico})` });
      }
    });

    if (sospechosos.length) {
      await this.db.transaccion((tx) =>
        registrarEvento(tx, disp.id_dispositivo, 'sensor_ajeno', 'Lote con lecturas de sensores no asociados al dispositivo', {
          id_lote: lote.id_lote,
          lecturas: sospechosos,
        }),
      );
    }
    // Criterio «todo o nada» (RN-01): ninguna medición del lote se persiste.
    if (errores.length) throw new ReglaNegocioError('Lote rechazado: no cumple las reglas de validación', errores);

    // Plausibilidad: se marca para revisión, no se rechaza.
    const marcas: Record<string, unknown>[] = [];
    for (const l of lote.lecturas) {
      const s = porId.get(l.id_sensor)!;
      if (s.max_delta_minuto != null && s.ultimo_valor != null && s.ultimo_ts) {
        const min = Math.max(Math.abs(Date.parse(l.ts) - s.ultimo_ts.getTime()) / 60_000, 1);
        if (Math.abs(l.valor - s.ultimo_valor) / min > s.max_delta_minuto) {
          marcas.push({ id_sensor: l.id_sensor, anterior: s.ultimo_valor, nuevo: l.valor, ts: l.ts });
        }
      }
    }
    if (marcas.length) {
      await this.db.transaccion((tx) =>
        registrarEvento(tx, disp.id_dispositivo, 'plausibilidad', 'Cambio entre lecturas mayor al máximo esperable por minuto (revisar sensor)', {
          id_lote: lote.id_lote,
          lecturas: marcas,
        }),
      );
    }
  }

  private async persistir(disp: { id_dispositivo: number; intervalo_muestreo_s: number }, lote: Lote): Promise<ResultadoIngesta> {
    const tsOrden = lote.lecturas.map((l) => Date.parse(l.ts)).sort((a, b) => a - b);
    const tsMin = new Date(tsOrden[0]).toISOString();
    const tsMax = new Date(tsOrden[tsOrden.length - 1]).toISOString();
    const recuperado = lote.meta?.recuperado === true || Date.now() - tsOrden[tsOrden.length - 1] > 2 * disp.intervalo_muestreo_s * 1000;

    return this.db.transaccion(async (tx) => {
      const ins = await tx.query(
        `INSERT INTO lote_ingesta (id_lote, id_dispositivo, lecturas, ts_min, ts_max, recuperado)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id_lote) DO NOTHING RETURNING id_lote`,
        [lote.id_lote, disp.id_dispositivo, lote.lecturas.length, tsMin, tsMax, recuperado],
      );
      if (ins.rowCount === 0) {
        // Otra solicitud concurrente con el mismo id_lote ganó la carrera (CC-01).
        await tx.query(`UPDATE lote_ingesta SET duplicados_recibidos = duplicados_recibidos + 1 WHERE id_lote = $1`, [lote.id_lote]);
        return { id_lote: lote.id_lote, recibidas: lote.lecturas.length, duplicado: true };
      }
      await this.mediciones.insertarLote(tx, lote.id_lote, lote.lecturas);

      await this.marcarComunicacion(tx, disp.id_dispositivo, { origen: `lote ${lote.id_lote}`, pendientes: lote.meta?.pendientes ?? null, rssi: lote.meta?.rssi_dbm ?? null, tsMax });
      await this.outbox.encolar(tx, lote.id_lote);
      return { id_lote: lote.id_lote, recibidas: lote.lecturas.length, duplicado: false };
    });
  }

  /**
   * Actualiza la última comunicación. Si el dispositivo estaba «sin señal» vuelve a
   * activo y se registra el evento `reconexion` con la duración del silencio (RN-04).
   */
  private async marcarComunicacion(tx: Consulta, idDispositivo: number, d: { origen: string; pendientes: number | null; rssi?: number | null; tsMax?: string }) {
    const prev = await tx.query<{ estado: string; ultima_comunicacion: Date | null }>(
      `SELECT estado, ultima_comunicacion FROM dispositivo WHERE id_dispositivo = $1 FOR UPDATE`,
      [idDispositivo],
    );
    await tx.query(
      `UPDATE dispositivo
          SET ultima_comunicacion = now(),
              ultima_lectura_ts = CASE WHEN $2::timestamptz IS NULL THEN ultima_lectura_ts
                                       ELSE GREATEST(COALESCE(ultima_lectura_ts, $2::timestamptz), $2::timestamptz) END,
              pendientes_reportados = COALESCE($3, pendientes_reportados),
              pendientes_reportados_en = CASE WHEN $3::int IS NULL THEN pendientes_reportados_en ELSE now() END,
              rssi_dbm = COALESCE($4::smallint, rssi_dbm),
              rssi_en = CASE WHEN $4::smallint IS NULL THEN rssi_en ELSE now() END,
              estado = CASE WHEN estado = 'sin_senal' THEN 'activo' ELSE estado END
        WHERE id_dispositivo = $1`,
      [idDispositivo, d.tsMax ?? null, d.pendientes, d.rssi ?? null],
    );
    if (prev.rows[0]?.estado === 'sin_senal') {
      const ultima = prev.rows[0].ultima_comunicacion;
      await registrarEvento(tx, idDispositivo, 'reconexion', 'El dispositivo volvió a comunicarse', {
        sin_comunicacion_desde: ultima?.toISOString() ?? null,
        segundos_sin_comunicacion: ultima ? Math.round((Date.now() - ultima.getTime()) / 1000) : null,
        primer_contacto: d.origen,
        pendientes_en_cola: d.pendientes,
      });
    }
  }

  /**
   * D-35: configuración que el dispositivo puede consultar con su credencial:
   * intervalo y sensores ACTIVOS (con la clave de su tipo de variable). Así un sensor
   * agregado o dado de baja desde Infraestructura se refleja sin tocar el equipo.
   */
  async configuracionDispositivo(disp: DispositivoAutenticado) {
    const s = await this.db.query<{ id_sensor: number; clave: string; unidad: string }>(
      `SELECT s.id_sensor, tv.clave, tv.unidad_medida AS unidad
         FROM sensor s JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
        WHERE s.id_dispositivo = $1 AND s.estado = 'activo' ORDER BY s.id_sensor`,
      [disp.id_dispositivo],
    );
    return { id_dispositivo: disp.id_dispositivo, intervalo_muestreo_s: disp.intervalo_muestreo_s, sensores: s.rows };
  }

  /** Eventos que reporta el propio dispositivo (reinicio, datos descartados). Idempotente. */
  async registrarEventoDispositivo(disp: DispositivoAutenticado, ev: EventoDispositivo): Promise<{ registrado: boolean }> {
    if (ev.id_dispositivo !== disp.id_dispositivo) {
      throw new ReglaNegocioError('El identificador del dispositivo no coincide con la credencial', [
        { campo: 'id_dispositivo', mensaje: 'No coincide con la credencial' },
      ]);
    }
    const descripcion: Record<EventoDispositivo['tipo'], string> = {
      reinicio: 'El dispositivo informa un reinicio (arranque). La causa del apagado no está confirmada.',
      datos_descartados: 'El dispositivo informa lecturas descartadas por capacidad o antigüedad de su cola local',
      reconexion_local: 'El dispositivo informa que recuperó su conexión de red',
    };
    let idMongo: string | undefined;
    if (ev.detalle) {
      try {
        idMongo = await this.payloads.guardarDetalleEvento({ ...ev });
      } catch {
        idMongo = undefined; // el detalle también queda en jsonb
      }
    }
    const registrado = await this.db.transaccion(async (tx) => {
      const ok = await registrarEvento(tx, disp.id_dispositivo, ev.tipo, descripcion[ev.tipo], ev.detalle ?? null, 'dispositivo', {
        id_evento_local: ev.id_evento_local,
        ts: ev.ts,
        id_detalle_mongo: idMongo,
      });
      await this.marcarComunicacion(tx, disp.id_dispositivo, { origen: `evento ${ev.tipo}`, pendientes: ev.detalle?.pendientes_en_cola ?? null });
      return ok;
    });
    return { registrado };
  }
}
