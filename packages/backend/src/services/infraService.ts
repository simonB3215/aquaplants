import type { IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar, registrarEvento } from './auditoria.js';
import { torresVisibles, type UsuarioCtx } from './acceso.js';
import { generarTokenDispositivo, hashToken } from './authService.js';

/**
 * CU-08 Gestionar torres, dispositivos y sensores. Lectura: todos los roles
 * (Encargado limitado a sus torres). Escritura: Administrador (ruta).
 * Bajas lógicas que preservan el histórico (RN-08).
 */
export class InfraService {
  constructor(private readonly db: IBaseDatos) {}

  // ------------------------------------------------------------ Torres
  async listarTorres(u: UsuarioCtx) {
    const vis = await torresVisibles(this.db, u);
    const r = await this.db.query(
      `SELECT i.id_instalacion, i.nombre, i.tipo, i.ubicacion, i.estado, i.creado_en,
              (SELECT count(*)::int FROM dispositivo d WHERE d.id_instalacion = i.id_instalacion AND d.estado <> 'baja') AS dispositivos,
              COALESCE((SELECT json_agg(json_build_object('id_usuario', us.id_usuario, 'nombre', us.nombre, 'rol', ro.nombre) ORDER BY us.nombre)
                 FROM usuario_instalacion ui JOIN usuario us ON us.id_usuario = ui.id_usuario JOIN rol ro ON ro.id_rol = us.id_rol
                WHERE ui.id_instalacion = i.id_instalacion), '[]') AS responsables
         FROM instalacion i WHERE ($1::int[] IS NULL OR i.id_instalacion = ANY($1::int[])) ORDER BY i.estado, i.nombre`,
      [vis],
    );
    return r.rows;
  }

  async crearTorre(u: UsuarioCtx, d: { nombre: string; tipo: string; ubicacion: string }) {
    return this.db.transaccion(async (tx) => {
      const dup = await tx.query(`SELECT 1 FROM instalacion WHERE lower(nombre) = lower($1)`, [d.nombre]);
      if (dup.rowCount) throw new ConflictoError('Ya existe una torre con ese nombre', 'NOMBRE_DUPLICADO');
      const r = await tx.query<{ id_instalacion: number }>(
        `INSERT INTO instalacion (nombre, tipo, ubicacion) VALUES ($1, $2, $3) RETURNING *`,
        [d.nombre, d.tipo, d.ubicacion],
      );
      await auditar(tx, u, 'crear_torre', 'instalacion', r.rows[0].id_instalacion, { nuevo: d });
      return r.rows[0];
    });
  }

  async editarTorre(u: UsuarioCtx, id: number, d: Partial<{ nombre: string; tipo: string; ubicacion: string }>) {
    return this.db.transaccion(async (tx) => {
      const prev = await tx.query<{ nombre: string; tipo: string; ubicacion: string; estado: string }>(`SELECT * FROM instalacion WHERE id_instalacion = $1 FOR UPDATE`, [id]);
      if (!prev.rows[0]) throw new NoEncontradoError('Torre no encontrada');
      if (d.nombre) {
        const dup = await tx.query(`SELECT 1 FROM instalacion WHERE lower(nombre) = lower($1) AND id_instalacion <> $2`, [d.nombre, id]);
        if (dup.rowCount) throw new ConflictoError('Ya existe una torre con ese nombre', 'NOMBRE_DUPLICADO');
      }
      const r = await tx.query(
        `UPDATE instalacion SET nombre = COALESCE($2, nombre), tipo = COALESCE($3, tipo), ubicacion = COALESCE($4, ubicacion)
          WHERE id_instalacion = $1 RETURNING *`,
        [id, d.nombre ?? null, d.tipo ?? null, d.ubicacion ?? null],
      );
      await auditar(tx, u, 'editar_torre', 'instalacion', id, { anterior: prev.rows[0], nuevo: d });
      return r.rows[0];
    });
  }

