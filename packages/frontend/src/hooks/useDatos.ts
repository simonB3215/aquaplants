import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/cliente';

interface Opciones {
  /** Intervalo de refresco en ms (CU-03: 5 s). Se pausa con la pestaña oculta. */
  cadaMs?: number;
  activo?: boolean;
}

/**
 * Carga datos de la API. Ante una falla de red en un refresco CONSERVA los últimos
 * datos y marca `desactualizado` (CU-03 7a), en lugar de vaciar la vista.
 */
export function useDatos<T>(cargar: (señal: AbortSignal) => Promise<T>, deps: unknown[], { cadaMs, activo = true }: Opciones = {}) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizadoEn, setActualizadoEn] = useState<Date | null>(null);
  const [desactualizado, setDesactualizado] = useState(false);
  const ref = useRef(cargar);
  ref.current = cargar;

  const refrescar = useCallback(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const d = await ref.current(ctrl.signal);
      setDatos(d);
      setError(null);
      setDesactualizado(false);
      setActualizadoEn(new Date());
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setDesactualizado(true);
        return;
      }
      const err = e instanceof ApiError ? e : new ApiError(0, 'ERROR', (e as Error).message);
      setError(err);
      if (err.esConectividad) setDesactualizado(true);
    } finally {
      clearTimeout(t);
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!activo) return;
    setCargando(true);
    void refrescar();
    if (!cadaMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refrescar();
    }, cadaMs);
    const vis = () => document.visibilityState === 'visible' && void refrescar();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, activo, cadaMs, refrescar]);

  return { datos, error, cargando, actualizadoEn, desactualizado, refrescar, setDatos };
}
