import { z } from 'zod';
import { resolverCertificado } from './conexion.js';

/**
 * Configuración por variables de entorno. Ningún secreto tiene valor por
 * defecto en producción: si falta, el proceso no arranca.
 */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  MONGO_URL: z.string().min(1).optional(),
  MONGO_DB: z.string().default('aquaplants'),
  /** Si se define, los payloads crudos van a este PostgreSQL (p. ej. Neon) en vez de MongoDB. */
  PAYLOADS_DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRA_HORAS: z.coerce.number().positive().default(8),
  /** D-32: una alerta crítica activa por más de estos minutos se avisa a quienes eligieron «solo urgentes». */
  ALERTA_URGENTE_MIN: z.coerce.number().int().min(1).max(1440).default(30),
  LOGIN_MAX_INTENTOS: z.coerce.number().int().positive().default(5),
  LOGIN_BLOQUEO_MIN: z.coerce.number().int().positive().default(15),
  /** Límite por dispositivo autenticado (Tabla 12: 30/min). */
  DEVICE_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
  LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  /** RN-04: «sin señal» tras N intervalos de muestreo sin comunicación. */
  SIN_SENAL_FACTOR: z.coerce.number().positive().default(3),
  WORKER_SIN_SENAL_CADA_S: z.coerce.number().positive().default(60),
  WORKER_OUTBOX_CADA_MS: z.coerce.number().int().positive().default(1000),
  WORKER_RECONCILIAR_CADA_S: z.coerce.number().positive().default(300),
  /** Mantenimiento (anonimización, avisos de respaldo): cada cuánto revisa el worker. */
  WORKER_MANTENIMIENTO_CADA_S: z.coerce.number().positive().default(3600),
  /** Tabla 40: anonimizar nombre y email de usuarios desactivados tras este plazo. */
  ANONIMIZAR_TRAS_DIAS: z.coerce.number().int().positive().default(365),
  /** Tolerancia de marca temporal (Tabla 12). */
  TS_FUTURO_MAX_S: z.coerce.number().int().positive().default(120),
  TS_ANTIGUEDAD_MAX_H: z.coerce.number().positive().default(48),
  /** Ejecutar el worker dentro del proceso de la API (cómodo en desarrollo). */
  WORKER_EN_API: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /**
   * Solo desarrollo/demostración: si se define, TODOS los avisos se envían únicamente a esta
   * dirección (los usuarios sembrados tienen correos ficticios @aquaplants.cl).
   */
  NOTIFICACIONES_SOLO_A: z.string().optional(),
  /** URL pública de la aplicación web: base de los enlaces enviados por correo. */
  APP_URL: z.string().url().default('http://localhost:8080'),
  /** Validez del enlace de «¿Olvidaste tu contraseña?». */
  RESTABLECER_MINUTOS: z.coerce.number().int().positive().max(120).default(30),
  REGISTRO_CONFIRMAR_HORAS: z.coerce.number().int().positive().max(72).default(24),
  /** Modo demostración académica: aislado de producción. */
  DEMO_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SIM_CONTROL_URL: z.string().default('http://localhost:4100'),
  SIM_CONTROL_TOKEN: z.string().optional(),
  DEMO_ENCARGADO_EMAIL: z.string().optional(),
  DEMO_ENCARGADO_PASSWORD: z.string().optional(),
  /** Proxies delante de la API: 'false' = 0, 'true' = 1, o un número (Netlify → Render = 2). */
  TRUST_PROXY: z
    .string()
    .default('false')
    .refine((v) => /^(true|false|[0-9])$/.test(v), 'TRUST_PROXY debe ser true, false o un número de 0 a 9')
    .transform((v) => (v === 'true' ? 1 : v === 'false' ? 0 : Number(v))),
});

export type Config = z.infer<typeof Env>;

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  if (!r.data.MONGO_URL && !r.data.PAYLOADS_DATABASE_URL) {
    throw new Error('Configuración inválida: defina MONGO_URL o PAYLOADS_DATABASE_URL (almacén de payloads)');
  }
  if (r.data.NODE_ENV === 'production' && r.data.DEMO_MODE) {
    throw new Error('DEMO_MODE no puede activarse con NODE_ENV=production (modo demo aislado de producción).');
  }
  r.data.DATABASE_URL = resolverCertificado(r.data.DATABASE_URL);
  r.data.PAYLOADS_DATABASE_URL = resolverCertificado(r.data.PAYLOADS_DATABASE_URL);
  return r.data;
}