  async bajaTorre(u: UsuarioCtx, id: number, motivo: string) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ estado: string }>(`SELECT estado FROM instalacion WHERE id_instalacion = $1 FOR UPDATE`, [id]);
      if (!r.rows[0]) throw new NoEncontradoError('Torre no encontrada');
      if (r.rows[0].estado === 'baja') throw new ConflictoError('La torre ya está de baja');
      const activos = await tx.query(`SELECT 1 FROM dispositivo WHERE id_instalacion = $1 AND estado <> 'baja'`, [id]);
      if (activos.rowCount) throw new ConflictoError('Dé de baja primero los dispositivos de la torre', 'TORRE_CON_DISPOSITIVOS');
      await tx.query(`UPDATE instalacion SET estado = 'baja' WHERE id_instalacion = $1`, [id]);
      await auditar(tx, u, 'baja_torre', 'instalacion', id, { motivo });
      return { id_instalacion: id, estado: 'baja' };
    });
  }

  async asignarUsuarios(u: UsuarioCtx, idTorre: number, usuarios: number[]) {
    return this.db.transaccion(async (tx) => {
      const t = await tx.query(`SELECT 1 FROM instalacion WHERE id_instalacion = $1`, [idTorre]);
      if (!t.rowCount) throw new NoEncontradoError('Torre no encontrada');
      const prev = await tx.query<{ id_usuario: number }>(`SELECT id_usuario FROM usuario_instalacion WHERE id_instalacion = $1`, [idTorre]);
      await tx.query(`DELETE FROM usuario_instalacion WHERE id_instalacion = $1 AND NOT (id_usuario = ANY($2::int[]))`, [idTorre, usuarios]);
      await tx.query(
        `INSERT INTO usuario_instalacion (id_usuario, id_instalacion) SELECT x, $1 FROM unnest($2::int[]) x ON CONFLICT DO NOTHING`,
        [idTorre, usuarios],
      );
      await auditar(tx, u, 'asignar_usuarios_torre', 'instalacion', idTorre, { anterior: prev.rows.map((x) => x.id_usuario), nuevo: usuarios });
      return { id_instalacion: idTorre, usuarios };
    });
  }

  // ------------------------------------------------------------ Dispositivos
  async listarDispositivos(u: UsuarioCtx) {
    const vis = await torresVisibles(this.db, u);
    const r = await this.db.query(
      `SELECT d.id_dispositivo, d.nombre, d.id_instalacion, i.nombre AS torre, d.estado, d.intervalo_muestreo_s,
              d.ultima_comunicacion, d.motivo_baja,
              COALESCE((SELECT json_agg(json_build_object('id_sensor', s.id_sensor, 'id_tipo_variable', s.id_tipo_variable,
                         'tipo_variable', tv.nombre, 'unidad', tv.unidad_medida, 'estado', s.estado) ORDER BY s.id_sensor)
                  FROM sensor s JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable WHERE s.id_dispositivo = d.id_dispositivo), '[]') AS sensores
         FROM dispositivo d JOIN instalacion i ON i.id_instalacion = d.id_instalacion
        WHERE ($1::int[] IS NULL OR d.id_instalacion = ANY($1::int[])) ORDER BY i.nombre, d.nombre`,
      [vis],
    );
    return r.rows;
  }

  /** Alta: genera credencial de 256 bits, guarda solo su SHA-256 y la devuelve UNA vez. */
  async crearDispositivo(u: UsuarioCtx, d: { nombre: string; id_instalacion: number; intervalo_muestreo_s: number }) {
    return this.db.transaccion(async (tx) => {
      const t = await tx.query<{ estado: string }>(`SELECT estado FROM instalacion WHERE id_instalacion = $1`, [d.id_instalacion]);
      if (!t.rows[0]) throw new ReglaNegocioError('La torre indicada no existe', [{ campo: 'id_instalacion', mensaje: 'No existe' }]);
      if (t.rows[0].estado !== 'activo') throw new ConflictoError('La torre de destino está de baja');
      const token = generarTokenDispositivo();
      const r = await tx.query<{ id_dispositivo: number }>(
        `INSERT INTO dispositivo (id_instalacion, nombre, credencial_hash, intervalo_muestreo_s) VALUES ($1, $2, $3, $4)
         RETURNING id_dispositivo, id_instalacion, nombre, estado, intervalo_muestreo_s`,
        [d.id_instalacion, d.nombre, hashToken(token), d.intervalo_muestreo_s],
      );
      const id = r.rows[0].id_dispositivo;
      await registrarEvento(tx, id, 'alta', 'Dispositivo registrado', { id_instalacion: d.id_instalacion });
      await auditar(tx, u, 'crear_dispositivo', 'dispositivo', id, { nuevo: d }); // nunca la credencial
      return { ...r.rows[0], credencial: token, aviso: 'La credencial se muestra una sola vez. Cárguela en la placa.' };
    });
  }

  async editarDispositivo(u: UsuarioCtx, id: number, d: { nombre?: string; id_instalacion?: number; intervalo_muestreo_s?: number }) {
    return this.db.transaccion(async (tx) => {
      const prev = await tx.query<{ estado: string }>(`SELECT nombre, id_instalacion, intervalo_muestreo_s, estado FROM dispositivo WHERE id_dispositivo = $1 FOR UPDATE`, [id]);
      if (!prev.rows[0]) throw new NoEncontradoError('Dispositivo no encontrado');
      if (prev.rows[0].estado === 'baja') throw new ConflictoError('El dispositivo está de baja');
      if (d.id_instalacion) {
        const t = await tx.query<{ estado: string }>(`SELECT estado FROM instalacion WHERE id_instalacion = $1`, [d.id_instalacion]);
        if (!t.rows[0]) throw new ReglaNegocioError('La torre indicada no existe');
        if (t.rows[0].estado !== 'activo') throw new ConflictoError('La torre de destino está de baja');
      }
      const r = await tx.query(
        `UPDATE dispositivo SET nombre = COALESCE($2, nombre), id_instalacion = COALESCE($3, id_instalacion),
                intervalo_muestreo_s = COALESCE($4, intervalo_muestreo_s) WHERE id_dispositivo = $1
         RETURNING id_dispositivo, nombre, id_instalacion, estado, intervalo_muestreo_s`,
        [id, d.nombre ?? null, d.id_instalacion ?? null, d.intervalo_muestreo_s ?? null],
      );
      await auditar(tx, u, 'editar_dispositivo', 'dispositivo', id, { anterior: prev.rows[0], nuevo: d });
      return r.rows[0];
    });
  }

  async bajaDispositivo(u: UsuarioCtx, id: number, motivo: string) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ estado: string }>(`SELECT estado FROM dispositivo WHERE id_dispositivo = $1 FOR UPDATE`, [id]);
      if (!r.rows[0]) throw new NoEncontradoError('Dispositivo no encontrado');
      if (r.rows[0].estado === 'baja') throw new ConflictoError('El dispositivo ya está de baja');
      // UPDATE, no DELETE: se conserva el histórico; la credencial queda revocada (estado = baja).
      await tx.query(`UPDATE dispositivo SET estado = 'baja', motivo_baja = $2 WHERE id_dispositivo = $1`, [id, motivo]);
      await tx.query(`UPDATE sensor SET estado = 'baja' WHERE id_dispositivo = $1`, [id]);
      await registrarEvento(tx, id, 'baja', 'Dispositivo dado de baja; credencial revocada', { motivo });
      await auditar(tx, u, 'baja_dispositivo', 'dispositivo', id, { motivo });
      return { id_dispositivo: id, estado: 'baja' };
    });
  }

  async regenerarCredencial(u: UsuarioCtx, id: number) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ estado: string }>(`SELECT estado FROM dispositivo WHERE id_dispositivo = $1 FOR UPDATE`, [id]);
      if (!r.rows[0]) throw new NoEncontradoError('Dispositivo no encontrado');
      if (r.rows[0].estado === 'baja') throw new ConflictoError('El dispositivo está de baja');
      const token = generarTokenDispositivo();
      await tx.query(`UPDATE dispositivo SET credencial_hash = $2 WHERE id_dispositivo = $1`, [id, hashToken(token)]);
      await registrarEvento(tx, id, 'credencial_regenerada', 'Credencial regenerada; la anterior quedó inválida', null);
      await auditar(tx, u, 'regenerar_credencial', 'dispositivo', id, null);
      return { id_dispositivo: id, credencial: token, aviso: 'La credencial se muestra una sola vez. La anterior ya no es válida.' };
    });
  }

  // ------------------------------------------------------------ Sensores
  async crearSensor(u: UsuarioCtx, d: { id_dispositivo: number; id_tipo_variable: number }) {
    return this.db.transaccion(async (tx) => {
      const disp = await tx.query<{ estado: string }>(`SELECT estado FROM dispositivo WHERE id_dispositivo = $1`, [d.id_dispositivo]);
      if (!disp.rows[0]) throw new ReglaNegocioError('El dispositivo no existe', [{ campo: 'id_dispositivo', mensaje: 'No existe' }]);
      if (disp.rows[0].estado === 'baja') throw new ConflictoError('El dispositivo está de baja');
      const tv = await tx.query(`SELECT 1 FROM tipo_variable WHERE id_tipo_variable = $1`, [d.id_tipo_variable]);
      if (!tv.rowCount) throw new ReglaNegocioError('Tipo de variable inexistente', [{ campo: 'id_tipo_variable', mensaje: 'No existe' }]);
      const r = await tx.query<{ id_sensor: number }>(
        `INSERT INTO sensor (id_dispositivo, id_tipo_variable) VALUES ($1, $2) RETURNING *`,
        [d.id_dispositivo, d.id_tipo_variable],
      );
      await auditar(tx, u, 'crear_sensor', 'sensor', r.rows[0].id_sensor, { nuevo: d });
      return r.rows[0];
    });
  }

  async bajaSensor(u: UsuarioCtx, id: number, motivo: string) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ estado: string; id_dispositivo: number }>(`SELECT estado, id_dispositivo FROM sensor WHERE id_sensor = $1 FOR UPDATE`, [id]);
      if (!r.rows[0]) throw new NoEncontradoError('Sensor no encontrado');
      if (r.rows[0].estado === 'baja') throw new ConflictoError('El sensor ya está de baja');
      await tx.query(`UPDATE sensor SET estado = 'baja' WHERE id_sensor = $1`, [id]);
      await registrarEvento(tx, r.rows[0].id_dispositivo, 'baja', `Sensor ${id} dado de baja`, { id_sensor: id, motivo });
      await auditar(tx, u, 'baja_sensor', 'sensor', id, { motivo });
      return { id_sensor: id, estado: 'baja' };
    });
  }

  async catalogos() {
    const [tipos, especies, rangos] = await Promise.all([
      this.db.query(`SELECT id_tipo_variable, nombre, clave, unidad_medida AS unidad, min_fisico, max_fisico FROM tipo_variable ORDER BY id_tipo_variable`),
      this.db.query(`SELECT id_especie, nombre, descripcion FROM especie ORDER BY nombre`),
      this.db.query(`SELECT id_especie, id_tipo_variable, valor_min, valor_max FROM rango_referencia`),
    ]);
    return { tipos_variable: tipos.rows, especies: especies.rows, rangos_referencia: rangos.rows };
  }
}
