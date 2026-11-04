import { z } from 'zod';
import { ROLES } from '../permisos.js';

const id = z.coerce.number().int().positive();
const texto = (max: number) => z.string().trim().min(1, 'Campo obligatorio').max(max);

// ---------- CU-02 Autenticación ----------
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email con formato inválido').max(160),
  password: z.string().min(1, 'Campo obligatorio').max(200),
});

/** Política de contraseña: ≥ 10 caracteres, con letras y números. */
export const PasswordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(200)
  .regex(/[A-Za-z]/, 'Debe incluir letras')
  .regex(/[0-9]/, 'Debe incluir números');

export const CambiarPasswordSchema = z.object({
  actual: z.string().min(1).max(200),
  nueva: PasswordSchema,
});

/** «¿Olvidaste tu contraseña?»: la respuesta es la misma exista o no el email. */
export const OlvidePasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email con formato inválido').max(160),
});

export const RestablecerPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Enlace inválido'),
  nueva: PasswordSchema,
});

// ---------- CU-04 Alertas ----------
export const ESTADOS_ALERTA = ['activa', 'resuelta'] as const;
export const SEVERIDADES = ['advertencia', 'critica'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const FiltroAlertasSchema = z.object({
  estado: z.enum(ESTADOS_ALERTA).optional(),
  severidad: z.enum(SEVERIDADES).optional(),
  torre: id.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(25),
});

export const ResolverAlertaSchema = z.object({
  comentario: z.string().trim().max(500).optional(),
});

// ---------- CU-05 / CU-06 Históricos ----------
export const HistoricoSchema = z
  .object({
    sensor: id,
    desde: z.string().datetime({ offset: true }),
    hasta: z.string().datetime({ offset: true }),
  })
  .refine((v) => new Date(v.desde) < new Date(v.hasta), { message: 'La fecha de inicio debe ser anterior a la de término', path: ['desde'] })
  .refine((v) => new Date(v.hasta).getTime() - new Date(v.desde).getTime() <= 90 * 86400_000, {
    message: 'El rango no puede superar 90 días',
    path: ['hasta'],
  });

export const CompararSchema = z
  .object({
    tipo_variable: id,
    torres: z
      .string()
      .transform((s) => s.split(',').map((x) => Number(x.trim())))
      .pipe(z.array(z.number().int().positive()).min(1).max(4, 'Máximo 4 torres')),
    desde: z.string().datetime({ offset: true }),
    hasta: z.string().datetime({ offset: true }),
  })
  .refine((v) => new Date(v.desde) < new Date(v.hasta), { message: 'La fecha de inicio debe ser anterior a la de término', path: ['desde'] })
  .refine((v) => new Date(v.hasta).getTime() - new Date(v.desde).getTime() <= 90 * 86400_000, {
    message: 'El rango no puede superar 90 días',
    path: ['hasta'],
  });

export const ExportarSchema = z
  .object({
    torres: z
      .string()
      .transform((s) => s.split(',').map((x) => Number(x.trim())))
      .pipe(z.array(z.number().int().positive()).min(1).max(4, 'Máximo 4 torres')),
    tipo_variable: id.optional(),
    desde: z.string().datetime({ offset: true }),
    hasta: z.string().datetime({ offset: true }),
  })
  .refine((v) => new Date(v.desde) < new Date(v.hasta), { message: 'La fecha de inicio debe ser anterior a la de término', path: ['desde'] })
  .refine((v) => new Date(v.hasta).getTime() - new Date(v.desde).getTime() <= 366 * 86400_000, {
    message: 'Máximo 1 año por exportación',
    path: ['hasta'],
  });

// ---------- CU-07 Umbrales ----------
export const UmbralSchema = z
  .object({
    severidad: z.enum(SEVERIDADES),
    valor_min: z.number().finite(),
    valor_max: z.number().finite(),
    /** Versión leída (control optimista). Obligatoria al editar un umbral existente. */
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => v.valor_min < v.valor_max, { message: 'El mínimo debe ser menor que el máximo', path: ['valor_min'] });

export const EditarUmbralSchema = z
  .object({
    valor_min: z.number().finite(),
    valor_max: z.number().finite(),
    version: z.number().int().min(1),
  })
  .refine((v) => v.valor_min < v.valor_max, { message: 'El mínimo debe ser menor que el máximo', path: ['valor_min'] });

// ---------- CU-08 Torres, dispositivos, sensores ----------
export const TIPOS_INSTALACION = ['aeroponica', 'hidroponica'] as const;

export const TorreSchema = z.object({
  nombre: texto(80),
  tipo: z.enum(TIPOS_INSTALACION),
  ubicacion: z.string().trim().max(160).optional().default(''),
});
export const EditarTorreSchema = TorreSchema.partial();

export const DispositivoSchema = z.object({
  nombre: texto(80),
  id_instalacion: z.number().int().positive(),
  intervalo_muestreo_s: z.number().int().min(5).max(3600).default(60),
});
export const EditarDispositivoSchema = z.object({
  nombre: texto(80).optional(),
  id_instalacion: z.number().int().positive().optional(),
  intervalo_muestreo_s: z.number().int().min(5).max(3600).optional(),
});

export const SensorSchema = z.object({
  id_dispositivo: z.number().int().positive(),
  id_tipo_variable: z.number().int().positive(),
});

export const BajaSchema = z.object({
  motivo: texto(300),
  confirmar: z.literal(true, { error: 'Debe confirmar la baja' }),
});

export const AsignacionSchema = z.object({
  usuarios: z.array(z.number().int().positive()).max(50),
});

// ---------- CU-09 Usuarios ----------
export const UsuarioSchema = z.object({
  nombre: texto(120),
  email: z.string().trim().toLowerCase().email('Email con formato inválido').max(160),
  rol: z.enum(ROLES),
  torres: z.array(z.number().int().positive()).max(50).optional(),
});

export const EditarUsuarioSchema = z.object({
  nombre: texto(120).optional(),
  rol: z.enum(ROLES).optional(),
  activo: z.boolean().optional(),
  torres: z.array(z.number().int().positive()).max(50).optional(),
});

// ---------- D-28 Registro con enlace de invitación (amplía CU-09) ----------
const tokenEnlace = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Enlace inválido');
export const InvitacionSchema = z.object({
  torres: z.array(z.number().int().positive()).min(1, 'Elija al menos una torre').max(50),
  dias: z.number().int().min(1).max(30).default(7),
  max_usos: z.number().int().min(1).max(500).default(20),
  descripcion: z.string().trim().max(120).optional(),
});
export const TokenInvitacionSchema = z.object({ token: tokenEnlace });
export const RegistroSchema = z.object({
  token: tokenEnlace,
  nombre: texto(120),
  email: z.string().trim().toLowerCase().email('Email con formato inválido').max(160),
  password: PasswordSchema,
});
export const ConfirmarRegistroSchema = z.object({ token: tokenEnlace });

export const FiltroAuditoriaSchema = z.object({
  usuario: id.optional(),
  accion: z.string().trim().max(60).optional(),
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------- CU-10 Cultivos ----------
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD');

export const CultivoSchema = z.object({
  id_instalacion: z.number().int().positive(),
  id_especie: z.number().int().positive(),
  fecha_inicio: fecha,
});
export const EditarCultivoSchema = z.object({
  id_especie: z.number().int().positive().optional(),
  fecha_inicio: fecha.optional(),
});
export const CerrarCultivoSchema = z.object({ fecha_fin: fecha });

// ---------- Eventos ----------
export const FiltroEventosSchema = z.object({
  dispositivo: id.optional(),
  torre: id.optional(),
  tipo: z.string().trim().max(40).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(25),
});

/** Formato uniforme de error de la API (Tabla 11). */
export interface ErrorApi {
  codigo: string;
  mensaje: string;
  campos?: { campo: string; mensaje: string }[];
}
