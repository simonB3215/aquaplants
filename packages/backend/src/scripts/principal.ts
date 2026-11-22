import pg from 'pg';
import { resolverCertificado } from '../conexion.js';

/**
 * D-37 (Anexo C): el Administrador principal se designa FUERA de la aplicación.
 * Este script lo hace por email, con auditoría. Máximo dos cuentas activas.
 *
 *   npm run admin:principal -w packages/backend -- --email persona@empresa.cl
 *   npm run admin:principal -w packages/backend -- --email persona@empresa.cl --quitar
 *
 * Designar: la cuenta (activa, de Administrador) pasa a Administrador principal.
 * Quitar: vuelve a Administrador. En ambos casos se cierran sus sesiones (version_token):
 * como el script corre fuera de la API, la sesión abierta deja de servir en a lo sumo 30 s
 * (caché de versión de AuthService).
 * Usa DATABASE_URL (la conexión de administración, no la de la aplicación).
 */
export const MAXIMO_PRINCIPALES = 2;

export async function designarPrincipal(url: string, email: string, quitar: boolean): Promise<string> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query<{ id_usuario: number; rol: string; activo: boolean }>(
      `SELECT u.id_usuario, r.nombre AS rol, u.activo FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE lower(u.email) = lower($1) FOR UPDATE OF u`,
      [email],
    );
    const u = r.rows[0];
    if (!u) throw new Error('No existe una cuenta con ese email');
    if (!u.activo) throw new Error('La cuenta está desactivada');
    const origen = quitar ? 'administrador_principal' : 'administrador';
    const destino = quitar ? 'administrador' : 'administrador_principal';
    if (u.rol !== origen) throw new Error(quitar ? 'La cuenta no es Administrador principal' : 'Solo una cuenta de Administrador puede pasar a Administrador principal');
    if (!quitar) {
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE r.nombre = 'administrador_principal' AND u.activo`,
      );
      if (n.rows[0].n >= MAXIMO_PRINCIPALES) throw new Error(`Ya hay ${MAXIMO_PRINCIPALES} Administradores principales activos`);
    }
    await c.query(
      `UPDATE usuario SET id_rol = (SELECT id_rol FROM rol WHERE nombre = $2::text), id_cliente = NULL, version_token = version_token + 1 WHERE id_usuario = $1`,
      [u.id_usuario, destino],
    );
    await c.query(
      `INSERT INTO log_auditoria (id_usuario, accion, entidad, id_entidad, detalle) VALUES (NULL, $1, 'usuario', $2, $3)`,
      [quitar ? 'quitar_administrador_principal' : 'designar_administrador_principal', String(u.id_usuario), JSON.stringify({ origen: 'script', anterior: origen, nuevo: destino })],
    );
    await c.query('COMMIT');
    return `Usuario #${u.id_usuario}: ${origen} → ${destino}`;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

const esPrincipal = process.argv[1] && /principal\.(t|j)s$/.test(process.argv[1]);
if (esPrincipal) {
  const url = resolverCertificado(process.env.DATABASE_URL);
  const i = process.argv.indexOf('--email');
  const email = i > 0 ? process.argv[i + 1] : undefined;
  if (!url || !email) {
    console.error('Uso: defina DATABASE_URL y pase --email <correo> [--quitar]');
    process.exit(1);
  }
  designarPrincipal(url, email, process.argv.includes('--quitar'))
    .then((m) => console.log('[principal]', m))
    .catch((e) => {
      console.error('[principal]', (e as Error).message);
      process.exit(1);
    });
}
