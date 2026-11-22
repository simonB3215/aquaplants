import { useRef, type ReactNode } from 'react';
import { FilterX } from 'lucide-react';
import { Boton } from './ui';

/** Fila de filtros con contador y «Limpiar filtros», común a Usuarios y Torres. */
export function BarraFiltros({ etiqueta, activos, visibles, total, unidad, alLimpiar, children }: { etiqueta: string; activos: boolean; visibles: number; total: number; unidad: [singular: string, plural: string]; alLimpiar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  function limpiar() {
    alLimpiar();
    // El botón desaparece al limpiar: el foco vuelve al buscador para no perderse.
    ref.current?.querySelector('input')?.focus();
  }

  return (
    <div className="barra-filtros" role="search" aria-label={etiqueta} ref={ref}>
      <div className="filtros">{children}</div>
      <div className="filtros-resumen">
        <span className="muted pequeno" role="status" aria-atomic="true">
          {activos ? `${visibles} de ${total}` : total} {unidad[total === 1 ? 0 : 1]}
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
