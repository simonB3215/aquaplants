import type { EstadoConectividad, EstadoTorre, EstadoVariable } from '@aquaplants/shared';
import { normalizar } from './texto';
import { diasDeCultivo } from './formato';

/** Opción extra del filtro (solo en Torres): días del cultivo en curso. */
export const DIAS_CULTIVO = 'Días de cultivo';

export const ESTADOS_TORRE: EstadoVariable[] = ['critico', 'advertencia', 'normal', 'sin_clasificar', 'sin_datos'];
export const CONEXIONES_TORRE: EstadoConectividad[] = ['conectado', 'sin_senal', 'sincronizando', 'nunca_conectado'];

/** Filtro por la lectura actual de una variable (p. ej. temperatura): ordenar o comparar con un valor. */
export type ModoValor = 'alta' | 'baja' | 'mayor' | 'menor';
export const MODOS_VALOR: { valor: ModoValor; texto: string }[] = [
  { valor: 'alta', texto: 'Más alta primero' },
  { valor: 'baja', texto: 'Más baja primero' },
  { valor: 'mayor', texto: 'Mayor o igual que…' },
  { valor: 'menor', texto: 'Menor o igual que…' },
];
export interface FiltroValor {
  /** Nombre del tipo de variable («Temperatura»); vacío = sin filtro. */
  variable: string;
  modo: ModoValor;
  /** Texto del campo; admite coma decimal. */
  valor: string;
}
export const SIN_FILTRO_VALOR: FiltroValor = { variable: '', modo: 'alta', valor: '' };

/** Variables presentes en las torres (para el selector), en orden alfabético, con su unidad. */
export function variablesDeTorres(torres: EstadoTorre[]): { nombre: string; unidad: string }[] {
  const m = new Map<string, string>();
  for (const t of torres) for (const v of t.variables) if (!m.has(v.tipo_variable)) m.set(v.tipo_variable, v.unidad);
  return [...m].map(([nombre, unidad]) => ({ nombre, unidad })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Lectura actual de la variable en la torre (sensor activo con dato; si hay varios, el primero). */
export function valorActual(t: EstadoTorre | undefined, variable: string): number | null {
  if (variable === DIAS_CULTIVO) return t?.cultivo ? diasDeCultivo(t.cultivo.fecha_inicio) : null;
  const v = t?.variables.find((x) => x.tipo_variable === variable && x.sensor_activo && x.valor !== null);
  return v?.valor ?? null;
}

export const numeroFiltro = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')));
export const errorFiltroValor = (f: FiltroValor) => {
  if (!f.variable || (f.modo !== 'mayor' && f.modo !== 'menor') || f.valor.trim() === '') return undefined;
  return Number.isFinite(numeroFiltro(f.valor)) ? undefined : 'Ingrese un número';
};

/**
 * Ordena por la lectura actual («más alta/baja primero», las torres sin dato al final)
 * o deja solo las que cumplen «mayor/menor o igual que» (las sin dato quedan fuera).
 * `estado` da la torre con lecturas de cada elemento (sirve para Torres y para el CRUD).
 */
export function aplicarFiltroValor<T>(items: T[], estado: (x: T) => EstadoTorre | undefined, f: FiltroValor): T[] {
  if (!f.variable) return items;
  const val = (x: T) => valorActual(estado(x), f.variable);
  if (f.modo === 'mayor' || f.modo === 'menor') {
    const n = numeroFiltro(f.valor);
    if (n === null || !Number.isFinite(n)) return items;
    return items.filter((x) => {
      const v = val(x);
      return v !== null && (f.modo === 'mayor' ? v >= n : v <= n);
    }).sort((a, b) => (f.modo === 'mayor' ? val(b)! - val(a)! : val(a)! - val(b)!));
  }
  return [...items].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1;
    return f.modo === 'alta' ? vb - va : va - vb;
  });
}

export interface FiltroTorres extends FiltroValor {
  texto: string;
  /** El estado de la insignia de la tarjeta, o «alertas» = tiene alertas activas sin resolver. */
  estado: EstadoVariable | 'alertas' | '';
  conexion: EstadoConectividad | '';
}
export const SIN_FILTROS_TORRES: FiltroTorres = { texto: '', estado: '', conexion: '', ...SIN_FILTRO_VALOR };
export const hayFiltrosTorres = (f: FiltroTorres) => !!(f.texto.trim() || f.estado || f.conexion || f.variable);

/**
 * Cada palabra buscada debe aparecer en el nombre, cultivo, tipo, ubicación o un dispositivo.
 * En conexión basta con que un dispositivo de la torre esté así, igual que «Sin señal» en Inicio.
 */
export function filtrarTorres(torres: EstadoTorre[], f: FiltroTorres): EstadoTorre[] {
  const palabras = normalizar(f.texto).split(/\s+/).filter(Boolean);
  const filtradas = torres.filter((t) => {
    if (f.estado === 'alertas' ? t.alertas_activas === 0 : f.estado && t.estado_general !== f.estado) return false;
    if (f.conexion && !t.dispositivos.some((d) => d.conectividad === f.conexion)) return false;
    const tipo = t.tipo === 'aeroponica' ? 'Aeropónica' : 'Hidropónica';
    const donde = normalizar([t.nombre, t.cultivo?.especie, tipo, t.ubicacion, ...t.dispositivos.map((d) => d.nombre)].filter(Boolean).join(' '));
    const enteras = donde.split(/[^\p{L}\p{N}]+/u);
    // Un carácter suelto es palabra completa: si no, «torre b» calzaría con todos los AquaBrain.
    return palabras.every((p) => (p.length === 1 ? enteras.includes(p) : donde.includes(p)));
  });
  return aplicarFiltroValor(filtradas, (t) => t, f);
}

/* El filtro se conserva al entrar a una ficha y volver; es por usuario y dura lo que la pestaña. */
const clave = (idUsuario?: number) => `aq_filtros_torres_${idUsuario ?? 0}`;

export function leerFiltroTorres(idUsuario?: number): FiltroTorres {
  try {
    const g = JSON.parse(sessionStorage.getItem(clave(idUsuario)) ?? '{}') as Partial<FiltroTorres>;
    return {
      texto: typeof g.texto === 'string' ? g.texto : '',
      estado: g.estado === 'alertas' || ESTADOS_TORRE.includes(g.estado as EstadoVariable) ? g.estado! : '',
      conexion: CONEXIONES_TORRE.includes(g.conexion as EstadoConectividad) ? g.conexion! : '',
      variable: typeof g.variable === 'string' ? g.variable : '',
      modo: MODOS_VALOR.some((m) => m.valor === g.modo) ? g.modo! : 'alta',
      valor: typeof g.valor === 'string' ? g.valor : '',
    };
  } catch {
    return SIN_FILTROS_TORRES;
  }
}

export function guardarFiltroTorres(idUsuario: number | undefined, f: FiltroTorres) {
  try {
    sessionStorage.setItem(clave(idUsuario), JSON.stringify(f));
  } catch {
    // Sin almacenamiento (modo privado): el filtro funciona igual, solo no se recuerda.
  }
}
