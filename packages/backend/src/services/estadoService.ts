import { calidadEnlace } from '@aquaplants/shared';
import type {
  DispositivoEstado,
  EstadoConectividad,
  EstadoTorre,
  EstadoVariable,
  RespuestaEstado,
  Severidad,
  VariableEstado,
} from '@aquaplants/shared';
import type { IBaseDatos } from '../ports/index.js';
import type { Config } from '../config.js';
import { torresVisibles, exigirAccesoTorre, type UsuarioCtx } from './acceso.js';

const PESO: Record<EstadoVariable, number> = { sin_datos: 0, sin_clasificar: 1, normal: 2, advertencia: 3, critico: 4 };

/** Clasificación en el servicio (no en la SPA) para que todos los clientes usen el mismo criterio. */
export function clasificar(valor: number | null, umbrales: { severidad: Severidad; valor_min: number; valor_max: number }[]): EstadoVariable {
  if (valor === null) return 'sin_datos';
  if (umbrales.length === 0) return 'sin_clasificar';
  const fuera = (s: Severidad) => umbrales.some((u) => u.severidad === s && (valor < u.valor_min || valor > u.valor_max));
  if (fuera('critica')) return 'critico';
  if (fuera('advertencia')) return 'advertencia';
  return 'normal';
}

export function conectividad(
  d: { estado: string; ultima_comunicacion: Date | null; intervalo_muestreo_s: number; pendientes_reportados: number | null; pendientes_reportados_en: Date | null },
  factor: number,
  ahora = Date.now(),
): EstadoConectividad {
  if (d.estado === 'baja') return 'baja';
  if (!d.ultima_comunicacion) return 'nunca_conectado';
  const limite = d.intervalo_muestreo_s * factor * 1000;
  if (d.estado === 'sin_senal' || ahora - d.ultima_comunicacion.getTime() > limite) return 'sin_senal';
  if (
    (d.pendientes_reportados ?? 0) > 0 &&
    d.pendientes_reportados_en &&
    ahora - d.pendientes_reportados_en.getTime() < Math.max(limite, 60_000)
  ) {
    return 'sincronizando';
  }
  return 'conectado';
}

