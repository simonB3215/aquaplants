import type { EstadoConectividad, EstadoTorre, EstadoVariable } from '@aquaplants/shared';
import { normalizar } from './texto';

export const ESTADOS_TORRE: EstadoVariable[] = ['critico', 'advertencia', 'normal', 'sin_clasificar', 'sin_datos'];
export const CONEXIONES_TORRE: EstadoConectividad[] = ['conectado', 'sin_senal', 'sincronizando', 'nunca_conectado'];

export interface FiltroTorres {
  texto: string;
  /** El estado de la insignia de la tarjeta, o «alertas» = tiene alertas activas sin resolver. */
  estado: EstadoVariable | 'alertas' | '';
  conexion: EstadoConectividad | '';
}
export const SIN_FILTROS_TORRES: FiltroTorres = { texto: '', estado: '', conexion: '' };
export const hayFiltrosTorres = (f: FiltroTorres) => !!(f.texto.trim() || f.estado || f.conexion);

/**
 * Cada palabra buscada debe aparecer en el nombre, cultivo, tipo, ubicación o un dispositivo.
 * En conexión basta con que un dispositivo de la torre esté así, igual que «Sin señal» en Inicio.
 */
export function filtrarTorres(torres: EstadoTorre[], f: FiltroTorres): EstadoTorre[] {
  const palabras = normalizar(f.texto).split(/\s+/).filter(Boolean);
  return torres.filter((t) => {
    if (f.estado === 'alertas' ? t.alertas_activas === 0 : f.estado && t.estado_general !== f.estado) return false;
    if (f.conexion && !t.dispositivos.some((d) => d.conectividad === f.conexion)) return false;
    const tipo = t.tipo === 'aeroponica' ? 'Aeropónica' : 'Hidropónica';
    const donde = normalizar([t.nombre, t.cultivo?.especie, tipo, t.ubicacion, ...t.dispositivos.map((d) => d.nombre)].filter(Boolean).join(' '));
    const enteras = donde.split(/[^\p{L}\p{N}]+/u);
    // Un carácter suelto es palabra completa: si no, «torre b» calzaría con todos los AquaBrain.
    return palabras.every((p) => (p.length === 1 ? enteras.includes(p) : donde.includes(p)));
  });
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
