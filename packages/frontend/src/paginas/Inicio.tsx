import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Cpu, Database, Download, ServerCog, Sprout, Users, WifiOff } from 'lucide-react';
import type { Alerta, EstadoTorre, Paginado, ResumenContinuidad, RespuestaEstado } from '@aquaplants/shared';
import { api } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { useConexion } from '../estado/conexion';
import { BarraSuperior } from '../componentes/Layout';
import { TarjetaTorre } from '../componentes/TarjetaTorre';
import { PanelHistorico } from '../componentes/PanelHistorico';
import { ListaAlertas } from '../componentes/PanelAlertas';
import { DonutEstados } from '../componentes/Graficos';
import { Aviso, Encabezado, Esqueleto, Kpi, MensajeError, Segmentado, Tarjeta, Vacio } from '../componentes/ui';
import { fechaHora, fechaLarga, hace } from '../util/formato';

type Filtro = 'todas' | 'alertas' | 'sin_senal';

/**
 * Inicio por rol. Mismo sistema visual para los tres perfiles; cambian contenido y acciones.
 *  - Encargado: sus torres, KPIs, histórico, alertas de sus torres.
 *  - Supervisor: estado general, distribución de estados, alertas por gravedad, eventos.
 *  - Administrador: lo anterior + salud del sistema.
 */
