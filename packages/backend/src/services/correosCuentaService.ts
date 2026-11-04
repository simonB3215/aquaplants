import type { Consulta, IBaseDatos, INotificador } from '../ports/index.js';

const MAX_INTENTOS = 3;

/** Fecha legible en la zona horaria de Chile (la del cliente del proyecto). */
function fechaChile(d: Date): string {
  return d.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' });
}

/**
 * Avisos por correo sobre la seguridad de la cuenta. `programar*` se llama dentro
 * de la transacción del cambio (la API no tiene salida a Internet); el worker
 * envía los pendientes con `procesarPendientes`.
 */
export class CorreosCuentaService {
  constructor(
    private readonly db: IBaseDatos,
    private readonly notificador: INotificador,
  ) {}

  static async programarCambioPassword(tx: Consulta, u: { id_usuario: number; nombre: string; email: string }, ip: string | null, cuando = new Date()) {
    const texto = [
      `Hola ${u.nombre}:`,
      '',
      `La contraseña de tu cuenta de AquaPlants (${u.email}) se cambió el ${fechaChile(cuando)}${ip ? ` desde la dirección IP ${ip}` : ''}.`,
      'Por seguridad, se cerraron todas las sesiones abiertas: inicia sesión con la nueva contraseña.',
      '',
      'Si fuiste tú, no necesitas hacer nada.',
      'Si NO fuiste tú, contacta de inmediato al administrador de AquaPlants para bloquear la cuenta y restablecer la contraseña.',
      '',
      '— AquaPlants (mensaje automático, no respondas este correo)',
    ].join('\n');
    await tx.query(
      `INSERT INTO notificacion_correo (id_usuario, tipo, destinatario, asunto, texto) VALUES ($1, 'cambio_password', $2, $3, $4)`,
      [u.id_usuario, u.email, '[AquaPlants] Tu contraseña fue cambiada', texto],
    );
  }

  static async programarRestablecimiento(tx: Consulta, u: { id_usuario: number; nombre: string; email: string }, enlace: string, minutos: number, ip: string | null) {
    const texto = [
      `Hola ${u.nombre}:`,
      '',
      `Recibimos una solicitud para restablecer la contraseña de tu cuenta de AquaPlants (${u.email})${ip ? ` desde la dirección IP ${ip}` : ''}.`,
      '',
      `Para elegir una contraseña nueva, abre este enlace (válido por ${minutos} minutos y un solo uso):`,
      enlace,
      '',
      'Si no lo solicitaste, ignora este correo: tu contraseña actual sigue funcionando.',
      '',
      '— AquaPlants (mensaje automático, no respondas este correo)',
    ].join('\n');
    await tx.query(
      `INSERT INTO notificacion_correo (id_usuario, tipo, destinatario, asunto, texto) VALUES ($1, 'restablecer_password', $2, $3, $4)`,
      [u.id_usuario, u.email, '[AquaPlants] Restablecer tu contraseña', texto],
    );
  }

  /** D-28: enlace para confirmar el email y terminar de crear la cuenta (aún no existe el usuario). */
  static async programarConfirmacionRegistro(tx: Consulta, r: { id_registro: string; nombre: string; email: string }, enlace: string, horas: number) {
    const texto = [
      `Hola ${r.nombre}:`,
      '',
      `Recibimos una solicitud para crear una cuenta de AquaPlants con este email (${r.email}).`,
      '',
      `Para confirmar tu email y activar la cuenta, abre este enlace (válido por ${horas} horas y un solo uso):`,
      enlace,
      '',
      'Si no fuiste tú, ignora este correo: la cuenta no se creará.',
      '',
      '— AquaPlants (mensaje automático, no respondas este correo)',
    ].join('\n');
    await tx.query(
      `INSERT INTO notificacion_correo (id_registro, tipo, destinatario, asunto, texto) VALUES ($1, 'confirmar_registro', $2, $3, $4)`,
      [r.id_registro, r.email, '[AquaPlants] Confirma tu email para activar tu cuenta', texto],
    );
  }

  /** D-28: alguien intentó registrarse con un email que ya tiene cuenta (no se revela en la API). */
  static async programarCuentaExistente(tx: Consulta, u: { id_usuario: number; nombre: string; email: string }) {
    const texto = [
      `Hola ${u.nombre}:`,
      '',
      `Alguien intentó crear una cuenta de AquaPlants con tu email (${u.email}), pero ya tienes una.`,
      '',
      'Si fuiste tú, inicia sesión con tu contraseña o usa «¿Olvidó su contraseña?» en la pantalla de acceso.',
      'Si no fuiste tú, puedes ignorar este correo: no se hizo ningún cambio en tu cuenta.',
      '',
      '— AquaPlants (mensaje automático, no respondas este correo)',
    ].join('\n');
    await tx.query(
      `INSERT INTO notificacion_correo (id_usuario, tipo, destinatario, asunto, texto) VALUES ($1, 'cuenta_existente', $2, $3, $4)`,
      [u.id_usuario, u.email, '[AquaPlants] Intento de registro con tu email', texto],
    );
  }

  /** Envía los avisos pendientes; cada uno se bloquea (SKIP LOCKED) para que dos workers no lo dupliquen. */
  async procesarPendientes(limite = 20): Promise<number> {
    let enviadas = 0;
    for (let i = 0; i < limite; i++) {
      const hubo = await this.db.transaccion(async (tx) => {
        const r = await tx.query<{ id_notificacion: string; tipo: string; destinatario: string; asunto: string; texto: string; intentos: number }>(
          `SELECT id_notificacion, tipo, destinatario, asunto, texto, intentos FROM notificacion_correo
            WHERE estado = 'pendiente' ORDER BY creado_en LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        const n = r.rows[0];
        if (!n) return false;
        // Los correos de restablecimiento y de confirmación llevan un enlace secreto: se borra al quedar en un estado final.
        const borrarTexto = `CASE WHEN tipo IN ('restablecer_password', 'confirmar_registro') AND estado <> 'pendiente' THEN '(enlace eliminado tras el envío)' ELSE texto END`;
        if (!this.notificador.configurado) {
          await tx.query(`UPDATE notificacion_correo SET estado = 'no_configurada' WHERE id_notificacion = $1`, [n.id_notificacion]);
          await tx.query(`UPDATE notificacion_correo SET texto = ${borrarTexto} WHERE id_notificacion = $1`, [n.id_notificacion]);
          return true;
        }
        try {
          await this.notificador.enviar({ destinatarios: [n.destinatario], asunto: n.asunto, texto: n.texto });
          await tx.query(
            `UPDATE notificacion_correo SET estado = 'enviada', intentos = intentos + 1, enviado_en = now(), ultimo_error = NULL WHERE id_notificacion = $1`,
            [n.id_notificacion],
          );
          enviadas++;
        } catch (e) {
          await tx.query(
            `UPDATE notificacion_correo SET intentos = intentos + 1, ultimo_error = $2,
                    estado = CASE WHEN intentos + 1 >= $3 THEN 'fallida' ELSE 'pendiente' END
              WHERE id_notificacion = $1`,
            [n.id_notificacion, String((e as Error).message).slice(0, 500), MAX_INTENTOS],
          );
          await tx.query(`UPDATE notificacion_correo SET texto = ${borrarTexto} WHERE id_notificacion = $1`, [n.id_notificacion]);
          return false; // no insistir en este ciclo: el siguiente reintenta
        }
        await tx.query(`UPDATE notificacion_correo SET texto = ${borrarTexto} WHERE id_notificacion = $1`, [n.id_notificacion]);
        return true;
      });
      if (!hubo) break;
    }
    return enviadas;
  }
}
