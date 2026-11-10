import { useId, useMemo, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { Boton, Campo } from './ui';

export interface OpcionSeleccion {
  id: number;
  texto: string;
}

/**
 * Lista de casillas con buscador, selección en bloque y contador.
 * Pensada para asignar muchas torres (o responsables) sin marcar una por una:
 * «Seleccionar visibles» y «Quitar visibles» actúan solo sobre lo que deja el filtro.
 * Es solo interfaz: la autorización la sigue validando el backend.
 */
export function SeleccionMultiple({
  etiqueta,
  opciones,
  seleccion,
  alCambiar,
  nombreItem = 'torre',
  femenino = true,
  error,
}: {
  etiqueta: string;
  opciones: OpcionSeleccion[];
  seleccion: number[];
  alCambiar: (ids: number[]) => void;
  /** En singular y minúscula, para el buscador y los mensajes («torre», «encargado»). */
  nombreItem?: string;
  femenino?: boolean;
  error?: string;
}) {
  const id = useId();
  const a = femenino ? 'a' : 'o';
  const [filtro, setFiltro] = useState('');
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visibles = useMemo(() => {
    const f = normalizar(filtro.trim());
    return f ? opciones.filter((o) => normalizar(o.texto).includes(f)) : opciones;
  }, [opciones, filtro]);
  const marcadas = new Set(seleccion);
  const visiblesMarcadas = visibles.filter((o) => marcadas.has(o.id)).length;

  const seleccionarVisibles = () => alCambiar([...new Set([...seleccion, ...visibles.map((o) => o.id)])]);
  const quitarVisibles = () => {
    const quitar = new Set(visibles.map((o) => o.id));
    alCambiar(seleccion.filter((x) => !quitar.has(x)));
  };
  const alternar = (o: OpcionSeleccion, marcar: boolean) => alCambiar(marcar ? [...seleccion, o.id] : seleccion.filter((x) => x !== o.id));

  return (
    <fieldset className="seleccion-multiple" aria-describedby={error ? `${id}-error` : undefined}>
      <legend>{etiqueta}</legend>
      {opciones.length === 0 ? (
        <p className="muted pequeno">No hay {nombreItem}s disponibles.</p>
      ) : (
        <>
          <Campo etiqueta={`Buscar ${nombreItem}`} type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Escriba parte del nombre" autoComplete="off" />
          <div className="seleccion-multiple-barra">
            <span className="pequeno" aria-live="polite">
              {seleccion.length} de {opciones.length} seleccionad{a}s
              {filtro.trim() && ` · ${visibles.length} visibles`}
            </span>
            <span className="seleccion-multiple-acciones">
              <Boton type="button" pequeno variante="fantasma" onClick={seleccionarVisibles} disabled={visibles.length === 0 || visiblesMarcadas === visibles.length}>
                {filtro.trim() ? 'Seleccionar visibles' : `Seleccionar tod${a}s`}
              </Boton>
              <Boton type="button" pequeno variante="fantasma" onClick={quitarVisibles} disabled={visiblesMarcadas === 0}>
                {filtro.trim() ? 'Quitar visibles' : femenino ? 'Ninguna' : 'Ninguno'}
              </Boton>
            </span>
          </div>
          <div className="seleccion-multiple-lista">
            {visibles.length === 0 ? (
              <p className="muted pequeno">{femenino ? 'Ninguna' : 'Ningún'} {nombreItem} coincide con «{filtro.trim()}».</p>
            ) : (
              visibles.map((o) => (
                <label key={o.id} className="seleccion-multiple-item">
                  <input type="checkbox" checked={marcadas.has(o.id)} onChange={(e) => alternar(o, e.target.checked)} />
                  {o.texto}
                </label>
              ))
            )}
          </div>
        </>
      )}
      {error && (
        <p id={`${id}-error`} className="campo-error" role="alert">
          <CircleAlert size={14} aria-hidden /> {error}
        </p>
      )}
    </fieldset>
  );
}
