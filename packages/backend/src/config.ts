import { z } from 'zod';

/**
 * Configuración por variables de entorno. Ningún secreto tiene valor por
 * defecto en producción: si falta, el proceso no arranca.
 */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  MONGO_URL: z.string().min(1),
  MONGO_DB: z.string().default('aquaplants'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRA_HORAS: z.coerce.number().positive().default(8),
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
  /** Modo demostración académica: aislado de producción. */
  DEMO_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SIM_CONTROL_URL: z.string().default('http://localhost:4100'),
  SIM_CONTROL_TOKEN: z.string().optional(),
  DEMO_ENCARGADO_EMAIL: z.string().optional(),
  DEMO_ENCARGADO_PASSWORD: z.string().optional(),
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof Env>;

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  if (r.data.NODE_ENV === 'production' && r.data.DEMO_MODE) {
    throw new Error('DEMO_MODE no puede activarse con NODE_ENV=production (modo demo aislado de producción).');
  }
  return r.data;
}
