import type { IBaseDatos } from '../ports/index.js';

/**
 * Tareas de mantenimiento de datos que ejecuta el worker:
 *  · anonimización de usuarios desactivados (ES2 Tabla 40, Ley 19.628);
 *  · aviso al Administrador cuando un respaldo falla (ES2 Tabla 16).
 * La compresión y la retención de mediciones las ejecuta TimescaleDB (migración 008).
 */
export class MantenimientoService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly anonimizarTrasDias: number,
    private readonly retencionMedicionesDias = 0,
  ) {}

  /** Devuelve cuántos usuarios se anonimizaron. Idempotente. */
  async anonimizarDesactivados(): Promise<number> {
    const r = await this.db.query<{ n: number }>(`SELECT fn_anonimizar_usuarios(make_interval(days => $1::int)) AS n`, [this.anonimizarTrasDias]);
    return r.rows[0].n;
  }

  /**
   * D-28: borra las solicitudes de registro que nadie confirmó (un día después de
   * vencer) y quita el email de sus correos. Devuelve cuántas se borraron.
   */
  async purgarRegistrosVencidos(): Promise<number> {
    return this.db.transaccion(async (tx) => {
      await tx.query(
        `UPDATE notificacion_correo n SET destinatario = 'eliminado', texto = '(solicitud de registro vencida y eliminada)'
           FROM registro_pendiente p
          WHERE n.id_registro = p.id_registro AND p.confirmado_en IS NULL AND p.expira_en < now() - interval '1 day' AND n.estado <> 'pendiente'`,
      );
      const r = await tx.query(
        `DELETE FROM registro_pendiente p
          WHERE p.confirmado_en IS NULL AND p.expira_en < now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM notificacion_correo n WHERE n.id_registro = p.id_registro AND n.estado = 'pendiente')`,
      );
      return r.rowCount ?? 0;
    });
  }

  /**
   * D-35: retención de mediciones crudas sin TimescaleDB. Borra por tandas (no bloquea
   * la ingesta) las mediciones más antiguas que RETENCION_MEDICIONES_DIAS. La evidencia
   * de las alertas vive en medicion_evidencia y no se toca. Devuelve cuántas se borraron.
   */
  async purgarMedicionesAntiguas(tanda = 20_000, maxTandas = 50): Promise<number> {
    if (this.retencionMedicionesDias <= 0) return 0;
    const ts = await this.db.query(`SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`);
    if (ts.rowCount) return 0; // con TimescaleDB la retención la hace la política de la migración 008
    let total = 0;
    for (let i = 0; i < maxTandas; i++) {
      const r = await this.db.query(
        `DELETE FROM medicion WHERE ctid IN (
           SELECT ctid FROM medicion WHERE ts < now() - make_interval(days => $1::int) LIMIT $2)`,
        [this.retencionMedicionesDias, tanda],
      );
      total += r.rowCount ?? 0;
      if ((r.rowCount ?? 0) < tanda) break;
    }
    return total;
  }

  /** D-31: sesiones vencidas o cerradas hace más de un día (minimización). */
  async purgarSesionesVencidas(): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM sesion WHERE expira_en < now() - interval '1 day' OR revocada_en < now() - interval '1 day'`,
    );
    return r.rowCount ?? 0;
  }

  /**
   * Por cada respaldo fallido sin avisar programa un correo a cada Administrador
   * activo (lo envía el ciclo `correos_cuenta`) y lo marca como notificado.
   */
  async avisarRespaldosFallidos(): Promise<number> {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ id_respaldo: string; terminado_en: Date; detalle: string | null }>(
        `SELECT id_respaldo, terminado_en, detalle FROM respaldo_registro
          WHERE estado = 'fallido' AND notificado_en IS NULL ORDER BY terminado_en FOR UPDATE SKIP LOCKED`,
      );
      for (const f of r.rows) {
        const cuando = new Date(f.terminado_en).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' });
        const texto = [
          'Hola:',
          '',
          `El respaldo automático de AquaPlants falló el ${cuando} (registro #${f.id_respaldo}).`,
          `Detalle: ${(f.detalle ?? 'sin detalle').slice(0, 500)}`,
          '',
          'Revise el proceso de respaldo y vuelva a ejecutarlo.',
          'Mientras no haya un respaldo correcto, el punto de recuperación (RPO 24 h) no está garantizado.',
          '',
          '— AquaPlants (mensaje automático, no respondas este correo)',
        ].join('\n');
        await tx.query(
          `INSERT INTO notificacion_correo (id_usuario, tipo, destinatario, asunto, texto)
           SELECT u.id_usuario, 'respaldo_fallido', u.email, '[AquaPlants] Falló el respaldo de la base de datos', $1
             FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
            WHERE r.nombre = 'administrador' AND u.activo`,
          [texto],
        );
        await tx.query(`UPDATE respaldo_registro SET notificado_en = now() WHERE id_respaldo = $1`, [f.id_respaldo]);
      }
      return r.rows.length;
    });
  }
}
