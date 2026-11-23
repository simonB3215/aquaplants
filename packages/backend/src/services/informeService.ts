import type { IBaseDatos } from '../ports/index.js';
import { torresVisibles, type UsuarioCtx } from './acceso.js';

/** Las fechas del periodo son días calendario de Chile (inicio inclusivo, fin inclusivo). */
const ZONA = 'America/Santiago';

export interface FiltroInforme {
  desde: string;
  hasta: string;
  cliente?: number;
}

/**
 * Informe de gestión (Evaluación 3): resumen operativo de un periodo, generado en el
 * momento desde la base de datos en la nube. Respeta el alcance del usuario: el
 * Supervisor solo ve las torres de su cliente (torresVisibles) y no ve la auditoría.
 *
 * Parámetros comunes de las consultas:
 *   $1 torres visibles (null = todas) · $2 cliente (null = todos) · $3 desde · $4 hasta
 */
export class InformeService {
  constructor(private readonly db: IBaseDatos) {}

  async gestion(u: UsuarioCtx, f: FiltroInforme, conAuditoria: boolean) {
    const vis = await torresVisibles(this.db, u);
    const p = [vis, f.cliente ?? null, f.desde, f.hasta];
    // Torres del alcance (incluye las de baja: pueden tener datos del periodo).
    const T = `SELECT i.id_instalacion FROM instalacion i
                WHERE ($1::int[] IS NULL OR i.id_instalacion = ANY($1::int[])) AND ($2::int IS NULL OR i.id_cliente = $2)`;
    const ini = `(($3::date)::timestamp AT TIME ZONE '${ZONA}')`;
    const fin = `((($4::date) + 1)::timestamp AT TIME ZONE '${ZONA}')`;

    const [inventario, lecturas, alertas, incidencias, cultivos, porTorre, porDia, porEspecie] = await Promise.all([
      this.db.query(
        `SELECT
           (SELECT count(DISTINCT i.id_cliente)::int FROM instalacion i WHERE i.id_instalacion IN (${T}) AND i.estado = 'activo') AS clientes,
           (SELECT count(*)::int FROM instalacion i WHERE i.id_instalacion IN (${T}) AND i.estado = 'activo') AS torres,
           (SELECT count(*)::int FROM dispositivo d WHERE d.id_instalacion IN (${T}) AND d.estado <> 'baja') AS dispositivos,
           (SELECT count(*)::int FROM dispositivo d WHERE d.id_instalacion IN (${T}) AND d.estado = 'sin_senal') AS dispositivos_sin_senal,
           (SELECT count(*)::int FROM sensor s JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
             WHERE d.id_instalacion IN (${T}) AND s.estado = 'activo' AND d.estado <> 'baja') AS sensores,
           (SELECT count(*)::int FROM cultivo c WHERE c.id_instalacion IN (${T}) AND c.estado = 'en_curso') AS cultivos_en_curso,
           (SELECT count(*)::int FROM usuario us WHERE us.activo
             AND ($2::int IS NULL OR us.id_cliente = $2)
             AND ($1::int[] IS NULL OR us.id_cliente IN (SELECT i.id_cliente FROM instalacion i WHERE i.id_instalacion = ANY($1::int[])))) AS usuarios`,
        p.slice(0, 2), // solo $1 y $2: PostgreSQL rechaza parámetros sin usar (tipo indeterminado)
      ),
      this.db.query(
        `SELECT count(*)::int AS lecturas,
                count(DISTINCT m.id_sensor)::int AS sensores_con_datos
           FROM medicion m JOIN sensor s ON s.id_sensor = m.id_sensor JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
          WHERE d.id_instalacion IN (${T}) AND m.ts >= ${ini} AND m.ts < ${fin}`,
        p,
      ),
      this.db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE a.severidad = 'critica')::int AS criticas,
                count(*) FILTER (WHERE a.severidad = 'advertencia')::int AS advertencias,
                count(*) FILTER (WHERE a.estado = 'resuelta')::int AS resueltas,
                count(*) FILTER (WHERE a.estado = 'activa')::int AS activas,
                round((avg(extract(epoch FROM a.fecha_resolucion - a.fecha_generacion)) FILTER (WHERE a.estado = 'resuelta') / 3600)::numeric, 1)::float8 AS horas_resolucion
           FROM alerta a JOIN sensor s ON s.id_sensor = a.id_sensor JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
          WHERE d.id_instalacion IN (${T}) AND a.fecha_generacion >= ${ini} AND a.fecha_generacion < ${fin}`,
        p,
      ),
      this.db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE n.estado = 'cerrada')::int AS cerradas,
                count(*) FILTER (WHERE n.estado <> 'cerrada')::int AS abiertas,
                round((avg(extract(epoch FROM n.cerrada_en - n.abierta_en)) FILTER (WHERE n.estado = 'cerrada') / 3600)::numeric, 1)::float8 AS horas_cierre
           FROM incidencia n JOIN dispositivo d ON d.id_dispositivo = n.id_dispositivo
          WHERE d.id_instalacion IN (${T}) AND n.abierta_en >= ${ini} AND n.abierta_en < ${fin}`,
        p,
      ),
      this.db.query(
        `SELECT count(*) FILTER (WHERE c.fecha_inicio BETWEEN $3::date AND $4::date)::int AS iniciados,
                count(*) FILTER (WHERE c.fecha_fin BETWEEN $3::date AND $4::date)::int AS finalizados
           FROM cultivo c WHERE c.id_instalacion IN (${T})`,
        p,
      ),
      this.db.query(
        `SELECT i.id_instalacion, i.nombre AS torre, cl.nombre AS cliente, i.estado,
                (SELECT e.nombre FROM cultivo c JOIN especie e ON e.id_especie = c.id_especie
                  WHERE c.id_instalacion = i.id_instalacion AND c.estado = 'en_curso' LIMIT 1) AS cultivo,
                (SELECT count(*)::int FROM medicion m JOIN sensor s ON s.id_sensor = m.id_sensor JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
                  WHERE d.id_instalacion = i.id_instalacion AND m.ts >= ${ini} AND m.ts < ${fin}) AS lecturas,
                (SELECT count(*)::int FROM alerta a JOIN sensor s ON s.id_sensor = a.id_sensor JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
                  WHERE d.id_instalacion = i.id_instalacion AND a.fecha_generacion >= ${ini} AND a.fecha_generacion < ${fin}) AS alertas,
                (SELECT count(*)::int FROM alerta a JOIN sensor s ON s.id_sensor = a.id_sensor JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
                  WHERE d.id_instalacion = i.id_instalacion AND a.severidad = 'critica' AND a.fecha_generacion >= ${ini} AND a.fecha_generacion < ${fin}) AS criticas,
                (SELECT count(*)::int FROM incidencia n JOIN dispositivo d ON d.id_dispositivo = n.id_dispositivo
                  WHERE d.id_instalacion = i.id_instalacion AND n.abierta_en >= ${ini} AND n.abierta_en < ${fin}) AS incidencias,
                (SELECT max(d.ultima_comunicacion) FROM dispositivo d WHERE d.id_instalacion = i.id_instalacion AND d.estado <> 'baja') AS ultima_comunicacion
           FROM instalacion i JOIN cliente cl ON cl.id_cliente = i.id_cliente
          WHERE i.id_instalacion IN (${T})
          ORDER BY i.estado, cl.nombre, i.nombre`,
        p,
      ),
      // Serie diaria para el gráfico: alertas e incidencias abiertas por día del periodo.
      this.db.query(
        `SELECT to_char(dia, 'YYYY-MM-DD') AS dia,
                (SELECT count(*)::int FROM alerta a JOIN sensor s ON s.id_sensor = a.id_sensor JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
                  WHERE d.id_instalacion IN (${T}) AND (a.fecha_generacion AT TIME ZONE '${ZONA}')::date = dia) AS alertas,
                (SELECT count(*)::int FROM incidencia n JOIN dispositivo d ON d.id_dispositivo = n.id_dispositivo
                  WHERE d.id_instalacion IN (${T}) AND (n.abierta_en AT TIME ZONE '${ZONA}')::date = dia) AS incidencias
           FROM (SELECT g::date AS dia FROM generate_series($3::date, $4::date, interval '1 day') AS g) AS dias
          ORDER BY dia`,
        p,
      ),
      this.db.query(
        `SELECT e.nombre AS especie,
                count(*) FILTER (WHERE c.estado = 'en_curso')::int AS en_curso,
                count(*) FILTER (WHERE c.fecha_inicio BETWEEN $3::date AND $4::date)::int AS iniciados,
                count(*) FILTER (WHERE c.fecha_fin BETWEEN $3::date AND $4::date)::int AS finalizados
           FROM cultivo c JOIN especie e ON e.id_especie = c.id_especie
          WHERE c.id_instalacion IN (${T})
            AND (c.estado = 'en_curso' OR c.fecha_inicio BETWEEN $3::date AND $4::date OR c.fecha_fin BETWEEN $3::date AND $4::date)
          GROUP BY e.nombre ORDER BY e.nombre`,
        p,
      ),
    ]);

    let auditoria: { accion: string; total: number }[] | null = null;
    if (conAuditoria) {
      const a = await this.db.query<{ accion: string; total: number }>(
        `SELECT accion, count(*)::int AS total FROM log_auditoria
          WHERE ts >= (($1::date)::timestamp AT TIME ZONE '${ZONA}') AND ts < ((($2::date) + 1)::timestamp AT TIME ZONE '${ZONA}')
          GROUP BY accion ORDER BY total DESC, accion LIMIT 10`,
        [f.desde, f.hasta],
      );
      auditoria = a.rows;
    }

    const al = alertas.rows[0] as { total: number; resueltas: number };
    const inc = incidencias.rows[0] as { total: number; cerradas: number };
    const cliente = f.cliente ? (await this.db.query<{ nombre: string }>(`SELECT nombre FROM cliente WHERE id_cliente = $1`, [f.cliente])).rows[0]?.nombre ?? null : null;
    return {
      generado_en: new Date().toISOString(),
      generado_por: u.id_usuario,
      periodo: { desde: f.desde, hasta: f.hasta },
      cliente,
      inventario: inventario.rows[0],
      telemetria: lecturas.rows[0],
      alertas: { ...alertas.rows[0], pct_resueltas: al.total ? Math.round((al.resueltas / al.total) * 100) : null },
      incidencias: { ...incidencias.rows[0], pct_cerradas: inc.total ? Math.round((inc.cerradas / inc.total) * 100) : null },
      cultivos: { ...cultivos.rows[0], por_especie: porEspecie.rows },
      por_torre: porTorre.rows,
      por_dia: porDia.rows,
      auditoria,
    };
  }
}
