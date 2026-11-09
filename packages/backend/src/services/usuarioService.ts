import bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'node:crypto';
import type { Rol } from '@aquaplants/shared';
import type { IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import { BCRYPT_COSTO } from './authService.js';
import type { UsuarioCtx } from './acceso.js';

/** Contraseña temporal que cumple la política (letras y números, 14 caracteres). */
function passwordTemporal(): string {
  const base = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  return `${base.slice(0, 10)}A${randomInt(1, 10)}b${randomInt(0, 10)}`;
}

/** CU-09 Gestionar usuarios y auditoría (solo Administrador). */
export class UsuarioService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly alRevocar: (id: number) => void,
  ) {}

  async listar() {
    const r = await this.db.query(
      `SELECT u.id_usuario, u.nombre, u.email, r.nombre AS rol, u.activo, u.debe_cambiar_password, u.creado_en, (u.anonimizado_en IS NOT NULL) AS anonimizado,
              (u.bloqueado_hasta IS NOT NULL AND u.bloqueado_hasta > now()) AS bloqueado,
              COALESCE((SELECT json_agg(ui.id_instalacion ORDER BY ui.id_instalacion) FROM usuario_instalacion ui WHERE ui.id_usuario = u.id_usuario), '[]') AS torres
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol ORDER BY u.activo DESC, u.nombre`,
    );
    return r.rows;
  }

  async roles() {
    return (await this.db.query(`SELECT id_rol, nombre, descripcion FROM rol ORDER BY id_rol`)).rows;
  }

  async crear(u: UsuarioCtx, d: { nombre: string; email: string; rol: Rol; torres?: number[] }) {
    const temporal = passwordTemporal();
    const hash = await bcrypt.hash(temporal, BCRYPT_COSTO);
    return this.db.transaccion(async (tx) => {
      const dup = await tx.query(`SELECT 1 FROM usuario WHERE lower(email) = lower($1)`, [d.email]);
      if (dup.rowCount) throw new ConflictoError('El email ya está registrado', 'EMAIL_DUPLICADO');
      const r = await tx.query<{ id_usuario: number }>(
        `INSERT INTO usuario (nombre, email, hash_password, id_rol, debe_cambiar_password, aviso_alertas)
         VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4), true,
                 CASE WHEN $4 = 'administrador' THEN 'ninguna' ELSE 'todas' END) RETURNING id_usuario`,
        [d.nombre, d.email, hash, d.rol],
      );
      const id = r.rows[0].id_usuario;
      if (d.torres?.length) await this.asignar(tx, id, d.torres);
      await auditar(tx, u, 'crear_usuario', 'usuario', id, { nombre: d.nombre, email: d.email, rol: d.rol, torres: d.torres ?? [] });
      return { id_usuario: id, password_temporal: temporal, aviso: 'Contraseña temporal: se muestra una sola vez y debe cambiarse en el primer acceso.' };
    });
  }

  private async asignar(tx: Pick<IBaseDatos, 'query'>, idUsuario: number, torres: number[]) {
    const ok = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM instalacion WHERE id_instalacion = ANY($1::int[])`, [torres]);
    if (ok.rows[0].n !== new Set(torres).size) throw new ReglaNegocioError('Alguna torre indicada no existe', [{ campo: 'torres', mensaje: 'Torre inexistente' }]);
    await tx.query(`DELETE FROM usuario_instalacion WHERE id_usuario = $1 AND NOT (id_instalacion = ANY($2::int[]))`, [idUsuario, torres]);
    await tx.query(`INSERT INTO usuario_instalacion (id_usuario, id_instalacion) SELECT $1, x FROM unnest($2::int[]) x ON CONFLICT DO NOTHING`, [idUsuario, torres]);
  }

  async editar(u: UsuarioCtx, id: number, d: { nombre?: string; rol?: Rol; activo?: boolean; torres?: number[] }) {
    const res = await this.db.transaccion(async (tx) => {
      const r = await tx.query<{ nombre: string; rol: Rol; activo: boolean; anonimizado: boolean }>(
        `SELECT u.nombre, r.nombre AS rol, u.activo, (u.anonimizado_en IS NOT NULL) AS anonimizado FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1 FOR UPDATE OF u`,
        [id],
      );
      const prev = r.rows[0];
      if (!prev) throw new NoEncontradoError('Usuario no encontrado');
      // Tabla 40: un usuario anonimizado ya no tiene nombre ni email reales; no se reactiva ni se edita.
      if (prev.anonimizado) throw new ConflictoError('El usuario fue anonimizado (Tabla 40) y no puede modificarse ni reactivarse', 'USUARIO_ANONIMIZADO');
      if (id === u.id_usuario && ((d.rol && d.rol !== prev.rol) || d.activo === false)) {
        throw new ConflictoError('No puede cambiar su propio rol ni desactivarse a sí mismo', 'AUTOPROTECCION');
      }
      const dejaDeSerAdmin = prev.rol === 'administrador' && prev.activo && ((d.rol && d.rol !== 'administrador') || d.activo === false);
      if (dejaDeSerAdmin) {
        const admins = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE r.nombre = 'administrador' AND u.activo AND u.id_usuario <> $1`,
          [id],
        );
        if (admins.rows[0].n === 0) throw new ConflictoError('El sistema no puede quedar sin administradores activos', 'ULTIMO_ADMINISTRADOR');
      }
      const revocar = (d.rol !== undefined && d.rol !== prev.rol) || (d.activo !== undefined && d.activo !== prev.activo);
      await tx.query(
        `UPDATE usuario SET nombre = COALESCE($2, nombre),
                id_rol = COALESCE((SELECT id_rol FROM rol WHERE nombre = $3), id_rol),
                activo = COALESCE($4, activo),
                desactivado_en = CASE WHEN $4 = false THEN now() WHEN $4 = true THEN NULL ELSE desactivado_en END,
                version_token = version_token + CASE WHEN $5 THEN 1 ELSE 0 END,
                -- D-32: «ninguna» es solo para Administrador; al dejar de serlo vuelve a «todas».
                aviso_alertas = CASE WHEN $3 IS NOT NULL AND $3 <> 'administrador' AND aviso_alertas = 'ninguna' THEN 'todas' ELSE aviso_alertas END
          WHERE id_usuario = $1`,
        [id, d.nombre ?? null, d.rol ?? null, d.activo ?? null, revocar],
      );
      if (d.torres) await this.asignar(tx, id, d.torres);
      await auditar(tx, u, d.activo === false ? 'desactivar_usuario' : 'editar_usuario', 'usuario', id, { anterior: prev, nuevo: d });
      return { id_usuario: id, revocar };
    });
    if (res.revocar) this.alRevocar(id);
    return { id_usuario: id };
  }

  async restablecerPassword(u: UsuarioCtx, id: number) {
    const temporal = passwordTemporal();
    const hash = await bcrypt.hash(temporal, BCRYPT_COSTO);
    await this.db.transaccion(async (tx) => {
      const r = await tx.query(
        `UPDATE usuario SET hash_password = $2, debe_cambiar_password = true, version_token = version_token + 1,
                intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id_usuario = $1`,
        [id, hash],
      );
      if (!r.rowCount) throw new NoEncontradoError('Usuario no encontrado');
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
