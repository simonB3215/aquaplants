import bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'node:crypto';
import { puedeGestionarRol, rolConCliente, rolesAsignables, type Rol } from '@aquaplants/shared';
import type { Consulta, IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoAutorizadoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import { BCRYPT_COSTO } from './authService.js';
import { clienteDe, clientePorDefecto, type UsuarioCtx } from './acceso.js';

/** Contraseña temporal que cumple la política (letras y números, 14 caracteres). */
function passwordTemporal(): string {
  const base = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  return `${base.slice(0, 10)}A${randomInt(1, 10)}b${randomInt(0, 10)}`;
}

/** Anexo C: el sistema conserva al menos dos Administradores activos. */
export const MINIMO_ADMINISTRADORES = 2;

type Objetivo = { id_usuario: number; nombre: string; rol: Rol; activo: boolean; anonimizado: boolean; id_cliente: number | null };

const noGestionable = () => new NoAutorizadoError('Su rol no puede gestionar ese tipo de usuario (RN-12)', 'ROL_NO_GESTIONABLE');

/**
 * CU-09 Gestionar usuarios y auditoría, con el alcance del Anexo C (RN-11, RN-12):
 *  · Administrador: Encargados, Supervisores y Técnicos de todos los clientes.
 *  · Administrador principal: además, Administradores.
 *  · Supervisor: solo los Encargados de su cliente (crear, desactivar, asignar torres).
 *  · Nadie crea ni modifica un Administrador principal desde la aplicación.
 * Un usuario fuera del alcance del Supervisor responde 404 (no revela que existe).
 */
export class UsuarioService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly alRevocar: (id: number) => void,
  ) {}

  async listar(u: UsuarioCtx) {
    const soloCliente = u.rol === 'supervisor' ? await clienteDe(this.db, u.id_usuario) : null;
    if (u.rol === 'supervisor' && soloCliente === null) return [];
    const r = await this.db.query(
      `SELECT u.id_usuario, u.nombre, u.email, r.nombre AS rol, u.activo, u.debe_cambiar_password, u.creado_en, (u.anonimizado_en IS NOT NULL) AS anonimizado,
              (u.bloqueado_hasta IS NOT NULL AND u.bloqueado_hasta > now()) AS bloqueado, u.id_cliente, c.nombre AS cliente,
              COALESCE((SELECT json_agg(ui.id_instalacion ORDER BY ui.id_instalacion) FROM usuario_instalacion ui WHERE ui.id_usuario = u.id_usuario), '[]') AS torres,
              COALESCE((SELECT json_agg(tc.id_cliente ORDER BY tc.id_cliente) FROM tecnico_cliente tc WHERE tc.id_usuario = u.id_usuario), '[]') AS clientes
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol LEFT JOIN cliente c ON c.id_cliente = u.id_cliente
        WHERE ($1::int IS NULL OR (u.id_cliente = $1 AND r.nombre = 'encargado'))
        ORDER BY u.activo DESC, u.nombre`,
      [soloCliente],
    );
    return r.rows;
  }

  /** Roles que el usuario actual puede asignar. */
  async roles(u: UsuarioCtx) {
    const r = await this.db.query<{ nombre: Rol }>(`SELECT id_rol, nombre, descripcion FROM rol ORDER BY id_rol`);
    const asignables = rolesAsignables(u.rol);
    return r.rows.filter((x) => asignables.includes(x.nombre));
  }

  /** Cliente que corresponde al nuevo rol (RN-11). El Supervisor siempre usa el suyo. */
  private async resolverCliente(tx: Consulta, u: UsuarioCtx, rol: Rol, pedido: number | undefined, anterior: number | null): Promise<number | null> {
    if (!rolConCliente(rol)) {
      if (pedido !== undefined) throw new ReglaNegocioError('Solo Supervisores y Encargados pertenecen a un cliente', [{ campo: 'id_cliente', mensaje: 'No aplica a este rol' }]);
      return null;
    }
    if (u.rol === 'supervisor') {
      const propio = await clienteDe(tx, u.id_usuario);
      if (propio === null || (pedido !== undefined && pedido !== propio)) throw noGestionable();
      return clientePorDefecto(tx, propio);
    }
    return clientePorDefecto(tx, pedido ?? anterior ?? undefined);
  }

  private async asignarTorres(tx: Consulta, idUsuario: number, torres: number[], idCliente: number | null) {
    const ok = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM instalacion WHERE id_instalacion = ANY($1::int[]) AND id_cliente = $2`,
      [torres, idCliente],
    );
    // Mismo mensaje si la torre no existe o es de otro cliente: no revela torres ajenas.
    if (ok.rows[0].n !== new Set(torres).size) throw new ReglaNegocioError('Alguna torre indicada no existe o no es del cliente', [{ campo: 'torres', mensaje: 'Torre inexistente o de otro cliente' }]);
    await tx.query(`DELETE FROM usuario_instalacion WHERE id_usuario = $1 AND NOT (id_instalacion = ANY($2::int[]))`, [idUsuario, torres]);
    await tx.query(`INSERT INTO usuario_instalacion (id_usuario, id_instalacion) SELECT $1, x FROM unnest($2::int[]) x ON CONFLICT DO NOTHING`, [idUsuario, torres]);
  }

  private async asignarClientes(tx: Consulta, idUsuario: number, clientes: number[]) {
    const ok = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM cliente WHERE id_cliente = ANY($1::int[]) AND estado = 'activo'`, [clientes]);
    if (ok.rows[0].n !== new Set(clientes).size) throw new ReglaNegocioError('Algún cliente no existe o está de baja', [{ campo: 'clientes', mensaje: 'Cliente inexistente o de baja' }]);
    await tx.query(`DELETE FROM tecnico_cliente WHERE id_usuario = $1 AND NOT (id_cliente = ANY($2::int[]))`, [idUsuario, clientes]);
    await tx.query(`INSERT INTO tecnico_cliente (id_usuario, id_cliente) SELECT $1, x FROM unnest($2::int[]) x ON CONFLICT DO NOTHING`, [idUsuario, clientes]);
  }

  private validarExtras(rol: Rol, d: { torres?: number[]; clientes?: number[] }) {
    if (d.torres?.length && rol !== 'encargado') throw new ReglaNegocioError('Solo los Encargados tienen torres asignadas', [{ campo: 'torres', mensaje: 'No aplica a este rol' }]);
    if (d.clientes?.length && rol !== 'tecnico') throw new ReglaNegocioError('Solo los Técnicos atienden clientes', [{ campo: 'clientes', mensaje: 'No aplica a este rol' }]);
  }

  /** Carga el usuario objetivo y comprueba que esté en el alcance de quien actúa. */
  private async objetivo(tx: Consulta, u: UsuarioCtx, id: number, bloquear: boolean): Promise<Objetivo> {
    const r = await tx.query<Objetivo>(
      `SELECT u.id_usuario, u.nombre, r.nombre AS rol, u.activo, (u.anonimizado_en IS NOT NULL) AS anonimizado, u.id_cliente
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1 ${bloquear ? 'FOR UPDATE OF u' : ''}`,
      [id],
    );
    const o = r.rows[0];
    if (!o) throw new NoEncontradoError('Usuario no encontrado');
    if (id === u.id_usuario) return o; // las reglas sobre uno mismo se aplican aparte
    if (u.rol === 'supervisor') {
      const propio = await clienteDe(tx, u.id_usuario);
      if (o.rol !== 'encargado' || propio === null || o.id_cliente !== propio) throw new NoEncontradoError('Usuario no encontrado');
      return o;
    }
    if (!puedeGestionarRol(u.rol, o.rol)) throw noGestionable();
    return o;
  }

  async crear(u: UsuarioCtx, d: { nombre: string; email: string; rol: Rol; torres?: number[]; id_cliente?: number; clientes?: number[] }) {
    if (!puedeGestionarRol(u.rol, d.rol)) throw noGestionable();
    this.validarExtras(d.rol, d);
    const temporal = passwordTemporal();
    const hash = await bcrypt.hash(temporal, BCRYPT_COSTO);
    return this.db.transaccion(async (tx) => {
      const idCliente = await this.resolverCliente(tx, u, d.rol, d.id_cliente, null);
      const dup = await tx.query(`SELECT 1 FROM usuario WHERE lower(email) = lower($1)`, [d.email]);
      if (dup.rowCount) throw new ConflictoError('El email ya está registrado', 'EMAIL_DUPLICADO');
      const r = await tx.query<{ id_usuario: number }>(
        `INSERT INTO usuario (nombre, email, hash_password, id_rol, debe_cambiar_password, aviso_alertas, id_cliente)
         VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4::text), true,
                 CASE WHEN $4::text IN ('administrador', 'administrador_principal') THEN 'ninguna' ELSE 'todas' END, $5) RETURNING id_usuario`,
        [d.nombre, d.email, hash, d.rol, idCliente],
      );
      const id = r.rows[0].id_usuario;
      if (d.torres?.length) await this.asignarTorres(tx, id, d.torres, idCliente);
      if (d.clientes?.length) await this.asignarClientes(tx, id, d.clientes);
      await auditar(tx, u, 'crear_usuario', 'usuario', id, {
        nombre: d.nombre,
        email: d.email,
        rol: d.rol,
        id_cliente: idCliente,
        torres: d.torres ?? [],
        clientes: d.clientes ?? [],
      });
      return { id_usuario: id, password_temporal: temporal, aviso: 'Contraseña temporal: se muestra una sola vez y debe cambiarse en el primer acceso.' };
    });
  }

  async editar(u: UsuarioCtx, id: number, d: { nombre?: string; rol?: Rol; activo?: boolean; torres?: number[]; id_cliente?: number; clientes?: number[] }) {
    const res = await this.db.transaccion(async (tx) => {
      const prev = await this.objetivo(tx, u, id, true);
      if (id === u.id_usuario) {
        // Sobre sí mismo solo se cambia el nombre (no rol, estado, cliente, torres ni clientes).
        const cambiaAlgoMas =
          (d.rol !== undefined && d.rol !== prev.rol) ||
          d.activo === false ||
          (d.id_cliente !== undefined && d.id_cliente !== prev.id_cliente) ||
          d.torres !== undefined ||
          d.clientes !== undefined;
        if (cambiaAlgoMas) throw new ConflictoError('No puede cambiar su propio rol, cliente o asignaciones ni desactivarse a sí mismo', 'AUTOPROTECCION');
      }
      // Tabla 40: un usuario anonimizado ya no tiene nombre ni email reales; no se reactiva ni se edita.
      if (prev.anonimizado) throw new ConflictoError('El usuario fue anonimizado (Tabla 40) y no puede modificarse ni reactivarse', 'USUARIO_ANONIMIZADO');
      const nuevoRol = d.rol ?? prev.rol;
      if (d.rol !== undefined && d.rol !== prev.rol && !puedeGestionarRol(u.rol, d.rol)) throw noGestionable();
      this.validarExtras(nuevoRol, d);

      const dejaDeSerAdmin = prev.rol === 'administrador' && prev.activo && (nuevoRol !== 'administrador' || d.activo === false);
      if (dejaDeSerAdmin) {
        const otros = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE r.nombre = 'administrador' AND u.activo AND u.id_usuario <> $1`,
          [id],
        );
        if (otros.rows[0].n < MINIMO_ADMINISTRADORES) {
          throw new ConflictoError(`El sistema debe conservar al menos ${MINIMO_ADMINISTRADORES} Administradores activos`, 'MINIMO_ADMINISTRADORES');
        }
      }

      const cambiaRol = nuevoRol !== prev.rol;
      const reactiva = d.activo === true && !prev.activo;
      const idCliente =
        id === u.id_usuario
          ? prev.id_cliente
          : cambiaRol || d.id_cliente !== undefined || (reactiva && rolConCliente(nuevoRol))
            ? await this.resolverCliente(tx, u, nuevoRol, d.id_cliente, prev.id_cliente)
            : prev.id_cliente;
      const cambiaCliente = idCliente !== prev.id_cliente;
      const revocar = cambiaRol || (d.activo !== undefined && d.activo !== prev.activo);
      await tx.query(
        `UPDATE usuario SET nombre = COALESCE($2, nombre),
                id_rol = (SELECT id_rol FROM rol WHERE nombre = $3::text),
                activo = COALESCE($4, activo),
                desactivado_en = CASE WHEN $4 = false THEN now() WHEN $4 = true THEN NULL ELSE desactivado_en END,
                version_token = version_token + CASE WHEN $5 THEN 1 ELSE 0 END,
                id_cliente = $6,
                -- D-32: «ninguna» es solo para Administradores; al dejar de serlo vuelve a «todas».
                aviso_alertas = CASE WHEN $3::text NOT IN ('administrador', 'administrador_principal') AND aviso_alertas = 'ninguna' THEN 'todas' ELSE aviso_alertas END
          WHERE id_usuario = $1`,
        [id, d.nombre ?? null, nuevoRol, d.activo ?? null, revocar, idCliente],
      );
      // Asignaciones coherentes con el rol y el cliente (RN-11).
      if (nuevoRol !== 'encargado') {
        if (cambiaRol) await tx.query(`DELETE FROM usuario_instalacion WHERE id_usuario = $1`, [id]);
      } else if (d.torres) {
        await this.asignarTorres(tx, id, d.torres, idCliente);
      } else if (cambiaCliente) {
        await tx.query(
          `DELETE FROM usuario_instalacion ui USING instalacion i
            WHERE ui.id_usuario = $1 AND i.id_instalacion = ui.id_instalacion AND i.id_cliente IS DISTINCT FROM $2::int`,
          [id, idCliente],
        );
      }
      if (nuevoRol !== 'tecnico') {
        if (cambiaRol) await tx.query(`DELETE FROM tecnico_cliente WHERE id_usuario = $1`, [id]);
      } else if (d.clientes) {
        await this.asignarClientes(tx, id, d.clientes);
      }
      await auditar(tx, u, d.activo === false ? 'desactivar_usuario' : 'editar_usuario', 'usuario', id, {
        anterior: { nombre: prev.nombre, rol: prev.rol, activo: prev.activo, id_cliente: prev.id_cliente },
        nuevo: { ...d, id_cliente: idCliente },
      });
      return { revocar };
    });
    if (res.revocar) this.alRevocar(id);
    return { id_usuario: id };
  }

  async restablecerPassword(u: UsuarioCtx, id: number) {
    const temporal = passwordTemporal();
    const hash = await bcrypt.hash(temporal, BCRYPT_COSTO);
    await this.db.transaccion(async (tx) => {
      await this.objetivo(tx, u, id, true);
      await tx.query(
        `UPDATE usuario SET hash_password = $2, debe_cambiar_password = true, version_token = version_token + 1,
                intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id_usuario = $1`,
        [id, hash],
      );
      await auditar(tx, u, 'restablecer_password', 'usuario', id, null);
    });
    this.alRevocar(id);
    return { id_usuario: id, password_temporal: temporal };
  }

  /** Consulta paginada de auditoría, solo lectura (la consulta misma no se audita, Tabla 29). */
  async auditoria(f: { usuario?: number; accion?: string; desde?: string; hasta?: string; pagina: number; por_pagina: number }) {
    const where = `WHERE ($1::int IS NULL OR l.id_usuario = $1) AND ($2::text IS NULL OR l.accion = $2)
                     AND ($3::timestamptz IS NULL OR l.ts >= $3) AND ($4::timestamptz IS NULL OR l.ts <= $4)`;
    const p = [f.usuario ?? null, f.accion ?? null, f.desde ?? null, f.hasta ?? null];
    const total = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM log_auditoria l ${where}`, p);
    const r = await this.db.query(
      `SELECT l.id_log, l.ts, l.accion, l.entidad, l.id_entidad, l.detalle, l.ip, u.nombre AS usuario
         FROM log_auditoria l LEFT JOIN usuario u ON u.id_usuario = l.id_usuario ${where}
        ORDER BY l.ts DESC, l.id_log DESC LIMIT $5 OFFSET $6`,
      [...p, f.por_pagina, (f.pagina - 1) * f.por_pagina],
    );
    const acciones = await this.db.query<{ accion: string }>(`SELECT DISTINCT accion FROM log_auditoria ORDER BY accion`);
    return { datos: r.rows, total: total.rows[0].n, pagina: f.pagina, por_pagina: f.por_pagina, acciones: acciones.rows.map((a) => a.accion) };
  }
}

