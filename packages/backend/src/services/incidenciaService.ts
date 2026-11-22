import { autorizado, type Incidencia, type Paginado } from '@aquaplants/shared';
import type { IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoAutorizadoError, NoEncontradoError } from '../errores.js';
import { auditar } from './auditoria.js';
import { torresVisibles, type UsuarioCtx } from './acceso.js';

const SELECT_INCIDENCIA = `
  SELECT n.id_incidencia, n.id_dispositivo, d.nombre AS dispositivo, i.id_instalacion, i.nombre AS torre, cl.nombre AS cliente,
         n.tipo, n.estado, n.abierta_en, n.ocurrencias, n.senal_recuperada_en, (d.estado = 'sin_senal') AS sigue_sin_senal,
         ua.nombre AS atendida_por, n.atendida_en, uc.nombre AS cerrada_por, n.cerrada_en, n.comentario_cierre, d.latitud, d.longitud
    FROM incidencia n
    JOIN dispositivo d ON d.id_dispositivo = n.id_dispositivo
    JOIN instalacion i ON i.id_instalacion = d.id_instalacion
    JOIN cliente cl ON cl.id_cliente = i.id_cliente
    LEFT JOIN usuario ua ON ua.id_usuario = n.atendida_por
    LEFT JOIN usuario uc ON uc.id_usuario = n.cerrada_por`;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const serializar = (n: Incidencia): Incidencia => ({
  ...n,
  id_incidencia: Number(n.id_incidencia),
  abierta_en: iso(n.abierta_en)!,
  senal_recuperada_en: iso(n.senal_recuperada_en),
  atendida_en: iso(n.atendida_en),
  cerrada_en: iso(n.cerrada_en),
});

/**
 * RN-13 (Anexo C, D-37): incidencias de equipos. Se abren solas cuando un dispositivo
 * pasa a «sin señal» (ContinuidadService) y le llegan como aviso en la aplicación al
 * Técnico de ese cliente. El Técnico (o un Administrador) la toma y la cierra con un
 * comentario; el Supervisor del cliente solo la consulta. No reemplaza las alertas de cultivo.
 */
export class IncidenciaService {
  constructor(private readonly db: IBaseDatos) {}

  async listar(u: UsuarioCtx, f: { estado?: string; torre?: number; pagina: number; por_pagina: number }): Promise<Paginado<Incidencia>> {
    const vis = await torresVisibles(this.db, u);
    if (f.torre !== undefined && vis && !vis.includes(f.torre)) throw new NoAutorizadoError('La torre no está en su alcance', 'TORRE_NO_ASIGNADA');
    const where = `WHERE ($1::int[] IS NULL OR i.id_instalacion = ANY($1::int[]))
        AND ($2::text IS NULL OR ($2 = 'activas' AND n.estado <> 'cerrada') OR n.estado = $2)
        AND ($3::int IS NULL OR i.id_instalacion = $3)`;
    const p = [vis, f.estado ?? null, f.torre ?? null];
    const total = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM incidencia n JOIN dispositivo d ON d.id_dispositivo = n.id_dispositivo
         JOIN instalacion i ON i.id_instalacion = d.id_instalacion ${where}`,
      p,
    );
    const r = await this.db.query<Incidencia>(
      `${SELECT_INCIDENCIA} ${where}
       ORDER BY (n.estado <> 'cerrada') DESC, (n.estado = 'abierta') DESC, n.abierta_en DESC
       LIMIT $4 OFFSET $5`,
      [...p, f.por_pagina, (f.pagina - 1) * f.por_pagina],
    );
    return { datos: r.rows.map(serializar), total: total.rows[0].n, pagina: f.pagina, por_pagina: f.por_pagina };
  }

  /** Bloquea la incidencia y comprueba alcance y permiso de escritura. */
  private async conAcceso(tx: Pick<IBaseDatos, 'query'>, u: UsuarioCtx, id: number) {
    const r = await tx.query<{ estado: string; id_instalacion: number; dispositivo_estado: string }>(
      `SELECT n.estado, d.id_instalacion, d.estado AS dispositivo_estado FROM incidencia n
         JOIN dispositivo d ON d.id_dispositivo = n.id_dispositivo WHERE n.id_incidencia = $1 FOR UPDATE OF n`,
      [id],
    );
    const n = r.rows[0];
    const vis = await torresVisibles(tx, u);
    // Fuera del alcance responde igual que si no existiera.
    if (!n || (vis && !vis.includes(n.id_instalacion))) throw new NoEncontradoError('Incidencia no encontrada');
    if (!autorizado(u.rol, 'incidencias.atender')) throw new NoAutorizadoError();
    if (n.estado === 'cerrada') throw new ConflictoError('La incidencia ya está cerrada', 'INCIDENCIA_CERRADA');
    return n;
  }

  private async leer(tx: Pick<IBaseDatos, 'query'>, id: number) {
    const r = await tx.query<Incidencia>(`${SELECT_INCIDENCIA} WHERE n.id_incidencia = $1`, [id]);
    return serializar(r.rows[0]);
  }

  /** El Técnico la toma: queda «en atención» a su nombre. */
  async atender(u: UsuarioCtx, id: number): Promise<Incidencia> {
    return this.db.transaccion(async (tx) => {
      const n = await this.conAcceso(tx, u, id);
      if (n.estado === 'en_atencion') throw new ConflictoError('La incidencia ya está en atención', 'INCIDENCIA_EN_ATENCION');
      await tx.query(`UPDATE incidencia SET estado = 'en_atencion', atendida_por = $2, atendida_en = now() WHERE id_incidencia = $1`, [id, u.id_usuario]);
      await auditar(tx, u, 'atender_incidencia', 'incidencia', id, null);
      return this.leer(tx, id);
    });
  }

  /**
   * Cierre con comentario. Mientras el equipo siga sin señal no se cierra (se perdería el
   * aviso), salvo que el dispositivo se haya dado de baja.
   */
  async cerrar(u: UsuarioCtx, id: number, comentario: string): Promise<Incidencia> {
    return this.db.transaccion(async (tx) => {
      const n = await this.conAcceso(tx, u, id);
      if (n.dispositivo_estado === 'sin_senal') {
        throw new ConflictoError('El equipo sigue sin señal: ciérrela cuando vuelva a comunicarse o se dé de baja', 'SIN_SENAL_PERSISTE');
      }
      await tx.query(
        `UPDATE incidencia SET estado = 'cerrada', cerrada_por = $2, cerrada_en = now(), comentario_cierre = $3,
                atendida_por = COALESCE(atendida_por, $2), atendida_en = COALESCE(atendida_en, now())
          WHERE id_incidencia = $1`,
        [id, u.id_usuario, comentario.trim()],
      );
      await auditar(tx, u, 'cerrar_incidencia', 'incidencia', id, { comentario: comentario.trim() });
      return this.leer(tx, id);
    });
  }
}