/** CU-03: estado actual por torre (solo lectura). */
export class EstadoService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly cfg: Config,
  ) {}

  async estado(u: UsuarioCtx, idTorre?: number): Promise<RespuestaEstado> {
    if (idTorre !== undefined) await exigirAccesoTorre(this.db, u, idTorre);
    const vis = await torresVisibles(this.db, u);
    const filtro = idTorre !== undefined ? [idTorre] : vis;

    const torres = await this.db.query<{
      id_instalacion: number;
      nombre: string;
      tipo: 'aeroponica' | 'hidroponica';
      ubicacion: string;
      estado: 'activo' | 'baja';
      id_cultivo: number | null;
      especie: string | null;
      fecha_inicio: string | null;
      alertas_activas: number;
    }>(
      `SELECT i.id_instalacion, i.nombre, i.tipo, i.ubicacion, i.estado,
              c.id_cultivo, e.nombre AS especie, to_char(c.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
              (SELECT count(*)::int FROM alerta a JOIN sensor s ON s.id_sensor = a.id_sensor
                 JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
                WHERE d.id_instalacion = i.id_instalacion AND a.estado = 'activa') AS alertas_activas
         FROM instalacion i
         LEFT JOIN cultivo c ON c.id_instalacion = i.id_instalacion AND c.estado = 'en_curso'
         LEFT JOIN especie e ON e.id_especie = c.id_especie
        WHERE ($1::int[] IS NULL OR i.id_instalacion = ANY($1::int[]))
          AND (i.estado = 'activo' OR $2::boolean)
        ORDER BY i.nombre`,
      [filtro, idTorre !== undefined],
    );
    const ids = torres.rows.map((t) => t.id_instalacion);
    if (ids.length === 0) return { generado_en: new Date().toISOString(), torres: [] };

    const disps = await this.db.query<{
      id_dispositivo: number;
      id_instalacion: number;
      nombre: string;
      estado: 'activo' | 'baja' | 'sin_senal';
      ultima_comunicacion: Date | null;
      ultima_lectura_ts: Date | null;
      intervalo_muestreo_s: number;
      pendientes_reportados: number | null;
      pendientes_reportados_en: Date | null;
      rssi_dbm: number | null;
    }>(
      `SELECT id_dispositivo, id_instalacion, nombre, estado, ultima_comunicacion, ultima_lectura_ts, intervalo_muestreo_s,
              pendientes_reportados, pendientes_reportados_en, rssi_dbm
         FROM dispositivo WHERE id_instalacion = ANY($1::int[]) ORDER BY nombre`,
      [ids],
    );

    // Último valor por sensor: index-only scan sobre (id_sensor, ts DESC) INCLUDE (valor).
    const vars = await this.db.query<{
      id_sensor: number;
      id_dispositivo: number;
      id_instalacion: number;
      estado: string;
      id_tipo_variable: number;
      tipo_variable: string;
      unidad: string;
      valor: number | null;
      ts: Date | null;
      umbrales: { severidad: Severidad; valor_min: number; valor_max: number }[] | null;
    }>(
      `SELECT s.id_sensor, s.id_dispositivo, d.id_instalacion, s.estado, tv.id_tipo_variable, tv.nombre AS tipo_variable,
              tv.unidad_medida AS unidad, ult.valor, ult.ts,
              (SELECT json_agg(json_build_object('severidad', u.severidad, 'valor_min', u.valor_min, 'valor_max', u.valor_max) ORDER BY u.severidad)
                 FROM umbral u WHERE u.id_sensor = s.id_sensor AND u.activo) AS umbrales
         FROM sensor s
         JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
         JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
         LEFT JOIN LATERAL (SELECT valor, ts FROM medicion m WHERE m.id_sensor = s.id_sensor ORDER BY ts DESC LIMIT 1) ult ON true
        WHERE d.id_instalacion = ANY($1::int[]) AND s.estado = 'activo' AND d.estado <> 'baja'
        ORDER BY tv.id_tipo_variable, s.id_sensor`,
      [ids],
    );

    const ahora = Date.now();
    const factor = this.cfg.SIN_SENAL_FACTOR;
    const resultado: EstadoTorre[] = torres.rows.map((t) => {
      const dispositivos: DispositivoEstado[] = disps.rows
        .filter((d) => d.id_instalacion === t.id_instalacion)
        .map((d) => {
          const limite = d.intervalo_muestreo_s * factor;
          return {
            id_dispositivo: d.id_dispositivo,
            nombre: d.nombre,
            estado_registro: d.estado,
            conectividad: conectividad(d, factor, ahora),
            ultima_comunicacion: d.ultima_comunicacion?.toISOString() ?? null,
            segundos_sin_reportar: d.ultima_comunicacion ? Math.round((ahora - d.ultima_comunicacion.getTime()) / 1000) : null,
            intervalo_muestreo_s: d.intervalo_muestreo_s,
            umbral_sin_senal_s: limite,
            pendientes_reportados: d.pendientes_reportados,
            datos_desactualizados: !d.ultima_lectura_ts || ahora - d.ultima_lectura_ts.getTime() > limite * 1000,
            rssi_dbm: d.rssi_dbm,
            calidad_enlace: calidadEnlace(d.rssi_dbm),
          };
        });
      const variables: VariableEstado[] = vars.rows
        .filter((v) => v.id_instalacion === t.id_instalacion)
        .map((v) => {
          const umbrales = v.umbrales ?? [];
          return {
            id_sensor: v.id_sensor,
            tipo_variable: v.tipo_variable,
            id_tipo_variable: v.id_tipo_variable,
            unidad: v.unidad,
            valor: v.valor,
            ts: v.ts?.toISOString() ?? null,
            estado: clasificar(v.valor, umbrales),
            umbrales,
            sensor_activo: v.estado === 'activo',
          };
        });
      const estado_general = variables.reduce<EstadoVariable>((acc, v) => (PESO[v.estado] > PESO[acc] ? v.estado : acc), 'sin_datos');
      const ultimas = variables.map((v) => v.ts).filter((x): x is string => !!x).sort();
      return {
        id_instalacion: t.id_instalacion,
        nombre: t.nombre,
        tipo: t.tipo,
        ubicacion: t.ubicacion,
        estado_registro: t.estado,
        cultivo: t.id_cultivo ? { id_cultivo: t.id_cultivo, especie: t.especie!, fecha_inicio: t.fecha_inicio! } : null,
        estado_general,
        alertas_activas: t.alertas_activas,
        dispositivos,
        variables,
        ultima_lectura: ultimas.length ? ultimas[ultimas.length - 1] : null,
      };
    });
    return { generado_en: new Date().toISOString(), torres: resultado };
  }
}
