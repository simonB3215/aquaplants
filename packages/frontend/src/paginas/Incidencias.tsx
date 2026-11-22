import { useState, type FormEvent } from 'react';
import { CircleCheck, Cpu, Hand, Wifi, WifiOff, Wrench } from 'lucide-react';
import type { Incidencia, Paginado } from '@aquaplants/shared';
import { api, qs, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { useAvisos } from '../estado/avisos';
import { BarraSuperior } from '../componentes/Layout';
import { EnlaceGps } from '../componentes/Ubicacion';
import { useResumenAlertas } from '../componentes/IndicadorAlertas';
import { Boton, Campo, Encabezado, Esqueleto, MensajeError, Modal, Paginador, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { fechaHora, hace } from '../util/formato';

export const ESTADO_INCIDENCIA: Record<Incidencia['estado'], { texto: string; clase: string; icono: typeof WifiOff }> = {
  abierta: { texto: 'Sin atender', clase: 'e-sin-senal', icono: WifiOff },
  en_atencion: { texto: 'En atención', clase: 'e-sincronizando', icono: Wrench },
  cerrada: { texto: 'Cerrada', clase: 'e-neutro', icono: CircleCheck },
};

/**
 * RN-13 (Anexo C, D-37): incidencias de equipos. Al Técnico le llegan como aviso en la
 * aplicación cuando un AquaBrain de sus clientes deja de comunicarse. La toma («Atender»)
 * y la cierra con un comentario cuando el equipo vuelve. El Supervisor solo las consulta.
 */
export function Incidencias() {
  const { puede, usuario } = useSesion();
  const avisar = useAvisos();
  const resumen = useResumenAlertas();
  const escribir = puede('incidencias.atender');
  const [estado, setEstado] = useState('activas');
  const [pagina, setPagina] = useState(1);
  const lista = useDatos<Paginado<Incidencia>>((s) => api.get(`/incidencias${qs({ estado, pagina, por_pagina: 20 })}`, s), [estado, pagina], { cadaMs: 10_000 });
  const [cierre, setCierre] = useState<Incidencia | null>(null);
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState<number | null>(null);

  const refrescar = () => void Promise.all([lista.refrescar(), resumen.refrescar()]);

  async function atender(n: Incidencia) {
    setEnviando(n.id_incidencia);
    try {
      await api.patch(`/incidencias/${n.id_incidencia}/atender`);
      avisar(`Incidencia de ${n.dispositivo} en atención`);
      refrescar();
    } catch (x) {
      avisar((x as ApiError).message);
    } finally {
      setEnviando(null);
    }
  }
  async function cerrar(e: FormEvent) {
    e.preventDefault();
    if (!cierre) return;
    if (!comentario.trim()) return setError('Indique qué se hizo');
    setEnviando(cierre.id_incidencia);
    try {
      await api.patch(`/incidencias/${cierre.id_incidencia}/cerrar`, { comentario: comentario.trim() });
      avisar('Incidencia cerrada');
      setCierre(null);
      refrescar();
    } catch (x) {
      setError((x as ApiError).message);
    } finally {
      setEnviando(null);
    }
  }

  return (
    <>
      <BarraSuperior actualizadoEn={lista.actualizadoEn} desactualizado={lista.desactualizado} />
      <Encabezado
        titulo="Incidencias de equipos"
        descripcion={
          usuario?.rol === 'tecnico'
            ? 'Equipos de sus clientes que dejaron de comunicarse. Tómelos con «Atender» y ciérrelos cuando vuelvan (RN-13).'
            : escribir
              ? 'Equipos sin señal de todos los clientes. No reemplazan las alertas de cultivo.'
              : 'Equipos de su cliente que dejaron de comunicarse. Los atiende el Técnico de AquaPlants.'
        }
      />
      <Tarjeta etiqueta="Filtros">
        <div className="filtros">
          <Selector etiqueta="Estado" value={estado} onChange={(e) => (setEstado(e.target.value), setPagina(1))}>
            <option value="activas">Activas (sin atender y en atención)</option>
            <option value="abierta">Sin atender</option>
            <option value="en_atencion">En atención</option>
            <option value="cerrada">Cerradas (historial)</option>
            <option value="">Todas</option>
          </Selector>
        </div>
      </Tarjeta>
      <MensajeError error={lista.datos ? null : lista.error} reintentar={lista.refrescar} />
      {!lista.datos ? (
        <Esqueleto n={3} alto={120} />
      ) : !lista.datos.datos.length ? (
        <Tarjeta etiqueta="Sin incidencias">
          <Vacio titulo={estado === 'activas' ? 'Todos los equipos se están comunicando' : 'Sin incidencias'} icono={Wifi}>
            {estado === 'activas' ? 'Si un AquaBrain deja de reportar, aparecerá aquí.' : undefined}
          </Vacio>
        </Tarjeta>
      ) : (
        <div className="rejilla">
          {lista.datos.datos.map((n) => {
            const e = ESTADO_INCIDENCIA[n.estado];
            return (
              <article key={n.id_incidencia} className="tarjeta vidrio incidencia" data-estado={n.estado} aria-labelledby={`inc-${n.id_incidencia}`}>
                <div className="incidencia-cab">
                  <h3 id={`inc-${n.id_incidencia}`}>
                    <Cpu size={16} aria-hidden /> {n.dispositivo} · {n.torre}
                  </h3>
                  <span className={`insignia ${e.clase}`}>
                    <e.icono size={14} aria-hidden /> {e.texto}
                  </span>
                </div>
                <div className="incidencia-datos pequeno">
                  <span>
                    Cliente: <strong>{n.cliente}</strong>
                  </span>
                  <span>
                    Sin señal desde <time dateTime={n.abierta_en}>{fechaHora(n.abierta_en)}</time> ({hace(n.abierta_en)})
                  </span>
                  {n.ocurrencias > 1 && <span>Se repitió {n.ocurrencias} veces</span>}
                </div>
                <p className="pequeno">
                  {n.sigue_sin_senal ? (
                    <span className="insignia e-sin-senal">
                      <WifiOff size={14} aria-hidden /> Sigue sin señal · causa desconocida (Internet, energía o equipo)
                    </span>
                  ) : (
                    <span className="insignia e-normal">
                      <Wifi size={14} aria-hidden /> Volvió a comunicarse{n.senal_recuperada_en ? ` ${hace(n.senal_recuperada_en)}` : ''}
                    </span>
                  )}
                </p>
                <EnlaceGps latitud={n.latitud} longitud={n.longitud} />
                {n.atendida_por && n.estado !== 'cerrada' && (
                  <p className="muted pequeno">
                    Atiende {n.atendida_por} desde {fechaHora(n.atendida_en)}
                  </p>
                )}
                {n.estado === 'cerrada' && (
                  <p className="muted pequeno">
                    Cerrada por {n.cerrada_por} el {fechaHora(n.cerrada_en)}: «{n.comentario_cierre}»
                  </p>
                )}
                {escribir && n.estado !== 'cerrada' && (
                  <div className="acciones" style={{ justifyContent: 'flex-start' }}>
                    {n.estado === 'abierta' && (
                      <Boton pequeno variante="primario" icono={Hand} cargando={enviando === n.id_incidencia} onClick={() => void atender(n)}>
                        Atender
                      </Boton>
                    )}
                    <Boton
                      pequeno
                      variante="secundario"
                      icono={CircleCheck}
                      disabled={n.sigue_sin_senal}
                      title={n.sigue_sin_senal ? 'Se cierra cuando el equipo vuelva a comunicarse o se dé de baja' : undefined}
                      onClick={() => (setComentario(''), setError(''), setCierre(n))}
                    >
                      Cerrar
                    </Boton>
                    {n.sigue_sin_senal && <span className="muted pequeno">Se podrá cerrar cuando vuelva la señal.</span>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {lista.datos && lista.datos.total > 20 && <Paginador pagina={pagina} total={lista.datos.total} porPagina={20} onCambio={setPagina} />}

      <Modal titulo={`Cerrar incidencia de ${cierre?.dispositivo ?? ''}`} abierto={!!cierre} onCerrar={() => setCierre(null)}>
        <form className="formulario" onSubmit={cerrar} noValidate>
          <Campo etiqueta="¿Qué se hizo?" maxLength={500} value={comentario} onChange={(e) => setComentario(e.target.value)} error={error || undefined} ayuda="Por ejemplo: «Se reinició el router del invernadero»." />
          <div className="acciones">
            <Boton type="button" variante="fantasma" onClick={() => setCierre(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="primario" cargando={enviando === cierre?.id_incidencia}>
              Cerrar incidencia
            </Boton>
          </div>
        </form>
      </Modal>
    </>
  );
}
