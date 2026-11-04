/**
 * Puertos del dominio (Tabla 13 del ES2). Los servicios dependen solo de estas
 * interfaces; los adaptadores concretos (pg, mongodb, nodemailer) se inyectan en
 * un único punto de composición (src/app.ts y src/contenedor.ts).
 */
import type { Lectura } from '@aquaplants/shared';

export interface ResultadoConsulta<T> {
  rows: T[];
  rowCount: number | null;
}

/** Ejecuta SQL parametrizado. Nunca se concatenan valores en el SQL. */
export interface Consulta {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<ResultadoConsulta<T>>;
}

export interface IUnitOfWork {
  /** Ejecuta `fn` en una transacción; revierte ante cualquier excepción. */
  transaccion<T>(fn: (tx: Consulta) => Promise<T>): Promise<T>;
}

export interface IBaseDatos extends Consulta, IUnitOfWork {
  ping(): Promise<void>;
  cerrar(): Promise<void>;
}

export interface MedicionInsertada {
  id_medicion: string;
  ts: string;
  id_sensor: number;
  valor: number;
}

export interface IMedicionRepo {
  /** Inserta las lecturas del lote. Devuelve las filas nuevas (ignora duplicados (id_sensor, ts)). */
  insertarLote(tx: Consulta, idLote: string, lecturas: Lectura[]): Promise<MedicionInsertada[]>;
  porLote(tx: Consulta, idLote: string): Promise<MedicionInsertada[]>;
}

export interface UmbralVigente {
  id_umbral: number;
  id_sensor: number;
  severidad: 'advertencia' | 'critica';
  valor_min: number;
  valor_max: number;
}

export interface IAlertaRepo {
  umbralesActivos(tx: Consulta, idsSensor: number[]): Promise<UmbralVigente[]>;
  /**
   * Crea la alerta o, si ya existe una activa para (sensor, umbral), actualiza su
   * último valor y contador (una alerta por situación). Devuelve si fue nueva.
   */
  registrarViolacion(tx: Consulta, m: MedicionInsertada, u: UmbralVigente, notificar: boolean): Promise<{ id_alerta: number; nueva: boolean }>;
}

export interface IOutbox {
  encolar(tx: Consulta, idLote: string): Promise<void>;
  /** Toma trabajos pendientes con FOR UPDATE SKIP LOCKED dentro de la transacción. */
  tomar(tx: Consulta, limite: number): Promise<{ id: number; id_lote: string; intentos: number }[]>;
  marcarProcesado(tx: Consulta, id: number): Promise<void>;
  registrarFallo(id: number, error: string, maxIntentos: number): Promise<{ cuarentena: boolean }>;
}

export interface DocumentoPayload {
  id_lote: string;
  id_dispositivo: number;
  payload: unknown;
  estado: 'recibido' | 'procesado';
  recibido_en: Date;
}

export interface IPayloadStore {
  /** Inserta el payload crudo con estado «recibido». Idempotente por id_lote. */
  guardarRecibido(doc: Omit<DocumentoPayload, 'estado' | 'recibido_en'>): Promise<void>;
  marcarProcesado(idLote: string): Promise<void>;
  recibidosSinProcesar(antiguedadMin: number, limite: number): Promise<DocumentoPayload[]>;
  guardarDetalleEvento(detalle: Record<string, unknown>): Promise<string>;
  ping(): Promise<void>;
  cerrar(): Promise<void>;
}

export interface MensajeNotificacion {
  destinatarios: string[];
  asunto: string;
  texto: string;
}

export interface INotificador {
  readonly configurado: boolean;
  enviar(m: MensajeNotificacion): Promise<void>;
}
