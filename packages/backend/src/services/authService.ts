import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type { RespuestaLogin, Rol, UsuarioSesion } from '@aquaplants/shared';
import type { IBaseDatos } from '../ports/index.js';
import type { Config } from '../config.js';
import { ErrorApp, NoAutenticadoError, ReglaNegocioError } from '../errores.js';
import { auditar, registrarEvento } from './auditoria.js';
import { CorreosCuentaService } from './correosCuentaService.js';

export interface UsuarioToken {
  id_usuario: number;
  rol: Rol;
  nombre: string;
  email: string;
  jti: string;
  exp: number;
}

export interface DispositivoAutenticado {
  id_dispositivo: number;
  id_instalacion: number;
  intervalo_muestreo_s: number;
}

const MENSAJE_GENERICO = 'Credenciales inválidas';
export const BCRYPT_COSTO = 12;

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
export const generarTokenDispositivo = () => randomBytes(32).toString('base64url'); // 256 bits

/**
 * CU-02: autenticación con bcrypt, bloqueo tras N intentos, JWT de 8 h con
 * version_token para revocación (sección 6.1) y lista de bloqueo por jti al
 * cerrar sesión.
 */
export class AuthService {
  private readonly bloqueados = new Map<string, number>(); // jti → exp (s)
  private readonly cacheVersion = new Map<number, { version: number; activo: boolean; hasta: number }>();
  /** Hash ficticio para igualar el tiempo de respuesta cuando el email no existe. */
  private readonly hashFicticio = bcrypt.hashSync('no-existe-' + randomUUID(), 10);

  constructor(
    private readonly db: IBaseDatos,
    private readonly cfg: Config,
  ) {}

