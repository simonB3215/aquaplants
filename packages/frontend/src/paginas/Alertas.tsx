import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Alerta, Paginado, RespuestaEstado } from '@aquaplants/shared';
import { api, qs } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { BarraSuperior } from '../componentes/Layout';
import { ListaAlertas } from '../componentes/PanelAlertas';
import { Encabezado, Esqueleto, MensajeError, Paginador, Selector, Tarjeta } from '../componentes/ui';

/** CU-04 Panel de alertas: filtros por estado, torre y severidad; resolución según rol. */
export function Alertas() {
  const [params] = useSearchParams();
  const { usuario } = useSesion();
  const [estadoF, setEstado] = useState('activa');
  const [severidad, setSeveridad] = useState('');
  const [torre, setTorre] = useState(params.get('torre') ?? '');
  const [pagina, setPagina] = useState(1);
  const torres = useDatos<RespuestaEstado>((s) => api.get('/torres/estado', s), []);
  const alertas = useDatos<Paginado<Alerta>>((s) => api.get(`/alertas${qs({ estado: estadoF, severidad, torre, pagina, por_pagina: 20 })}`, s), [estadoF, severidad, torre, pagina], { cadaMs: 10_000 });
  return (
    <>
      <BarraSuperior actualizadoEn={alertas.actualizadoEn} desactualizado={alertas.desactualizado} />
      <Encabezado
        titulo="Alertas"
        descripcion={
          usuario?.rol === 'encargado'
            ? 'Alertas de sus torres. Puede resolver advertencias; las críticas las resuelve un Supervisor.'
            : 'Ordenadas por estado, gravedad y hora. Las alertas críticas requieren comentario al resolverse.'
        }
      />
      <Tarjeta etiqueta="Filtros">
        <div className="filtros">
          <Selector etiqueta="Estado" value={estadoF} onChange={(e) => (setEstado(e.target.value), setPagina(1))}>
            <option value="activa">Activas</option>
            <option value="resuelta">Resueltas (historial)</option>
            <option value="">Todas</option>
          </Selector>
          <Selector etiqueta="Severidad" value={severidad} onChange={(e) => (setSeveridad(e.target.value), setPagina(1))}>
            <option value="">Todas</option>
            <option value="critica">Crítica</option>
            <option value="advertencia">Advertencia</option>
          </Selector>
          <Selector etiqueta="Torre" value={torre} onChange={(e) => (setTorre(e.target.value), setPagina(1))}>
            <option value="">Todas</option>
            {torres.datos?.torres.map((t) => (
              <option key={t.id_instalacion} value={t.id_instalacion}>
                {t.nombre}
              </option>
            ))}
          </Selector>
        </div>
      </Tarjeta>
      <div className="seccion">
        <Tarjeta titulo={`${alertas.datos?.total ?? '…'} alertas`}>
          <MensajeError error={alertas.datos ? null : alertas.error} reintentar={alertas.refrescar} />
          {alertas.cargando && !alertas.datos ? (
            <Esqueleto n={3} alto={70} />
          ) : alertas.datos ? (
            <>
              <ListaAlertas alertas={alertas.datos.datos} alResolver={() => void alertas.refrescar()} />
              <Paginador pagina={pagina} total={alertas.datos.total} porPagina={20} onCambio={setPagina} />
            </>
          ) : null}
        </Tarjeta>
      </div>
    </>
  );
}
