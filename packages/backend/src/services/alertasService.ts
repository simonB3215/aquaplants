import { autorizado, type Alerta, type Paginado } from '@aquaplants/shared';
import type { IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoAutorizadoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import { torresVisibles, type UsuarioCtx } from './acceso.js';

const SELECT_ALERTA = `
  SELECT a.id_alerta, a.id_sensor, i.id_instalacion, i.nombre AS torre, tv.nombre AS tipo_variable, tv.unidad_medida AS unidad,
         a.severidad, a.estado, a.valor, a.valor_min, a.valor_max, a.ultimo_valor, a.ts_ultima, a.ocurrencias,
         a.fecha_generacion, a.fecha_resolucion, ur.nombre AS resuelta_por, a.comentario, a.notificacion_estado
    FROM alerta a
    JOIN sensor s ON s.id_sensor = a.id_sensor
    JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
    JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
    JOIN instalacion i ON i.id_instalacion = d.id_instalacion
    LEFT JOIN usuario ur ON ur.id_usuario = a.resuelta_por`;

/** CU-04 Gestionar alertas (consulta y resolución). */
export class AlertasService {
  constructor(private readonly db: IBaseDatos) {}

  async listar(
    u: UsuarioCtx,
    f: { estado?: string; severidad?: string; torre?: number; pagina: number; por_pagina: number },
  ): Promise<Paginado<Alerta>> {
    const vis = await torresVisibles(this.db, u);
    if (f.torre !== undefined && vis && !vis.includes(f.torre)) throw new NoAutorizadoError('La torre no está asignada a su usuario', 'TORRE_NO_ASIGNADA');
    const where = `WHERE ($1::int[] IS NULL OR i.id_instalacion = ANY($1::int[]))
        AND ($2::text IS NULL OR a.estado = $2) AND ($3::text IS NULL OR a.severidad = $3)
        AND ($4::int IS NULL OR i.id_instalacion = $4)`;
    const params = [vis, f.estado ?? null, f.severidad ?? null, f.torre ?? null];
    const total = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alerta a JOIN sensor s ON s.id_sensor = a.id_sensor
         JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo JOIN instalacion i ON i.id_instalacion = d.id_instalacion ${where}`,
      params,
    );
    // Ordenadas por estado, severidad y hora (CU-04 paso 5).
    const r = await this.db.query<Alerta>(
      `${SELECT_ALERTA} ${where}
       ORDER BY (a.estado = 'activa') DESC, (a.severidad = 'critica') DESC, a.fecha_generacion DESC
       LIMIT $5 OFFSET $6`,
      [...params, f.por_pagina, (f.pagina - 1) * f.por_pagina],
    );
    return { datos: r.rows.map(serializar), total: total.rows[0].n, pagina: f.pagina, por_pagina: f.por_pagina };
  }

  async resolver(u: UsuarioCtx, idAlerta: number, comentario: string | undefined): Promise<Alerta> {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ estado: string; severidad: 'advertencia' | 'critica'; id_instalacion: number }>(
        `SELECT a.estado, a.severidad, d.id_instalacion FROM alerta a
           JOIN sensor s ON s.id_sensor = a.id_sensor JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
          WHERE a.id_alerta = $1 FOR UPDATE OF a`,
        [idAlerta],
      );
      const a = r.rows[0];
      if (!a) throw new NoEncontradoError('Alerta no encontrada');
      const vis = await torresVisibles(tx, u);
      if (vis && !vis.includes(a.id_instalacion)) throw new NoAutorizadoError('La torre no está asignada a su usuario', 'TORRE_NO_ASIGNADA');
      const funcionalidad = a.severidad === 'critica' ? 'alertas.resolver_critica' : 'alertas.resolver_advertencia';
      if (!autorizado(u.rol, funcionalidad)) {
        throw new NoAutorizadoError('Su rol no puede resolver alertas críticas (Tabla 48)', 'SEVERIDAD_NO_PERMITIDA');
      }
      // Tabla 29: comentario obligatorio al resolver una crítica.
      if (a.severidad === 'critica' && !comentario?.trim()) {
        throw new ReglaNegocioError('El comentario es obligatorio para resolver una alerta crítica', [{ campo: 'comentario', mensaje: 'Obligatorio' }]);
      }
      if (a.estado !== 'activa') throw new ConflictoError('La alerta ya fue resuelta por otro usuario', 'ALERTA_YA_RESUELTA');
      await tx.query(
        `UPDATE alerta SET estado = 'resuelta', resuelta_por = $2, fecha_resolucion = now(), comentario = $3 WHERE id_alerta = $1`,
        [idAlerta, u.id_usuario, comentario?.trim() || null],
      );
      await auditar(tx, u, 'resolver_alerta', 'alerta', idAlerta, { severidad: a.severidad, comentario: comentario ?? null });
      const out = await tx.query<Alerta>(`${SELECT_ALERTA} WHERE a.id_alerta = $1`, [idAlerta]);
      return serializar(out.rows[0]);
    });
  }
}

function serializar(a: Alerta): Alerta {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return {
    ...a,
    id_alerta: Number(a.id_alerta),
    ts_ultima: iso(a.ts_ultima)!,
    fecha_generacion: iso(a.fecha_generacion)!,
    fecha_resolucion: iso(a.fecha_resolucion),
  };
}
