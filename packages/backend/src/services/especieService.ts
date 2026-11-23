import type { Consulta as ITransaccion, IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import type { UsuarioCtx } from './acceso.js';

type Rango = { id_tipo_variable: number; valor_min: number; valor_max: number };

/**
 * Catálogo de especies con sus rangos de referencia (antes fijo por el seed).
 * Solo los Administradores lo gestionan (ruta); todos lo leen por /catalogos.
 * Baja lógica: la especie deja de ofrecerse para cultivos nuevos, pero no se puede
 * dar de baja mientras tenga cultivos en curso. Los cultivos finalizados la conservan.
 */
export class EspecieService {
  constructor(private readonly db: IBaseDatos) {}

  async listar() {
    const r = await this.db.query(
      `SELECT e.id_especie, e.nombre, e.descripcion, e.estado,
              (SELECT count(*)::int FROM cultivo c WHERE c.id_especie = e.id_especie AND c.estado = 'en_curso') AS cultivos_en_curso,
              (SELECT count(*)::int FROM cultivo c WHERE c.id_especie = e.id_especie) AS cultivos_total,
              COALESCE((SELECT json_agg(json_build_object('id_tipo_variable', rr.id_tipo_variable, 'valor_min', rr.valor_min, 'valor_max', rr.valor_max)
                                       ORDER BY rr.id_tipo_variable)
                          FROM rango_referencia rr WHERE rr.id_especie = e.id_especie), '[]') AS rangos
         FROM especie e ORDER BY e.estado, e.nombre`,
    );
    return r.rows;
  }

  async crear(u: UsuarioCtx, d: { nombre: string; descripcion: string; rangos: Rango[] }) {
    return this.db.transaccion(async (tx) => {
      await this.nombreLibre(tx, d.nombre);
      await this.validarRangos(tx, d.rangos);
      const r = await tx.query<{ id_especie: number }>(
        `INSERT INTO especie (nombre, descripcion) VALUES ($1, $2) RETURNING id_especie, nombre, descripcion, estado`,
        [d.nombre, d.descripcion],
      );
      const id = r.rows[0].id_especie;
      await this.guardarRangos(tx, id, d.rangos);
      await auditar(tx, u, 'crear_especie', 'especie', id, { nombre: d.nombre, rangos: d.rangos.length });
      return r.rows[0];
    });
  }

  async editar(u: UsuarioCtx, id: number, d: { nombre?: string; descripcion?: string; rangos?: Rango[]; estado?: 'activo' | 'baja' }) {
    return this.db.transaccion(async (tx) => {
      const prev = await tx.query<{ nombre: string; descripcion: string; estado: string }>(
        `SELECT nombre, descripcion, estado FROM especie WHERE id_especie = $1 FOR UPDATE`,
        [id],
      );
      if (!prev.rows[0]) throw new NoEncontradoError('Especie no encontrada');
      if (d.nombre) await this.nombreLibre(tx, d.nombre, id);
      if (d.estado === 'baja' && prev.rows[0].estado !== 'baja') {
        const uso = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM cultivo WHERE id_especie = $1 AND estado = 'en_curso'`, [id]);
        if (uso.rows[0].n) throw new ConflictoError(`La especie tiene ${uso.rows[0].n} cultivo(s) en curso: ciérrelos antes de darla de baja`, 'ESPECIE_EN_USO');
      }
      if (d.rangos) {
        await this.validarRangos(tx, d.rangos);
        await tx.query(`DELETE FROM rango_referencia WHERE id_especie = $1`, [id]);
        await this.guardarRangos(tx, id, d.rangos);
      }
      const r = await tx.query(
        `UPDATE especie SET nombre = COALESCE($2, nombre), descripcion = COALESCE($3, descripcion), estado = COALESCE($4, estado)
          WHERE id_especie = $1 RETURNING id_especie, nombre, descripcion, estado`,
        [id, d.nombre ?? null, d.descripcion ?? null, d.estado ?? null],
      );
      const accion = d.estado === 'baja' ? 'baja_especie' : d.estado === 'activo' && prev.rows[0].estado === 'baja' ? 'reactivar_especie' : 'editar_especie';
      await auditar(tx, u, accion, 'especie', id, { anterior: prev.rows[0], nuevo: { ...d, rangos: d.rangos?.length } });
      return r.rows[0];
    });
  }

  private async nombreLibre(tx: ITransaccion, nombre: string, id?: number) {
    const dup = await tx.query(`SELECT 1 FROM especie WHERE lower(nombre) = lower($1) AND id_especie <> COALESCE($2, -1)`, [nombre, id ?? null]);
    if (dup.rowCount) throw new ConflictoError('Ya existe una especie con ese nombre', 'NOMBRE_DUPLICADO');
  }

  /** Cada rango debe ser de una variable existente y caber en sus límites físicos. */
  private async validarRangos(tx: ITransaccion, rangos: Rango[]) {
    if (!rangos.length) return;
    const t = await tx.query<{ id_tipo_variable: number; nombre: string; min_fisico: number | null; max_fisico: number | null }>(
      `SELECT id_tipo_variable, nombre, min_fisico, max_fisico FROM tipo_variable WHERE id_tipo_variable = ANY($1::int[])`,
      [rangos.map((r) => r.id_tipo_variable)],
    );
    const tipos = new Map(t.rows.map((x) => [x.id_tipo_variable, x]));
    const errores = rangos.flatMap((r, i) => {
      const tv = tipos.get(r.id_tipo_variable);
      if (!tv) return [{ campo: `rangos.${i}.id_tipo_variable`, mensaje: 'Variable inexistente' }];
      if ((tv.min_fisico !== null && r.valor_min < tv.min_fisico) || (tv.max_fisico !== null && r.valor_max > tv.max_fisico)) {
        return [{ campo: `rangos.${i}`, mensaje: `${tv.nombre}: fuera del rango físico (${tv.min_fisico ?? '−∞'} a ${tv.max_fisico ?? '∞'})` }];
      }
      return [];
    });
    if (errores.length) throw new ReglaNegocioError('Rangos de referencia inválidos', errores);
  }

  private async guardarRangos(tx: ITransaccion, id: number, rangos: Rango[]) {
    for (const r of rangos) {
      await tx.query(`INSERT INTO rango_referencia (id_especie, id_tipo_variable, valor_min, valor_max) VALUES ($1, $2, $3, $4)`, [id, r.id_tipo_variable, r.valor_min, r.valor_max]);
    }
  }
}
