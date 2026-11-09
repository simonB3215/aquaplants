import type { Rol } from './permisos.js';
import type { Severidad } from './schemas/api.js';

/** Estado de la variable respecto de sus umbrales (CU-03). */
export type EstadoVariable = 'normal' | 'advertencia' | 'critico' | 'sin_clasificar' | 'sin_datos';

/**
 * Estado de conectividad de un dispositivo, independiente del estado del cultivo.
 * «Error de servidor» lo determina el cliente cuando la API no responde.
 */
export type EstadoConectividad = 'conectado' | 'sin_senal' | 'sincronizando' | 'baja' | 'nunca_conectado';

export interface UsuarioSesion {
  id_usuario: number;
  nombre: string;
  email: string;
  rol: Rol;
  debe_cambiar_password: boolean;
  /** D-32: correos de alerta crítica. */
  aviso_alertas: AvisoAlertas;
}

export type AvisoAlertas = 'todas' | 'urgentes' | 'ninguna';

export interface RespuestaLogin {
  token: string;
  expira_en: string;
  usuario: UsuarioSesion;
}

export interface VariableEstado {
  id_sensor: number;
  tipo_variable: string;
  id_tipo_variable: number;
  unidad: string;
  valor: number | null;
  ts: string | null;
  estado: EstadoVariable;
  umbrales: { severidad: Severidad; valor_min: number; valor_max: number }[];
  sensor_activo: boolean;
}

export interface DispositivoEstado {
  id_dispositivo: number;
  nombre: string;
  estado_registro: 'activo' | 'baja' | 'sin_senal';
  conectividad: EstadoConectividad;
  ultima_comunicacion: string | null;
  segundos_sin_reportar: number | null;
  intervalo_muestreo_s: number;
  umbral_sin_senal_s: number;
  pendientes_reportados: number | null;
  datos_desactualizados: boolean;
}

export interface EstadoTorre {
  id_instalacion: number;
  nombre: string;
  tipo: 'aeroponica' | 'hidroponica';
  ubicacion: string;
  estado_registro: 'activo' | 'baja';
  cultivo: { id_cultivo: number; especie: string; fecha_inicio: string } | null;
  estado_general: EstadoVariable;
  alertas_activas: number;
  dispositivos: DispositivoEstado[];
  variables: VariableEstado[];
  ultima_lectura: string | null;
}

export interface RespuestaEstado {
  generado_en: string;
  torres: EstadoTorre[];
}

export interface Alerta {
  id_alerta: number;
  id_sensor: number;
  id_instalacion: number;
  torre: string;
  tipo_variable: string;
  unidad: string;
  severidad: Severidad;
  estado: 'activa' | 'resuelta';
  valor: number;
  valor_min: number;
  valor_max: number;
  ultimo_valor: number;
  ts_ultima: string;
  ocurrencias: number;
  fecha_generacion: string;
  fecha_resolucion: string | null;
  resuelta_por: string | null;
  comentario: string | null;
  notificacion_estado: string;
}

export interface Paginado<T> {
  datos: T[];
  total: number;
  pagina: number;
  por_pagina: number;
}

export interface PuntoSerie {
  t: string;
  promedio: number;
  minimo: number;
  maximo: number;
  n: number;
}

export interface RespuestaHistorico {
  sensor: { id_sensor: number; tipo_variable: string; unidad: string; torre: string; id_instalacion: number };
  granularidad: string;
  desde: string;
  hasta: string;
  umbrales: { severidad: Severidad; valor_min: number; valor_max: number }[];
  puntos: PuntoSerie[];
  /** Huecos detectados entre lecturas (sin mediciones), p. ej. un corte eléctrico. */
  huecos: { desde: string; hasta: string }[];
}

export interface RespuestaComparar {
  tipo_variable: { id_tipo_variable: number; nombre: string; unidad: string };
  granularidad: string;
  series: { id_instalacion: number; torre: string; puntos: PuntoSerie[] }[];
  sin_datos: { id_instalacion: number; torre: string }[];
}

export interface EventoOperativo {
  id_evento: number;
  id_dispositivo: number;
  dispositivo: string;
  torre: string;
  tipo: string;
  descripcion: string;
  origen: 'servidor' | 'dispositivo';
  detalle: Record<string, unknown> | null;
  ts: string;
}

export interface ResumenContinuidad {
  generado_en: string;
  dispositivos: (DispositivoEstado & { torre: string; id_instalacion: number })[];
  lotes_recuperados_24h: number;
  lecturas_recuperadas_24h: number;
  lotes_duplicados_24h: number;
  descartes: EventoOperativo[];
  eventos_recientes: EventoOperativo[];
}

export const NOMBRE_ESTADO_VARIABLE: Record<EstadoVariable, string> = {
  normal: 'Normal',
  advertencia: 'Advertencia',
  critico: 'Crítico',
  sin_clasificar: 'Sin umbral',
  sin_datos: 'Sin datos',
};

export const NOMBRE_CONECTIVIDAD: Record<EstadoConectividad, string> = {
  conectado: 'Conectado',
  sin_senal: 'Sin señal',
  sincronizando: 'Sincronizando',
  baja: 'De baja',
  nunca_conectado: 'Sin comunicaciones',
};
