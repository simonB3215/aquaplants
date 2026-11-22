import { useRef } from 'react';
import { FilterX } from 'lucide-react';
import { ETIQUETA_ROL, ROLES, type Rol } from '@aquaplants/shared';
import { ESTADOS_USUARIO, hayFiltros, SIN_FILTROS, type EstadoUsuario, type FiltroUsuarios } from '../util/usuarios';
import { Boton, Campo, Selector } from './ui';

/** Buscador y filtros de la lista de usuarios. Es solo interfaz: el acceso lo valida el backend. */
export function FiltrosUsuarios({ filtro, alCambiar, visibles, total }: { filtro: FiltroUsuarios; alCambiar: (f: FiltroUsuarios) => void; visibles: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const activos = hayFiltros(filtro);

  function limpiar() {
    alCambiar(SIN_FILTROS);
    // El botón desaparece al limpiar: el foco vuelve al buscador para no perderse.
    ref.current?.querySelector('input')?.focus();
  }

  return (
    <div className="filtros-usuarios" role="search" aria-label="Filtrar usuarios" ref={ref}>
      <div className="filtros">
        <Campo etiqueta="Buscar por nombre o email" type="search" autoComplete="off" value={filtro.texto} onChange={(e) => alCambiar({ ...filtro, texto: e.target.value })} />
        <Selector etiqueta="Rol" value={filtro.rol} onChange={(e) => alCambiar({ ...filtro, rol: e.target.value as Rol | '' })}>
          <option value="">Todos</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ETIQUETA_ROL[r]}
            </option>
          ))}
        </Selector>
        <Selector etiqueta="Estado" value={filtro.estado} onChange={(e) => alCambiar({ ...filtro, estado: e.target.value as EstadoUsuario | '' })}>
          <option value="">Todos</option>
          {Object.entries(ESTADOS_USUARIO).map(([valor, { texto }]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </Selector>
      </div>
      <div className="filtros-resumen">
        <span className="muted pequeno" role="status" aria-atomic="true">
          {activos ? `${visibles} de ${total}` : total} {total === 1 ? 'usuario' : 'usuarios'}
        </span>
        {activos && (
          <Boton type="button" variante="fantasma" icono={FilterX} onClick={limpiar}>
            Limpiar filtros
          </Boton>
        )}
      </div>
    </div>
  );
}
