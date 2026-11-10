import { z } from 'zod';

/**
 * Contrato de telemetría compartido entre simulador, firmware y API
 * (sección 3.2/3.3 del ES2). Se añade `meta` OPCIONAL con información de la
 * cola local del dispositivo; es compatible hacia atrás con el lote del ES2.
 */
export const LecturaSchema = z.object({
  id_sensor: z.number().int().positive(),
  ts: z.string().datetime({ offset: true }),
  valor: z.number().finite(),
});

export const MetaLoteSchema = z
  .object({
    /** Lotes que siguen pendientes en la cola local después de este. */
    pendientes: z.number().int().min(0).max(1_000_000).optional(),
    /** true si el lote se generó durante una desconexión y se envía al recuperar la red. */
    recuperado: z.boolean().optional(),
    firmware: z.string().max(40).optional(),
    /** D-35: intensidad de la señal del enlace al enviar (RSSI, dBm). */
    rssi_dbm: z.number().int().min(-130).max(0).optional(),
  })
  .strict();

export const LoteSchema = z
  .object({
    id_lote: z.string().uuid(),
    id_dispositivo: z.number().int().positive(),
    lecturas: z.array(LecturaSchema).min(1).max(500),
    meta: MetaLoteSchema.optional(),
  })
  .strict();

export type Lectura = z.infer<typeof LecturaSchema>;
export type Lote = z.infer<typeof LoteSchema>;

/** Respuesta de POST /api/v1/telemetria */
export interface ResultadoIngesta {
  id_lote: string;
  recibidas: number;
  duplicado: boolean;
}

/**
 * Eventos que el propio dispositivo reporta (extensión documentada en
 * docs/DECISIONES.md): reinicio tras arranque, datos descartados por cola llena
 * y reconexión local. El servidor NO deduce la causa de un corte.
 */
export const TIPOS_EVENTO_DISPOSITIVO = ['reinicio', 'datos_descartados', 'reconexion_local'] as const;

export const EventoDispositivoSchema = z
  .object({
    id_evento_local: z.string().uuid(),
    id_dispositivo: z.number().int().positive(),
    tipo: z.enum(TIPOS_EVENTO_DISPOSITIVO),
    ts: z.string().datetime({ offset: true }),
    detalle: z
      .object({
        desde: z.string().datetime({ offset: true }).optional(),
        hasta: z.string().datetime({ offset: true }).optional(),
        lotes: z.number().int().min(0).optional(),
        lecturas: z.number().int().min(0).optional(),
        motivo: z.string().max(200).optional(),
        pendientes_en_cola: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type EventoDispositivo = z.infer<typeof EventoDispositivoSchema>;