  async login(email: string, password: string, ip: string | null): Promise<RespuestaLogin> {
    const r = await this.db.query<{
      id_usuario: number;
      nombre: string;
      email: string;
      hash_password: string;
      activo: boolean;
      rol: Rol;
      intentos_fallidos: number;
      bloqueado_hasta: Date | null;
      debe_cambiar_password: boolean;
      version_token: number;
    }>(
      `SELECT u.id_usuario, u.nombre, u.email, u.hash_password, u.activo, r.nombre AS rol,
              u.intentos_fallidos, u.bloqueado_hasta, u.debe_cambiar_password, u.version_token
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
        WHERE lower(u.email) = lower($1)`,
      [email],
    );
    const u = r.rows[0];
    if (!u) {
      await bcrypt.compare(password, this.hashFicticio);
      throw new NoAutenticadoError(MENSAJE_GENERICO, 'CREDENCIALES_INVALIDAS');
    }
    if (u.bloqueado_hasta && u.bloqueado_hasta.getTime() > Date.now()) {
      throw new ErrorApp(423, 'CUENTA_BLOQUEADA', `Cuenta bloqueada temporalmente. Intente nuevamente después de ${u.bloqueado_hasta.toISOString()}`);
    }
    const ok = await bcrypt.compare(password, u.hash_password);
    if (!ok || !u.activo) {
      if (u.activo) {
        const intentos = u.intentos_fallidos + 1;
        const bloquear = intentos >= this.cfg.LOGIN_MAX_INTENTOS;
        await this.db.transaccion(async (tx) => {
          await tx.query(
            `UPDATE usuario SET intentos_fallidos = $2,
                    bloqueado_hasta = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE bloqueado_hasta END
              WHERE id_usuario = $1`,
            [u.id_usuario, bloquear ? 0 : intentos, bloquear, this.cfg.LOGIN_BLOQUEO_MIN],
          );
          await auditar(tx, { id_usuario: u.id_usuario, ip }, bloquear ? 'login_bloqueo' : 'login_fallido', 'usuario', u.id_usuario, { intentos });
        });
        if (bloquear) {
          throw new ErrorApp(423, 'CUENTA_BLOQUEADA', `Cuenta bloqueada durante ${this.cfg.LOGIN_BLOQUEO_MIN} minutos por intentos fallidos`);
        }
      }
      throw new NoAutenticadoError(MENSAJE_GENERICO, 'CREDENCIALES_INVALIDAS');
    }
    await this.db.transaccion(async (tx) => {
      await tx.query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id_usuario = $1`, [u.id_usuario]);
      await auditar(tx, { id_usuario: u.id_usuario, ip }, 'login', 'usuario', u.id_usuario, null);
    });
    const jti = randomUUID();
    const expS = Math.floor(Date.now() / 1000) + Math.round(this.cfg.JWT_EXPIRA_HORAS * 3600);
    const token = jwt.sign({ sub: String(u.id_usuario), rol: u.rol, nombre: u.nombre, email: u.email, ver: u.version_token, jti, exp: expS }, this.cfg.JWT_SECRET, {
      algorithm: 'HS256',
    });
    const usuario: UsuarioSesion = {
      id_usuario: u.id_usuario,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      debe_cambiar_password: u.debe_cambiar_password,
    };
    return { token, expira_en: new Date(expS * 1000).toISOString(), usuario };
  }

  /** Verifica el JWT, la lista de bloqueo y la versión de credenciales (caché 30 s). */
  async verificar(token: string): Promise<UsuarioToken> {
    let p: jwt.JwtPayload;
    try {
      p = jwt.verify(token, this.cfg.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      throw new NoAutenticadoError('Sesión inválida o expirada', 'TOKEN_INVALIDO');
    }
    if (!p.jti || this.bloqueados.has(p.jti)) throw new NoAutenticadoError('Sesión cerrada', 'TOKEN_REVOCADO');
    const id = Number(p.sub);
    const v = await this.versionDe(id);
    if (!v.activo || v.version !== p.ver) throw new NoAutenticadoError('Sesión revocada', 'TOKEN_REVOCADO');
    return { id_usuario: id, rol: p.rol as Rol, nombre: String(p.nombre), email: String(p.email), jti: p.jti, exp: p.exp ?? 0 };
  }

  private async versionDe(id: number) {
    const c = this.cacheVersion.get(id);
    if (c && c.hasta > Date.now()) return c;
    const r = await this.db.query<{ version_token: number; activo: boolean }>(`SELECT version_token, activo FROM usuario WHERE id_usuario = $1`, [id]);
    const v = { version: r.rows[0]?.version_token ?? -1, activo: r.rows[0]?.activo ?? false, hasta: Date.now() + 30_000 };
    this.cacheVersion.set(id, v);
    return v;
  }

  /** Invalida la caché local (el propio proceso aplica la revocación al instante). */
  invalidarCache(id: number) {
    this.cacheVersion.delete(id);
  }

  async logout(u: UsuarioToken, ip: string | null): Promise<void> {
    this.bloqueados.set(u.jti, u.exp);
    const ahora = Date.now() / 1000;
    for (const [k, exp] of this.bloqueados) if (exp < ahora) this.bloqueados.delete(k);
    await this.db.transaccion((tx) => auditar(tx, { id_usuario: u.id_usuario, ip }, 'logout', 'usuario', u.id_usuario));
  }

  async me(id: number): Promise<UsuarioSesion> {
    const r = await this.db.query<UsuarioSesion>(
      `SELECT u.id_usuario, u.nombre, u.email, r.nombre AS rol, u.debe_cambiar_password
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1`,
      [id],
    );
    if (!r.rows[0]) throw new NoAutenticadoError();
    return r.rows[0];
  }

  /** Devuelve si se programó el aviso por correo (solo hay aviso si SMTP está configurado). */
  async cambiarPassword(id: number, actual: string, nueva: string, ip: string | null): Promise<{ aviso_correo: boolean }> {
    const r = await this.db.query<{ hash_password: string; nombre: string; email: string }>(
      `SELECT hash_password, nombre, email FROM usuario WHERE id_usuario = $1`,
      [id],
    );
    if (!r.rows[0] || !(await bcrypt.compare(actual, r.rows[0].hash_password))) {
      throw new ReglaNegocioError('La contraseña actual no es correcta', [{ campo: 'actual', mensaje: 'Contraseña incorrecta' }]);
    }
    if (actual === nueva) throw new ReglaNegocioError('La nueva contraseña debe ser distinta', [{ campo: 'nueva', mensaje: 'Debe ser distinta de la actual' }]);
    const hash = await bcrypt.hash(nueva, BCRYPT_COSTO);
    await this.db.transaccion(async (tx) => {
      await tx.query(
        `UPDATE usuario SET hash_password = $2, debe_cambiar_password = false, version_token = version_token + 1 WHERE id_usuario = $1`,
        [id, hash],
      );
      await auditar(tx, { id_usuario: id, ip }, 'cambiar_password', 'usuario', id);
      // Aviso de seguridad al titular de la cuenta; lo envía el worker (sin la contraseña).
      await CorreosCuentaService.programarCambioPassword(tx, { id_usuario: id, nombre: r.rows[0].nombre, email: r.rows[0].email }, ip);
    });
    this.invalidarCache(id);
    return { aviso_correo: Boolean(this.cfg.SMTP_HOST) };
  }

  /** CU-01 paso 3: credencial de dispositivo contra su resumen SHA-256, no de baja. */
  async autenticarDispositivo(token: string, ip: string | null): Promise<DispositivoAutenticado> {
    const r = await this.db.query<DispositivoAutenticado & { estado: string }>(
      `SELECT id_dispositivo, id_instalacion, intervalo_muestreo_s, estado FROM dispositivo WHERE credencial_hash = $1`,
      [hashToken(token)],
    );
    const d = r.rows[0];
    if (!d) throw new NoAutenticadoError('Credencial de dispositivo inválida', 'CREDENCIAL_DISPOSITIVO_INVALIDA');
    if (d.estado === 'baja') {
      await this.db.transaccion((tx) =>
        registrarEvento(tx, d.id_dispositivo, 'intento_rechazado', 'Envío de un dispositivo dado de baja (credencial revocada)', { ip }),
      );
      throw new NoAutenticadoError('Credencial de dispositivo revocada', 'CREDENCIAL_DISPOSITIVO_INVALIDA');
    }
    return { id_dispositivo: d.id_dispositivo, id_instalacion: d.id_instalacion, intervalo_muestreo_s: d.intervalo_muestreo_s };
  }
}
