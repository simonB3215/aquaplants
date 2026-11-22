import type { IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoEncontradoError } from '../errores.js';
import { auditar } from './auditoria.js';
import type { UsuarioCtx } from './acceso.js';

/**
 * D-37 / RN-11: clientes de AquaPlants. Cada torre pertenece a un cliente y cada
 * Supervisor/Encargado a uno. Solo los Administradores los gestionan (ruta).
 * Baja lógica: solo si el cliente ya no tiene torres activas ni usuarios activos.
 */
export class ClienteService {
  constructor(private readonly db: IBaseDatos) {}

  async listar() {
    const r = await this.db.query(
      `SELECT c.id_cliente, c.nombre, c.estado, c.creado_en,
              (SELECT count(*)::int FROM instalacion i WHERE i.id_cliente = c.id_cliente AND i.estado = 'activo') AS torres,
              (SELECT count(*)::int FROM usuario u WHERE u.id_cliente = c.id_cliente AND u.activo) AS usuarios,
              (SELECT count(*)::int FROM tecnico_cliente tc JOIN usuario u ON u.id_usuario = tc.id_usuario
                WHERE tc.id_cliente = c.id_cliente AND u.activo) AS tecnicos
         FROM cliente c ORDER BY c.estado, c.nombre`,
    );
    return r.rows;
  }

  async crear(u: UsuarioCtx, d: { nombre: string }) {
    return this.db.transaccion(async (tx) => {
      const dup = await tx.query(`SELECT 1 FROM cliente WHERE lower(nombre) = lower($1)`, [d.nombre]);
      if (dup.rowCount) throw new ConflictoError('Ya existe un cliente con ese nombre', 'NOMBRE_DUPLICADO');
      const r = await tx.query<{ id_cliente: number }>(`INSERT INTO cliente (nombre) VALUES ($1) RETURNING id_cliente, nombre, estado`, [d.nombre]);
      await auditar(tx, u, 'crear_cliente', 'cliente', r.rows[0].id_cliente, { nombre: d.nombre });
      return r.rows[0];
    });
  }

  async editar(u: UsuarioCtx, id: number, d: { nombre?: string; estado?: 'activo' | 'baja' }) {
    return this.db.transaccion(async (tx) => {
      const prev = await tx.query<{ nombre: string; estado: string }>(`SELECT nombre, estado FROM cliente WHERE id_cliente = $1 FOR UPDATE`, [id]);
      if (!prev.rows[0]) throw new NoEncontradoError('Cliente no encontrado');
      if (d.nombre) {
        const dup = await tx.query(`SELECT 1 FROM cliente WHERE lower(nombre) = lower($1) AND id_cliente <> $2`, [d.nombre, id]);
        if (dup.rowCount) throw new ConflictoError('Ya existe un cliente con ese nombre', 'NOMBRE_DUPLICADO');
      }
      if (d.estado === 'baja' && prev.rows[0].estado !== 'baja') {
        const uso = await tx.query<{ torres: number; usuarios: number }>(
          `SELECT (SELECT count(*)::int FROM instalacion WHERE id_cliente = $1 AND estado = 'activo') AS torres,
                  (SELECT count(*)::int FROM usuario WHERE id_cliente = $1 AND activo) AS usuarios`,
          [id],
        );
        if (uso.rows[0].torres || uso.rows[0].usuarios) {
          throw new ConflictoError('Dé de baja o mueva primero las torres y desactive los usuarios del cliente', 'CLIENTE_EN_USO');
        }
      }
      const r = await tx.query(
        `UPDATE cliente SET nombre = COALESCE($2, nombre), estado = COALESCE($3, estado) WHERE id_cliente = $1 RETURNING id_cliente, nombre, estado`,
        [id, d.nombre ?? null, d.estado ?? null],
      );
      await auditar(tx, u, d.estado === 'baja' ? 'baja_cliente' : 'editar_cliente', 'cliente', id, { anterior: prev.rows[0], nuevo: d });
      return r.rows[0];
    });
  }
}
