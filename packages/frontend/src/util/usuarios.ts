import type { Rol } from '@aquaplants/shared';
import { normalizar } from './texto';

export const ESTADOS_USUARIO = {
  activo: { texto: 'Activo', clase: 'e-normal' },
  bloqueado: { texto: 'Bloqueado temporalmente', clase: 'e-advertencia' },
  inactivo: { texto: 'Inactivo', clase: 'e-neutro' },
} as const;
export type EstadoUsuario = keyof typeof ESTADOS_USUARIO;

/** Un solo estado por usuario: el mismo criterio para la insignia y para el filtro. */
export const estadoUsuario = (u: { activo: boolean; bloqueado: boolean }): EstadoUsuario => (!u.activo ? 'inactivo' : u.bloqueado ? 'bloqueado' : 'activo');

export interface FiltroUsuarios {
  texto: string;
  rol: Rol | '';
  estado: EstadoUsuario | '';
}
export const SIN_FILTROS: FiltroUsuarios = { texto: '', rol: '', estado: '' };
export const hayFiltros = (f: FiltroUsuarios) => !!(f.texto.trim() || f.rol || f.estado);

/** Cada palabra buscada debe aparecer en el nombre o en el email, en cualquier orden. */
export function filtrarUsuarios<T extends { nombre: string; email: string; rol: Rol; activo: boolean; bloqueado: boolean }>(usuarios: T[], f: FiltroUsuarios): T[] {
  const palabras = normalizar(f.texto).split(/\s+/).filter(Boolean);
  return usuarios.filter((u) => {
    if (f.rol && u.rol !== f.rol) return false;
    if (f.estado && estadoUsuario(u) !== f.estado) return false;
    const donde = normalizar(`${u.nombre} ${u.email}`);
    return palabras.every((p) => donde.includes(p));
  });
}
