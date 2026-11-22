import { accedeATodasLasTorres, type Rol } from '@aquaplants/shared';
import type { Consulta } from '../ports/index.js';
import { NoAutorizadoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';

export interface UsuarioCtx {
  id_usuario: number;
  rol: Rol;
  ip: string | null;
}

/**
 * RN-10 modificada (Anexo C, D-37): ids de torres visibles para el usuario, o `null` si ve todas.
 *  · Administrador y Administrador principal: todas.
 *  · Supervisor: las torres de su cliente.
 *  · Encargado: sus torres asignadas que además sean de su cliente (RN-11).
 *  · Técnico: las torres de los clientes que atiende.
 *  · Cualquier otro caso (rol desconocido, usuario sin cliente): ninguna.
 * El filtrado de filas se hace SIEMPRE en el backend.
 */
export async function torresVisibles(db: Consulta, u: UsuarioCtx): Promise<number[] | null> {
  if (accedeATodasLasTorres(u.rol)) return null;
  let sql: string;
  if (u.rol === 'supervisor') {
    sql = `SELECT i.id_instalacion FROM usuario us JOIN instalacion i ON i.id_cliente = us.id_cliente WHERE us.id_usuario = $1`;
  } else if (u.rol === 'encargado') {
    sql = `SELECT ui.id_instalacion FROM usuario_instalacion ui
             JOIN usuario us ON us.id_usuario = ui.id_usuario
             JOIN instalacion i ON i.id_instalacion = ui.id_instalacion AND i.id_cliente = us.id_cliente
            WHERE ui.id_usuario = $1`;
  } else if (u.rol === 'tecnico') {
    sql = `SELECT i.id_instalacion FROM tecnico_cliente tc JOIN instalacion i ON i.id_cliente = tc.id_cliente WHERE tc.id_usuario = $1`;
  } else {
    return [];
  }
  const r = await db.query<{ id_instalacion: number }>(sql, [u.id_usuario]);
  return r.rows.map((x) => x.id_instalacion);
}

/** Cliente del Supervisor/Encargado (null si no tiene). */
export async function clienteDe(db: Consulta, idUsuario: number): Promise<number | null> {
  const r = await db.query<{ id_cliente: number | null }>(`SELECT id_cliente FROM usuario WHERE id_usuario = $1`, [idUsuario]);
  return r.rows[0]?.id_cliente ?? null;
}

/**
 * Cliente a usar cuando el Administrador no lo indica: solo si existe un único cliente
 * activo (así la API anterior, sin clientes, sigue funcionando con una sola empresa).
 */
export async function clientePorDefecto(db: Consulta, idCliente: number | undefined, campo = 'id_cliente'): Promise<number> {
  if (idCliente !== undefined) {
    const r = await db.query<{ estado: string }>(`SELECT estado FROM cliente WHERE id_cliente = $1`, [idCliente]);
    if (!r.rows[0]) throw new ReglaNegocioError('El cliente indicado no existe', [{ campo, mensaje: 'No existe' }]);
    if (r.rows[0].estado !== 'activo') throw new ReglaNegocioError('El cliente está de baja', [{ campo, mensaje: 'Cliente de baja' }], 'CLIENTE_DE_BAJA');
    return idCliente;
  }
  const r = await db.query<{ id_cliente: number }>(`SELECT id_cliente FROM cliente WHERE estado = 'activo' ORDER BY id_cliente LIMIT 2`);
  if (r.rows.length !== 1) throw new ReglaNegocioError('Indique el cliente', [{ campo, mensaje: 'Seleccione un cliente' }], 'CLIENTE_REQUERIDO');
  return r.rows[0].id_cliente;
}

/** Lanza 404 si la torre no existe y 403 si no está en el alcance del usuario (NEG-02). */
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
