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
 * Notificador HTTP (Resend, https://resend.com/docs/api-reference/emails/send-email).
 * Se usa en Render free, que bloquea la salida por los puertos SMTP.
 */
export class ResendNotificador implements INotificador {
  readonly configurado = true;
  constructor(
    private readonly cfg: Pick<Config, 'RESEND_API_KEY' | 'RESEND_FROM' | 'NOTIFICACIONES_SOLO_A'>,
    private readonly http: typeof fetch = fetch,
  ) {}
  async enviar(m: MensajeNotificacion): Promise<void> {
    const d = destino(this.cfg, m);
    const r = await this.http('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.cfg.RESEND_FROM, to: d.to, subject: d.subject, text: d.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      // El mensaje de Resend explica la causa (clave inválida, destinatario no permitido…); nunca incluye la clave.
      const cuerpo = await r.text().catch(() => '');
      throw new Error(`Resend respondió ${r.status}: ${cuerpo.slice(0, 300)}`);
    }
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
  if (cfg.RESEND_API_KEY) return new ResendNotificador(cfg);
  return cfg.SMTP_HOST ? new SmtpNotificador(cfg) : new NotificadorNoConfigurado();
}
