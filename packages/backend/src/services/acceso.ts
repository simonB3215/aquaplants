import { accedeATodasLasTorres, type Rol } from '@aquaplants/shared';
import type { Consulta } from '../ports/index.js';
import { NoAutorizadoError, NoEncontradoError } from '../errores.js';

export interface UsuarioCtx {
  id_usuario: number;
  rol: Rol;
  ip: string | null;
}

/**
 * RN-10: devuelve los ids de torres visibles para el usuario o `null` si ve todas.
 * El filtrado de filas se hace SIEMPRE en el backend.
 */
export async function torresVisibles(db: Consulta, u: UsuarioCtx): Promise<number[] | null> {
  if (accedeATodasLasTorres(u.rol)) return null;
  const r = await db.query<{ id_instalacion: number }>(
    `SELECT id_instalacion FROM usuario_instalacion WHERE id_usuario = $1`,
    [u.id_usuario],
  );
  return r.rows.map((x) => x.id_instalacion);
}

/** Lanza 404 si la torre no existe y 403 si el Encargado no la tiene asignada (NEG-02). */
export async function exigirAccesoTorre(db: Consulta, u: UsuarioCtx, idInstalacion: number): Promise<void> {
  const r = await db.query(`SELECT 1 FROM instalacion WHERE id_instalacion = $1`, [idInstalacion]);
  if (!r.rowCount) throw new NoEncontradoError('Torre no encontrada');
  const vis = await torresVisibles(db, u);
  if (vis && !vis.includes(idInstalacion)) throw new NoAutorizadoError('La torre no está asignada a su usuario', 'TORRE_NO_ASIGNADA');
}

/** Torre a la que pertenece un sensor (para aplicar RN-10). */
export async function torreDeSensor(db: Consulta, idSensor: number): Promise<number> {
  const r = await db.query<{ id_instalacion: number }>(
    `SELECT d.id_instalacion FROM sensor s JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo WHERE s.id_sensor = $1`,
    [idSensor],
  );
  if (!r.rows[0]) throw new NoEncontradoError('Sensor no encontrado');
  return r.rows[0].id_instalacion;
}
