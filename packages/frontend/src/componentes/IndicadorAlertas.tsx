import { createContext, useContext, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, OctagonAlert, WifiOff } from 'lucide-react';
import type { Alerta, Incidencia, Paginado } from '@aquaplants/shared';
import { api, qs } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';

/**
 * Qué cuenta la campana: alertas de cultivo (RN-10) o, para el Técnico (Anexo C, D-37),
 * incidencias de equipos sin señal, que es lo único que le llega en la aplicación.
 */
export type FuenteAvisos = 'alertas' | 'incidencias';

interface ResumenAlertas {
  fuente: FuenteAvisos;
  /** null = todavía no se sabe (cargando o sin respuesta): nunca se muestra como 0. */
  total: number | null;
  hayCritica: boolean;
  desactualizado: boolean;
  refrescar: () => Promise<void>;
}

const Contexto = createContext<ResumenAlertas>({ fuente: 'alertas', total: null, hayCritica: false, desactualizado: false, refrescar: async () => {} });
export const useResumenAlertas = () => useContext(Contexto);

function frase({ fuente, total, hayCritica, desactualizado }: Omit<ResumenAlertas, 'refrescar'>) {
  const [una, varias, nada] =
    fuente === 'incidencias' ? ['incidencia activa', 'incidencias activas', 'Sin incidencias activas'] : ['alerta activa', 'alertas activas', 'Sin alertas activas'];
  if (total === null) return `${fuente === 'incidencias' ? 'Incidencias' : 'Alertas'} activas: sin datos`;
  const cantidad = total === 0 ? nada : total === 1 ? `1 ${una}` : `${total} ${varias}`;
  return `${cantidad}${hayCritica ? ', hay críticas' : ''}${desactualizado ? ' (dato desactualizado)' : ''}`;
}

/**
 * Vive en el Layout para no reiniciarse al cambiar de página. Basta una fila:
 * la API ordena las críticas primero, entrega el total y filtra por rol (RN-10).
 */
export function ProveedorAlertas({ activo, fuente = 'alertas', children }: { activo: boolean; fuente?: FuenteAvisos; children: ReactNode }) {
  const r = useDatos<Paginado<Alerta | Incidencia>>(
    (s) =>
      fuente === 'incidencias'
        ? api.get(`/incidencias${qs({ estado: 'activas', pagina: 1, por_pagina: 1 })}`, s)
        : api.get(`/alertas${qs({ estado: 'activa', pagina: 1, por_pagina: 1 })}`, s),
    [fuente],
    { cadaMs: 10_000, activo },
  );
  const primera = r.datos?.datos[0];
  const resumen: ResumenAlertas = {
    fuente,
    total: r.datos?.total ?? null,
    hayCritica: fuente === 'alertas' && !!primera && 'severidad' in primera && primera.severidad === 'critica',
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
  const { fuente, total, hayCritica } = resumen;
  const texto = frase(resumen);
  const Icono = fuente === 'incidencias' ? WifiOff : hayCritica ? BellRing : Bell;
  const tono = hayCritica ? 'e-critico' : total ? 'e-advertencia' : 'e-neutro';
  const destino = fuente === 'incidencias' ? '/incidencias' : '/alertas';
  return (
    <Link to={destino} className={`insignia campana-alertas ${tono}`} aria-label={`${texto}. Ver ${fuente}`} title={texto}>
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
