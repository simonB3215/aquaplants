import type { IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import { exigirAccesoTorre, torresVisibles, type UsuarioCtx } from './acceso.js';

const hoyLocal = () => new Date().toISOString().slice(0, 10);

/** CU-10 Gestionar cultivos. Un solo cultivo en curso por torre; fecha_fin ≥ fecha_inicio. */
export class CultivoService {
  constructor(private readonly db: IBaseDatos) {}

  async listar(u: UsuarioCtx, idTorre?: number) {
    if (idTorre !== undefined) await exigirAccesoTorre(this.db, u, idTorre);
    const vis = await torresVisibles(this.db, u);
    const r = await this.db.query(
      `SELECT c.id_cultivo, c.id_instalacion, i.nombre AS torre, c.id_especie, e.nombre AS especie,
              to_char(c.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(c.fecha_fin, 'YYYY-MM-DD') AS fecha_fin, c.estado
         FROM cultivo c JOIN instalacion i ON i.id_instalacion = c.id_instalacion JOIN especie e ON e.id_especie = c.id_especie
        WHERE ($1::int[] IS NULL OR c.id_instalacion = ANY($1::int[])) AND ($2::int IS NULL OR c.id_instalacion = $2)
        ORDER BY (c.estado = 'en_curso') DESC, c.fecha_inicio DESC`,
      [vis, idTorre ?? null],
    );
    return r.rows;
  }

  async crear(u: UsuarioCtx, d: { id_instalacion: number; id_especie: number; fecha_inicio: string }) {
    await exigirAccesoTorre(this.db, u, d.id_instalacion);
    if (d.fecha_inicio > hoyLocal()) throw new ReglaNegocioError('La fecha de inicio no puede ser futura', [{ campo: 'fecha_inicio', mensaje: 'Fecha futura' }]);
    return this.db.transaccion(async (tx) => {
      const t = await tx.query<{ estado: string }>(`SELECT estado FROM instalacion WHERE id_instalacion = $1 FOR UPDATE`, [d.id_instalacion]);
      if (t.rows[0].estado !== 'activo') throw new ConflictoError('La torre está de baja', 'TORRE_DE_BAJA');
      const esp = await tx.query(`SELECT 1 FROM especie WHERE id_especie = $1`, [d.id_especie]);
      if (!esp.rowCount) throw new ReglaNegocioError('Especie inexistente', [{ campo: 'id_especie', mensaje: 'Seleccione una especie del catálogo' }]);
      const enCurso = await tx.query(`SELECT 1 FROM cultivo WHERE id_instalacion = $1 AND estado = 'en_curso'`, [d.id_instalacion]);
      if (enCurso.rowCount) throw new ConflictoError('La torre ya tiene un cultivo en curso: ciérrelo antes de registrar uno nuevo', 'CULTIVO_EN_CURSO');
      const r = await tx.query<{ id_cultivo: number }>(
        `INSERT INTO cultivo (id_instalacion, id_especie, fecha_inicio, creado_por) VALUES ($1, $2, $3, $4) RETURNING id_cultivo`,
        [d.id_instalacion, d.id_especie, d.fecha_inicio, u.id_usuario],
      );
      await auditar(tx, u, 'crear_cultivo', 'cultivo', r.rows[0].id_cultivo, { nuevo: d });
      return r.rows[0];
    });
  }

  private async cultivoConAcceso(u: UsuarioCtx, id: number) {
    const r = await this.db.query<{ id_instalacion: number; estado: string; fecha_inicio: string; id_especie: number }>(
      `SELECT id_instalacion, estado, to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, id_especie FROM cultivo WHERE id_cultivo = $1`,
      [id],
    );
    if (!r.rows[0]) throw new NoEncontradoError('Cultivo no encontrado');
    await exigirAccesoTorre(this.db, u, r.rows[0].id_instalacion);
    return r.rows[0];
  }

  async editar(u: UsuarioCtx, id: number, d: { id_especie?: number; fecha_inicio?: string }) {
    const c = await this.cultivoConAcceso(u, id);
    if (c.estado !== 'en_curso') throw new ConflictoError('Solo se puede corregir un cultivo en curso');
    if (d.fecha_inicio && d.fecha_inicio > hoyLocal()) throw new ReglaNegocioError('La fecha de inicio no puede ser futura', [{ campo: 'fecha_inicio', mensaje: 'Fecha futura' }]);
    return this.db.transaccion(async (tx) => {
      await tx.query(`UPDATE cultivo SET id_especie = COALESCE($2, id_especie), fecha_inicio = COALESCE($3::date, fecha_inicio) WHERE id_cultivo = $1`, [
        id,
        d.id_especie ?? null,
        d.fecha_inicio ?? null,
      ]);
      await auditar(tx, u, 'editar_cultivo', 'cultivo', id, { anterior: { id_especie: c.id_especie, fecha_inicio: c.fecha_inicio }, nuevo: d });
      return { id_cultivo: id };
    });
  }

  async cerrar(u: UsuarioCtx, id: number, fechaFin: string) {
    const c = await this.cultivoConAcceso(u, id);
    if (c.estado !== 'en_curso') throw new ConflictoError('El cultivo ya está finalizado');
    if (fechaFin < c.fecha_inicio) throw new ReglaNegocioError('La fecha de fin debe ser igual o posterior a la de inicio', [{ campo: 'fecha_fin', mensaje: 'Anterior al inicio' }]);
    if (fechaFin > hoyLocal()) throw new ReglaNegocioError('La fecha de fin no puede ser futura', [{ campo: 'fecha_fin', mensaje: 'Fecha futura' }]);
    return this.db.transaccion(async (tx) => {
      await tx.query(`UPDATE cultivo SET fecha_fin = $2, estado = 'finalizado' WHERE id_cultivo = $1`, [id, fechaFin]);
      await auditar(tx, u, 'cerrar_cultivo', 'cultivo', id, { fecha_fin: fechaFin });
      return { id_cultivo: id, estado: 'finalizado' };
    });
  }
}
