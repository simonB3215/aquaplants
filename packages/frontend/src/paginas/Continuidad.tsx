import { useState } from 'react';
import { Database, PlugZap, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import type { EventoOperativo, Paginado, ResumenContinuidad } from '@aquaplants/shared';
import { api, qs } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useConexion } from '../estado/conexion';
import { BarraSuperior } from '../componentes/Layout';
import { Aviso, Encabezado, Esqueleto, InsigniaConectividad, InsigniaSenal, InsigniaServidor, Kpi, MensajeError, Paginador, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { duracion, fechaHora, hace } from '../util/formato';

const NOMBRE_EVENTO: Record<string, string> = {
  sin_senal: 'Sin señal',
  reconexion: 'Reconexión',
  reinicio: 'Reinicio informado',
  reconexion_local: 'Red recuperada (informada)',
  datos_descartados: 'Datos descartados',
  intento_rechazado: 'Intento rechazado',
  reloj_desfasado: 'Reloj desfasado',
  baja: 'Baja',
  alta: 'Alta',
  credencial_regenerada: 'Credencial regenerada',
  cuarentena: 'Lote en cuarentena',
  sensor_ajeno: 'Sensor ajeno',
  plausibilidad: 'Cambio inusual',
  notificacion_fallida: 'Aviso no enviado',
  lote_rechazado: 'Lote rechazado',
};

/** Panel de continuidad operativa (prompt §20): conectividad ≠ estado del cultivo. */
export function Continuidad() {
  const conexion = useConexion();
  const r = useDatos<ResumenContinuidad>((s) => api.get('/continuidad', s), [], { cadaMs: 5000 });
  const [tipo, setTipo] = useState('');
  const [pagina, setPagina] = useState(1);
  const ev = useDatos<Paginado<EventoOperativo>>((s) => api.get(`/eventos${qs({ tipo, pagina, por_pagina: 15 })}`, s), [tipo, pagina], { cadaMs: 10_000 });
  const d = r.datos;
  return (
    <>
      <BarraSuperior actualizadoEn={r.actualizadoEn} desactualizado={r.desactualizado} />
      <Encabezado titulo="Continuidad operativa" descripcion="Comunicación de los dispositivos AquaBrain, recuperación de datos y eventos" />
      <div style={{ marginBottom: 16 }}>
        <Aviso titulo="Cómo leer este panel">
          «Sin señal» significa que el servidor no recibe comunicaciones dentro del plazo configurado (3 intervalos de muestreo). Por sí solo no permite saber si fue un corte de Internet, de energía o una falla del equipo:
          la causa se informa como desconocida salvo que el propio dispositivo informe un reinicio. Durante un corte eléctrico sin batería el equipo no mide, por lo que esos periodos quedan como huecos en el histórico.
        </Aviso>
      </div>
      <MensajeError error={d ? null : r.error} reintentar={r.refrescar} />
      {!d ? (
        <Esqueleto n={2} alto={150} />
      ) : (
        <>
          <div className="rejilla rejilla-kpi">
            <Kpi icono={PlugZap} etiqueta="Activos" valor={d.dispositivos.filter((x) => x.conectividad === 'conectado').length} />
            <Kpi icono={WifiOff} etiqueta="Sin señal" valor={d.dispositivos.filter((x) => x.conectividad === 'sin_senal').length} tono="fondo-sin-senal" />
            <Kpi icono={RefreshCw} etiqueta="Sincronizando" valor={d.dispositivos.filter((x) => x.conectividad === 'sincronizando').length} tono="fondo-info" />
            <Kpi icono={Database} etiqueta="Recuperado (24 h)" valor={d.lotes_recuperados_24h} pie={`${d.lecturas_recuperadas_24h} lecturas · ${d.lotes_duplicados_24h} reenvíos duplicados ignorados`} tono="fondo-info" />
          </div>

          <div className="seccion">
            <Tarjeta titulo="Dispositivos" descripcion="Última comunicación y tiempo sin reportar">
              <div className="tabla-contenedor">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th scope="col">Dispositivo</th>
                      <th scope="col">Torre</th>
                      <th scope="col">Conectividad</th>
                      <th scope="col">Señal</th>
                      <th scope="col">Última comunicación</th>
                      <th scope="col">Sin reportar</th>
                      <th scope="col">Plazo «sin señal»</th>
                      <th scope="col">Cola informada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.dispositivos.map((x) => (
                      <tr key={x.id_dispositivo}>
                        <td>
                          <strong>{x.nombre}</strong>
                        </td>
                        <td>{x.torre}</td>
                        <td>{conexion === 'servidor_caido' ? <InsigniaServidor /> : <InsigniaConectividad estado={x.conectividad} />}</td>
                        <td>
                          <InsigniaSenal calidad={x.calidad_enlace} rssi={x.rssi_dbm} />
                        </td>
                        <td className="dato">{fechaHora(x.ultima_comunicacion)}</td>
                        <td className="dato">{duracion(x.segundos_sin_reportar)}</td>
                        <td className="dato">{duracion(x.umbral_sin_senal_s)}</td>
                        <td className="dato">{x.pendientes_reportados ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Tarjeta>
          </div>

          <div className="rejilla rejilla-principal seccion">
            <Tarjeta
              titulo="Eventos operativos"
              acciones={
                <Selector etiqueta="Tipo" value={tipo} onChange={(e) => (setTipo(e.target.value), setPagina(1))}>
                  <option value="">Todos</option>
                  {Object.entries(NOMBRE_EVENTO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Selector>
              }
            >
              {ev.datos?.datos.length ? (
                <>
                  <ul className="lista-items">
                    {ev.datos.datos.map((e) => (
                      <li key={e.id_evento} className="item">
                        <div className="item-cuerpo">
                          <div className="item-titulo">
                            <span className={`insignia ${e.tipo === 'sin_senal' ? 'e-sin-senal' : e.tipo === 'datos_descartados' || e.tipo === 'intento_rechazado' ? 'e-advertencia' : 'e-neutro'}`}>
                              {NOMBRE_EVENTO[e.tipo] ?? e.tipo}
                            </span>
                            <span>
                              {e.dispositivo} · {e.torre}
                            </span>
                            <span className="muted pequeno">{e.origen === 'dispositivo' ? 'informado por el dispositivo' : 'detectado por el servidor'}</span>
                          </div>
                          <p className="pequeno" style={{ marginTop: 4 }}>
                            {e.descripcion}
                          </p>
                          <p className="muted pequeno">
                            {fechaHora(e.ts)} ({hace(e.ts)})
                            {e.detalle && 'segundos_sin_comunicacion' in e.detalle && e.detalle.segundos_sin_comunicacion != null && ` · silencio de ${duracion(Number(e.detalle.segundos_sin_comunicacion))}`}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Paginador pagina={pagina} total={ev.datos.total} porPagina={15} onCambio={setPagina} />
                </>
              ) : (
                <Vacio titulo="Sin eventos" />
              )}
            </Tarjeta>
            <Tarjeta titulo="Mediciones perdidas informadas" descripcion="Periodos que la cola local no pudo conservar">
              {d.descartes.length ? (
                <ul className="lista-items">
                  {d.descartes.map((x) => {
                    const det = (x.detalle ?? {}) as { desde?: string; hasta?: string; lotes?: number; lecturas?: number; motivo?: string };
                    return (
                      <li key={x.id_evento} className="item">
                        <Trash2 size={18} aria-hidden />
                        <div className="item-cuerpo">
                          <div className="item-titulo">
                            {x.dispositivo} · {det.lecturas ?? '?'} lecturas
                          </div>
                          <p className="pequeno">
                            {fechaHora(det.desde)} → {fechaHora(det.hasta)}
                          </p>
                          <p className="muted pequeno">{det.motivo}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Vacio titulo="Sin pérdidas informadas" icono={Database} />
              )}
            </Tarjeta>
          </div>
        </>
      )}
    </>
  );
}
