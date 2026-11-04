import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { Consulta, IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import { BCRYPT_COSTO, hashToken } from './authService.js';
import { CorreosCuentaService } from './correosCuentaService.js';
import type { UsuarioCtx } from './acceso.js';

/** Rol que otorga un enlace de invitación: SIEMPRE el de menor privilegio (D-28). */
export const ROL_INVITACION = 'encargado' as const;

const invitacionNoDisponible = () =>
  new ReglaNegocioError(
    'La invitación no es válida, venció, fue anulada o ya no tiene cupos. Pida un enlace nuevo al administrador.',
    [{ campo: 'token', mensaje: 'Invitación no disponible' }],
    'INVITACION_NO_DISPONIBLE',
  );

const nuevoToken = () => randomBytes(32).toString('base64url'); // 256 bits

/**
 * D-28 (amplía CU-09): registro mediante enlace de invitación por torre.
 *  · El Administrador crea un enlace para una o más torres, con vencimiento y cupo.
 *  · Quien lo abre crea su cuenta (nombre, email, contraseña) y debe confirmar su
 *    email con un segundo enlace: recién entonces existe el usuario, como
 *    Encargado de esas torres (nunca otro rol).
 *  · Solo se guardan los SHA-256 de los tokens; la respuesta al registrarse es la
 *    misma exista o no el email (no permite descubrir cuentas).
 */
export class InvitacionService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly cfg: Config,
  ) {}

  private url(ruta: string, token: string, clave: string) {
    return `${this.cfg.APP_URL.replace(/\/+$/, '')}/${ruta}#${clave}=${token}`;
  }

  async crear(u: UsuarioCtx, d: { torres: number[]; dias: number; max_usos: number; descripcion?: string }) {
    const torres = [...new Set(d.torres)];
    const token = nuevoToken();
    return this.db.transaccion(async (tx) => {
      const ok = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM instalacion WHERE id_instalacion = ANY($1::int[]) AND estado = 'activo'`,
        [torres],
      );
      if (ok.rows[0].n !== torres.length) {
        throw new ReglaNegocioError('Alguna torre indicada no existe o está dada de baja', [{ campo: 'torres', mensaje: 'Torre inexistente o de baja' }]);
      }
      const r = await tx.query<{ id_invitacion: number; vence_en: Date }>(
        `INSERT INTO invitacion (hash_token, descripcion, creada_por, vence_en, max_usos)
         VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING id_invitacion, vence_en`,
        [hashToken(token), d.descripcion ?? '', u.id_usuario, d.dias, d.max_usos],
      );
      const { id_invitacion, vence_en } = r.rows[0];
      await tx.query(`INSERT INTO invitacion_instalacion (id_invitacion, id_instalacion) SELECT $1, x FROM unnest($2::int[]) x`, [id_invitacion, torres]);
      await auditar(tx, u, 'crear_invitacion', 'invitacion', id_invitacion, { torres, rol: ROL_INVITACION, max_usos: d.max_usos, dias: d.dias, descripcion: d.descripcion ?? '' });
      return {
        id_invitacion,
        enlace: this.url('registro', token, 'invitacion'),
        vence_en,
        max_usos: d.max_usos,
        rol: ROL_INVITACION,
        aviso: 'El enlace se muestra una sola vez. Quien lo use quedará como Encargado de las torres indicadas.',
      };
    });
  }

  async listar() {
    const r = await this.db.query(
      `SELECT i.id_invitacion, i.descripcion, i.creada_en, i.vence_en, i.max_usos, i.usos, i.anulada_en, c.nombre AS creada_por,
              CASE WHEN i.anulada_en IS NOT NULL THEN 'anulada' WHEN i.vence_en <= now() THEN 'vencida'
                   WHEN i.usos >= i.max_usos THEN 'agotada' ELSE 'vigente' END AS estado,
              COALESCE((SELECT json_agg(json_build_object('id_instalacion', x.id_instalacion, 'nombre', x.nombre) ORDER BY x.nombre)
                          FROM invitacion_instalacion ii JOIN instalacion x ON x.id_instalacion = ii.id_instalacion
                         WHERE ii.id_invitacion = i.id_invitacion), '[]') AS torres,
              (SELECT count(*)::int FROM registro_pendiente p
                WHERE p.id_invitacion = i.id_invitacion AND p.confirmado_en IS NULL AND p.expira_en > now()) AS por_confirmar
         FROM invitacion i JOIN usuario c ON c.id_usuario = i.creada_por
        ORDER BY i.creada_en DESC LIMIT 200`,
    );
    return r.rows;
  }

  async anular(u: UsuarioCtx, id: number) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ anulada_en: Date | null }>(`SELECT anulada_en FROM invitacion WHERE id_invitacion = $1 FOR UPDATE`, [id]);
      if (!r.rows[0]) throw new NoEncontradoError('Invitación no encontrada');
      if (!r.rows[0].anulada_en) {
        await tx.query(`UPDATE invitacion SET anulada_en = now() WHERE id_invitacion = $1`, [id]);
        await auditar(tx, u, 'anular_invitacion', 'invitacion', id, null);
      }
      return { id_invitacion: id, estado: 'anulada' };
    });
  }

  /** Invitación vigente (no anulada, no vencida, con cupo) para el token del enlace. */
  private async vigente(q: Consulta, token: string) {
    const r = await q.query<{ id_invitacion: number; vence_en: Date }>(
      `SELECT id_invitacion, vence_en FROM invitacion
        WHERE hash_token = $1 AND anulada_en IS NULL AND vence_en > now() AND usos < max_usos`,
      [hashToken(token)],
    );
    return r.rows[0];
  }

  /** Pública: lo que la persona ve antes de registrarse (torres y vencimiento). */
  async consultar(token: string) {
    const inv = await this.vigente(this.db, token);
    if (!inv) throw invitacionNoDisponible();
    const t = await this.db.query<{ nombre: string }>(
      `SELECT x.nombre FROM invitacion_instalacion ii JOIN instalacion x ON x.id_instalacion = ii.id_instalacion
        WHERE ii.id_invitacion = $1 AND x.estado = 'activo' ORDER BY x.nombre`,
      [inv.id_invitacion],
    );
    return { torres: t.rows.map((x) => x.nombre), rol: ROL_INVITACION, vence_en: inv.vence_en };
  }

  /**
   * Pública: solicitud de cuenta. Si la invitación no sirve → 422 (el enlace es
   * del Administrador, no revela nada de las cuentas). Con invitación válida la
   * respuesta es siempre la misma: si el email ya tiene cuenta se le avisa por
   * correo en lugar de crear otra.
   */
  async registrar(token: string, d: { nombre: string; email: string; password: string }, ip: string | null): Promise<void> {
    const inv = await this.vigente(this.db, token);
    if (!inv) throw invitacionNoDisponible();
    const hash = await bcrypt.hash(d.password, BCRYPT_COSTO); // siempre: iguala el tiempo de respuesta
    const tokenConf = nuevoToken();
    await this.db.transaccion(async (tx) => {
      // Como máximo una solicitud por minuto y email (evita usar el formulario para llenar bandejas ajenas).
      const reciente = await tx.query(
        `SELECT 1 FROM registro_pendiente WHERE lower(email) = lower($1) AND creado_en > now() - interval '60 seconds'
         UNION ALL
         SELECT 1 FROM notificacion_correo WHERE tipo = 'cuenta_existente' AND lower(destinatario) = lower($1) AND creado_en > now() - interval '10 minutes'`,
        [d.email],
      );
      if (reciente.rowCount) return;
      const existe = await tx.query<{ id_usuario: number; nombre: string; email: string; anonimizado: boolean }>(
        `SELECT id_usuario, nombre, email, (anonimizado_en IS NOT NULL) AS anonimizado FROM usuario WHERE lower(email) = lower($1)`,
        [d.email],
      );
      if (existe.rows[0]) {
        if (!existe.rows[0].anonimizado) await CorreosCuentaService.programarCuentaExistente(tx, existe.rows[0]);
        await auditar(tx, { id_usuario: null, ip }, 'registro_cuenta_existente', 'invitacion', inv.id_invitacion, null);
        return;
      }
      // Un enlace de confirmación nuevo invalida los anteriores del mismo email.
      await tx.query(
        `UPDATE registro_pendiente SET expira_en = now(), hash_password = NULL
          WHERE lower(email) = lower($1) AND confirmado_en IS NULL AND expira_en > now()`,
        [d.email],
      );
      const r = await tx.query<{ id_registro: string }>(
        `INSERT INTO registro_pendiente (id_invitacion, nombre, email, hash_password, hash_token, expira_en, ip_solicitud)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7) RETURNING id_registro`,
        [inv.id_invitacion, d.nombre, d.email, hash, hashToken(tokenConf), this.cfg.REGISTRO_CONFIRMAR_HORAS, ip],
      );
      await CorreosCuentaService.programarConfirmacionRegistro(
        tx,
        { id_registro: r.rows[0].id_registro, nombre: d.nombre, email: d.email },
        this.url('confirmar-registro', tokenConf, 'token'),
        this.cfg.REGISTRO_CONFIRMAR_HORAS,
      );
      // Sin datos personales en la auditoría (inmutable): solo la invitación y el registro.
      await auditar(tx, { id_usuario: null, ip }, 'solicitar_registro', 'registro_pendiente', r.rows[0].id_registro, { id_invitacion: inv.id_invitacion });
    });
  }

  /** Pública: confirmación del email → se crea la cuenta (Encargado de las torres de la invitación). */
  async confirmar(token: string, ip: string | null) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<{ id_registro: string; id_invitacion: number; nombre: string; email: string; hash_password: string }>(
        `SELECT id_registro, id_invitacion, nombre, email, hash_password FROM registro_pendiente
          WHERE hash_token = $1 AND confirmado_en IS NULL AND expira_en > now() AND hash_password IS NOT NULL
          FOR UPDATE`,
        [hashToken(token)],
      );
      const p = r.rows[0];
      if (!p) {
        throw new ReglaNegocioError(
          'El enlace de confirmación no es válido, ya se usó o venció. Vuelva a registrarse con el enlace de invitación.',
          [{ campo: 'token', mensaje: 'Enlace inválido o vencido' }],
        );
      }
      // La invitación pudo vencer mientras tanto (la solicitud se hizo cuando estaba vigente),
      // pero si se anuló o se llenó el cupo ya no se crean cuentas con ella.
      const inv = await tx.query(`SELECT 1 FROM invitacion WHERE id_invitacion = $1 AND anulada_en IS NULL AND usos < max_usos FOR UPDATE`, [p.id_invitacion]);
      if (!inv.rowCount) throw invitacionNoDisponible();
      const dup = await tx.query(`SELECT 1 FROM usuario WHERE lower(email) = lower($1)`, [p.email]);
      if (dup.rowCount) throw new ConflictoError('Ya existe una cuenta con este email. Inicie sesión o use «¿Olvidó su contraseña?».', 'EMAIL_DUPLICADO');
      const u = await tx.query<{ id_usuario: number }>(
        `INSERT INTO usuario (nombre, email, hash_password, id_rol, debe_cambiar_password)
         VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4), false) RETURNING id_usuario`,
        [p.nombre, p.email, p.hash_password, ROL_INVITACION],
      );
      const id = u.rows[0].id_usuario;
      const t = await tx.query<{ id_instalacion: number }>(
        `INSERT INTO usuario_instalacion (id_usuario, id_instalacion)
         SELECT $1, ii.id_instalacion FROM invitacion_instalacion ii JOIN instalacion x ON x.id_instalacion = ii.id_instalacion
          WHERE ii.id_invitacion = $2 AND x.estado = 'activo'
         RETURNING id_instalacion`,
        [id, p.id_invitacion],
      );
      await tx.query(`UPDATE invitacion SET usos = usos + 1 WHERE id_invitacion = $1`, [p.id_invitacion]);
      await tx.query(`UPDATE registro_pendiente SET confirmado_en = now(), id_usuario = $2, hash_password = NULL WHERE id_registro = $1`, [p.id_registro, id]);
      await tx.query(`UPDATE notificacion_correo SET id_usuario = $2 WHERE id_registro = $1`, [p.id_registro, id]);
      await auditar(tx, { id_usuario: id, ip }, 'registro_por_invitacion', 'usuario', id, {
        id_invitacion: p.id_invitacion,
        rol: ROL_INVITACION,
        torres: t.rows.map((x) => x.id_instalacion),
      });
      return { id_usuario: id, email: p.email, mensaje: 'Cuenta creada. Ya puede iniciar sesión.' };
    });
  }
}
