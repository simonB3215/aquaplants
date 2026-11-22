import { createContext, useContext, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, OctagonAlert } from 'lucide-react';
import type { Alerta, Paginado } from '@aquaplants/shared';
import { api, qs } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';

interface ResumenAlertas {
  /** null = todavía no se sabe (cargando o sin respuesta): nunca se muestra como 0. */
  total: number | null;
  hayCritica: boolean;
  desactualizado: boolean;
  refrescar: () => Promise<void>;
}

const Contexto = createContext<ResumenAlertas>({ total: null, hayCritica: false, desactualizado: false, refrescar: async () => {} });
export const useResumenAlertas = () => useContext(Contexto);

function frase({ total, hayCritica, desactualizado }: Omit<ResumenAlertas, 'refrescar'>) {
  if (total === null) return 'Alertas activas: sin datos';
  const cantidad = total === 0 ? 'Sin alertas activas' : total === 1 ? '1 alerta activa' : `${total} alertas activas`;
  return `${cantidad}${hayCritica ? ', hay críticas' : ''}${desactualizado ? ' (dato desactualizado)' : ''}`;
}

/**
 * Vive en el Layout para no reiniciarse al cambiar de página. Basta una fila:
 * la API ordena las críticas primero, entrega el total y filtra por rol (RN-10).
 */
export function ProveedorAlertas({ activo, children }: { activo: boolean; children: ReactNode }) {
  const r = useDatos<Paginado<Alerta>>(
    (s) => api.get(`/alertas${qs({ estado: 'activa', pagina: 1, por_pagina: 1 })}`, s),
    [],
    { cadaMs: 10_000, activo },
  );
  const resumen = {
    total: r.datos?.total ?? null,
    hayCritica: r.datos?.datos[0]?.severidad === 'critica',
    desactualizado: r.desactualizado,
    refrescar: r.refrescar,
  };
  return (
    <Contexto.Provider value={resumen}>
      <span className="sr-only" role="status" aria-atomic="true">
        {resumen.total === null ? '' : frase(resumen)}
      </span>
      {children}
    </Contexto.Provider>
  );
}

/** Campana de la barra superior: ícono + número y, si hay críticas, también «Hay críticas» (no solo color). */
export function CampanaAlertas() {
  const resumen = useResumenAlertas();
  const { total, hayCritica } = resumen;
  const texto = frase(resumen);
  const Icono = hayCritica ? BellRing : Bell;
  const tono = hayCritica ? 'e-critico' : total ? 'e-advertencia' : 'e-neutro';
  return (
    <Link to="/alertas" className={`insignia campana-alertas ${tono}`} aria-label={`${texto}. Ver alertas`} title={texto}>
      <Icono size={20} aria-hidden />
      <span className="dato">{total === null ? '—' : total > 99 ? '99+' : total}</span>
      {hayCritica && <span>· Hay críticas</span>}
    </Link>
  );
}

/** Número junto a «Alertas» en el menú. Con 0 o sin datos no se muestra; si hay críticas lleva ícono además de color. */
export function NumeroAlertasNav() {
  const resumen = useResumenAlertas();
  const { total, hayCritica } = resumen;
  if (!total) return null;
  return (
    <>
      <span className={`numero-nav ${hayCritica ? 'e-critico' : 'e-advertencia'}`} aria-hidden>
        {hayCritica && <OctagonAlert size={12} />}
        <span className="dato">{total > 99 ? '99+' : total}</span>
      </span>
      <span className="sr-only">: {frase(resumen)}</span>
    </>
  );
}
