import nodemailer from 'nodemailer';
import type { INotificador, MensajeNotificacion } from '../ports/index.js';
import type { Config } from '../config.js';

/** Notificador SMTP (RF-11, Could). */
export class SmtpNotificador implements INotificador {
  readonly configurado = true;
  private readonly transporte;
  constructor(private readonly cfg: Config) {
    this.transporte = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT ?? 587,
      secure: (cfg.SMTP_PORT ?? 587) === 465,
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
    });
  }
  async enviar(m: MensajeNotificacion): Promise<void> {
    await this.transporte.sendMail({ from: this.cfg.SMTP_FROM || this.cfg.SMTP_USER, ...destino(this.cfg, m) });
  }
}

/**
 * Con NOTIFICACIONES_SOLO_A (solo demo) el aviso va únicamente a esa dirección y el texto
 * indica a quién habría correspondido; nunca se envía a los destinatarios originales.
 */
export function destino(cfg: Pick<Config, 'NOTIFICACIONES_SOLO_A'>, m: MensajeNotificacion) {
  const solo = cfg.NOTIFICACIONES_SOLO_A?.trim();
  if (!solo) return { to: m.destinatarios, subject: m.asunto, text: m.texto };
  return {
    to: [solo],
    subject: `[DEMO] ${m.asunto}`,
    text: `${m.texto}\n\n(Modo demostración: destinatarios originales ${m.destinatarios.join(', ') || '—'})`,
  };
}

/**
 * Sin proveedor configurado: NO se declara enviado ningún aviso.
 * La alerta queda con notificacion_estado = 'no_configurada'.
 */
export class NotificadorNoConfigurado implements INotificador {
  readonly configurado = false;
  async enviar(): Promise<void> {
    throw new Error('Proveedor de notificaciones no configurado');
  }
}

export function crearNotificador(cfg: Config): INotificador {
  return cfg.SMTP_HOST ? new SmtpNotificador(cfg) : new NotificadorNoConfigurado();
}