export function Inicio() {
  const { usuario, puede } = useSesion();
  const conexion = useConexion();
  const estado = useDatos<RespuestaEstado>((s) => api.get('/torres/estado', s), [], { cadaMs: 5000 });
  const alertas = useDatos<Paginado<Alerta>>((s) => api.get('/alertas?estado=activa&por_pagina=6', s), [], { cadaMs: 10_000 });
  const continuidad = useDatos<ResumenContinuidad>((s) => api.get('/continuidad', s), [], { cadaMs: 15_000 });
  const esAdmin = usuario?.rol === 'administrador';
  const salud = useDatos<{ estado: string; componentes: Record<string, string>; timescaledb: boolean; outbox: { pendientes: number; cuarentena: number } }>(
    (s) => api.get('/health', s),
    [],
    { cadaMs: 30_000, activo: esAdmin },
  );
  const [filtro, setFiltro] = useState<Filtro>('todas');

  const torres = estado.datos?.torres ?? [];
  const dispositivos = torres.flatMap((t) => t.dispositivos);
  const conectados = dispositivos.filter((d) => d.conectividad === 'conectado' || d.conectividad === 'sincronizando').length;
  const sinSenal = dispositivos.filter((d) => d.conectividad === 'sin_senal');
  const sincronizando = dispositivos.filter((d) => d.conectividad === 'sincronizando');
  const totalAlertas = torres.reduce((a, t) => a + t.alertas_activas, 0);
  const servidorCaido = conexion !== 'en_linea' || estado.desactualizado;

  const visibles = useMemo(() => {
    const f = (t: EstadoTorre) =>
      filtro === 'todas' ? true : filtro === 'alertas' ? t.alertas_activas > 0 || t.estado_general === 'critico' || t.estado_general === 'advertencia' : t.dispositivos.some((d) => d.conectividad === 'sin_senal');
    return torres.filter(f);
  }, [torres, filtro]);

  const distribucion = useMemo(() => {
    const vars = torres.flatMap((t) => t.variables);
    return [
      { etiqueta: 'Normal', valor: vars.filter((v) => v.estado === 'normal').length, color: '#15803d' },
      { etiqueta: 'Advertencia', valor: vars.filter((v) => v.estado === 'advertencia').length, color: '#ca8a04' },
      { etiqueta: 'Crítico', valor: vars.filter((v) => v.estado === 'critico').length, color: '#b91c1c' },
      { etiqueta: 'Sin umbral / sin datos', valor: vars.filter((v) => v.estado === 'sin_clasificar' || v.estado === 'sin_datos').length, color: '#94a3b8' },
    ];
  }, [torres]);

  const titulo = usuario?.rol === 'encargado' ? 'Mis cultivos' : usuario?.rol === 'supervisor' ? 'Supervisión general' : 'Panel de administración';

  return (
    <>
      <BarraSuperior actualizadoEn={estado.actualizadoEn} desactualizado={servidorCaido} />
      <Encabezado
        titulo={titulo}
        descripcion={fechaLarga().replace(/^./, (c) => c.toUpperCase())}
        acciones={
          <>
            <Segmentado
              etiqueta="Filtrar torres"
              valor={filtro}
              onCambio={setFiltro}
              opciones={[
                { valor: 'todas', texto: 'Todas' },
                { valor: 'alertas', texto: 'Con alertas' },
                { valor: 'sin_senal', texto: 'Sin señal' },
              ]}
            />
            {puede('historicos.comparar_exportar') && (
              <Link to="/historicos?modo=comparar" className="boton boton-primario">
                <Download size={18} aria-hidden /> Comparar / Exportar
              </Link>
            )}
          </>
        }
      />

      {conexion === 'servidor_caido' && (
        <div style={{ marginBottom: 16 }}>
          <Aviso tono="fondo-critico" titulo="Sin conexión con el servidor">
            Se muestran los últimos datos recibidos ({estado.actualizadoEn ? estado.actualizadoEn.toLocaleTimeString('es-CL') : '—'}). El estado de las torres no se considera «sin señal» por esta causa.
          </Aviso>
        </div>
      )}
      {conexion === 'sin_internet' && (
        <div style={{ marginBottom: 16 }}>
          <Aviso tono="fondo-sin-senal" titulo="Este equipo no tiene Internet">
            Los datos visibles pueden estar desactualizados. Los dispositivos AquaBrain siguen guardando sus lecturas en su propia memoria local.
          </Aviso>
        </div>
      )}
      {estado.error && !estado.datos && <MensajeError error={estado.error} reintentar={estado.refrescar} />}

      {estado.cargando && !estado.datos ? (
        <Esqueleto n={2} alto={140} />
      ) : (
        <>
          <div className="rejilla rejilla-kpi">
            <Kpi icono={Sprout} etiqueta={usuario?.rol === 'encargado' ? 'Mis torres' : 'Torres'} valor={torres.length} pie={`${torres.filter((t) => t.cultivo).length} con cultivo en curso`} />
            <Kpi icono={Cpu} etiqueta="Dispositivos conectados" valor={`${conectados}/${dispositivos.length}`} pie={sincronizando.length ? `${sincronizando.length} sincronizando` : 'Comunicación al día'} tono="fondo-info" />
            <Kpi
              icono={WifiOff}
              etiqueta="Sin señal"
              valor={sinSenal.length}
              tono={sinSenal.length ? 'fondo-sin-senal' : 'fondo-normal'}
              pie={sinSenal.length ? `Desde ${hace(sinSenal[0].ultima_comunicacion)} · causa no determinada` : 'Todos reportando'}
            />
            <Kpi icono={Bell} etiqueta="Alertas activas" valor={totalAlertas} tono={totalAlertas ? 'fondo-critico' : 'fondo-normal'} pie={<Link to="/alertas">Ver panel de alertas</Link>} />
          </div>

          <div className="rejilla rejilla-principal seccion">
            <Tarjeta titulo="Histórico" descripcion="Evolución de una variable con su banda de umbral">
              {torres.length ? <PanelHistorico torres={torres} compacto /> : <Vacio titulo="Sin torres asignadas" />}
            </Tarjeta>
            <div className="rejilla" style={{ alignContent: 'start' }}>
              {usuario?.rol !== 'encargado' && (
                <Tarjeta titulo="Estado de las variables" descripcion="Clasificación según umbrales vigentes">
                  <DonutEstados conteo={distribucion} />
                </Tarjeta>
              )}
              <Tarjeta
                titulo="Alertas activas"
                descripcion={usuario?.rol === 'encargado' ? 'De sus torres asignadas' : 'Ordenadas por gravedad'}
                acciones={
                  <Link to="/alertas" className="boton boton-fantasma boton-pequeno">
                    Ver todas
                  </Link>
                }
              >
                {alertas.datos ? <ListaAlertas alertas={alertas.datos.datos} alResolver={() => void Promise.all([alertas.refrescar(), estado.refrescar()])} compacta /> : <Esqueleto alto={80} n={2} />}
              </Tarjeta>
            </div>
          </div>

          {(sincronizando.length > 0 || (continuidad.datos && continuidad.datos.lotes_recuperados_24h > 0) || sinSenal.length > 0) && (
            <div className="seccion">
              <Tarjeta
                titulo="Continuidad operativa"
                descripcion="Conectividad de los AquaBrain (independiente del estado del cultivo)"
                acciones={
                  <Link to="/continuidad" className="boton boton-fantasma boton-pequeno">
                    Detalle
                  </Link>
                }
              >
                <div className="rejilla rejilla-kpi">
                  <Kpi icono={WifiOff} etiqueta="Sin señal ahora" valor={sinSenal.length} tono="fondo-sin-senal" />
                  <Kpi icono={Cpu} etiqueta="Sincronizando" valor={sincronizando.length} tono="fondo-info" />
                  <Kpi icono={Database} etiqueta="Lotes recuperados (24 h)" valor={continuidad.datos?.lotes_recuperados_24h ?? '—'} pie={`${continuidad.datos?.lecturas_recuperadas_24h ?? 0} lecturas`} tono="fondo-info" />
                  <Kpi
                    icono={Database}
                    etiqueta="Lecturas perdidas informadas"
                    valor={continuidad.datos?.descartes.reduce((a, d) => a + Number((d.detalle as { lecturas?: number })?.lecturas ?? 0), 0) ?? '—'}
                    tono="fondo-advertencia"
                  />
                </div>
              </Tarjeta>
            </div>
          )}

          {esAdmin && salud.datos && (
            <div className="seccion">
              <Tarjeta titulo="Salud del sistema" descripcion={`Consultado ${salud.actualizadoEn?.toLocaleTimeString('es-CL') ?? ''}`}>
                <div className="rejilla rejilla-kpi">
                  {Object.entries(salud.datos.componentes).map(([k, v]) => (
                    <Kpi key={k} icono={ServerCog} etiqueta={k === 'api' ? 'API' : k === 'postgresql' ? 'PostgreSQL' : 'MongoDB'} valor={v === 'ok' ? 'Operativo' : 'Caído'} tono={v === 'ok' ? 'fondo-normal' : 'fondo-critico'} />
                  ))}
                  <Kpi icono={Users} etiqueta="Motor de alertas" valor={`${salud.datos.outbox?.pendientes ?? 0} pendientes`} pie={`${salud.datos.outbox?.cuarentena ?? 0} en cuarentena · TimescaleDB ${salud.datos.timescaledb ? 'activo' : 'no disponible'}`} tono="fondo-info" />
                </div>
              </Tarjeta>
            </div>
          )}

          <section className="seccion" aria-labelledby="titulo-torres">
            <div className="tarjeta-cab">
              <h2 id="titulo-torres">{usuario?.rol === 'encargado' ? 'Mis torres' : 'Torres'}</h2>
              <span className="muted pequeno">Actualización automática cada 5 s · última {fechaHora(estado.datos?.generado_en)}</span>
            </div>
            {visibles.length === 0 ? (
              <Tarjeta etiqueta="Sin resultados">
                <Vacio titulo={torres.length ? 'Ninguna torre coincide con el filtro' : 'No tiene torres asignadas'}>
                  {torres.length ? 'Cambie el filtro para ver todas.' : 'Solicite al Administrador la asignación de torres.'}
                </Vacio>
              </Tarjeta>
            ) : (
              <div className="rejilla rejilla-torres">
                {visibles.map((t) => (
                  <TarjetaTorre key={t.id_instalacion} torre={t} servidorCaido={servidorCaido} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
