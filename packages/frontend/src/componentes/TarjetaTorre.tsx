import { Link } from 'react-router-dom';
import { Bell, ChartLine, Clock, Cpu, Sprout, TriangleAlert } from 'lucide-react';
import type { EstadoTorre } from '@aquaplants/shared';
import { InsigniaConectividad, InsigniaEstado, InsigniaSenal } from './ui';
import { duracion, fechaHora, hace, numero } from '../util/formato';

/** Tarjeta de estado por torre (CU-03): cultivo, variables, unidades, estados, umbrales y timestamps. */
export function TarjetaTorre({ torre, servidorCaido }: { torre: EstadoTorre; servidorCaido?: boolean }) {
  const desactualizado = torre.dispositivos.some((d) => d.datos_desactualizados) || servidorCaido;
  return (
    <article className="tarjeta vidrio torre" aria-labelledby={`torre-${torre.id_instalacion}`}>
      <div className="torre-cab">
        <div style={{ minWidth: 0 }}>
          <h3 id={`torre-${torre.id_instalacion}`}>{torre.nombre}</h3>
          <p className="muted pequeno" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Sprout size={14} aria-hidden />
            {torre.cultivo ? `${torre.cultivo.especie} desde ${torre.cultivo.fecha_inicio}` : 'Sin cultivo en curso'} · {torre.tipo === 'aeroponica' ? 'Aeropónica' : 'Hidropónica'}
          </p>
        </div>
        <InsigniaEstado estado={torre.estado_general} />
      </div>

      {torre.variables.length === 0 ? (
        <p className="muted">Sin sensores activos.</p>
      ) : (
        <div className="variables">
          {torre.variables.map((v) => {
            const adv = v.umbrales.find((u) => u.severidad === 'advertencia');
            const crit = v.umbrales.find((u) => u.severidad === 'critica');
            return (
              <div key={v.id_sensor} className={`variable v-${v.estado}`}>
                <div className="variable-nombre">
                  <span>{v.tipo_variable}</span>
                </div>
                <div className="variable-valor">
                  {numero(v.valor)}
                  <small>{v.unidad}</small>
                </div>
                <InsigniaEstado estado={v.estado} />
                <div className="variable-meta">
                  {adv ? (
                    <>
                      Rango {numero(adv.valor_min)}–{numero(adv.valor_max)}
                      {crit && ` · crít. <${numero(crit.valor_min)} >${numero(crit.valor_max)}`}
                    </>
                  ) : crit ? (
                    `Crítico <${numero(crit.valor_min)} >${numero(crit.valor_max)}`
                  ) : (
                    'Sin umbral configurado'
                  )}
                </div>
                <div className="variable-meta">
                  <time dateTime={v.ts ?? undefined}>{v.ts ? fechaHora(v.ts) : 'sin lecturas'}</time>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        {torre.dispositivos.map((d) => (
          <div key={d.id_dispositivo} className="dispositivo-linea">
            <Cpu size={14} aria-hidden />
            <strong>{d.nombre}</strong>
            <InsigniaConectividad estado={d.conectividad} />
            {d.conectividad !== 'nunca_conectado' && <InsigniaSenal calidad={d.calidad_enlace} rssi={d.rssi_dbm} />}
            <span className="muted">
              <Clock size={12} aria-hidden /> última comunicación {hace(d.ultima_comunicacion)}
            </span>
            {d.conectividad === 'sincronizando' && d.pendientes_reportados != null && <span className="muted">· {d.pendientes_reportados} lotes pendientes</span>}
          </div>
        ))}
      </div>

      {desactualizado && (
        <div className="aviso fondo-advertencia" role="status">
          <TriangleAlert size={16} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
          <p>
            <strong>Datos desactualizados.</strong>{' '}
            {servidorCaido
              ? 'No hay conexión con el servidor: se muestran los últimos valores recibidos.'
              : `Sin lecturas recientes${torre.dispositivos[0]?.segundos_sin_reportar != null ? ` (sin reportar hace ${duracion(torre.dispositivos[0].segundos_sin_reportar)})` : ''}. La causa no se puede determinar solo por la falta de datos.`}
          </p>
        </div>
      )}

      <div className="acciones" style={{ justifyContent: 'flex-start' }}>
        <Link className="boton boton-secundario boton-pequeno" to={`/historicos?torre=${torre.id_instalacion}`}>
          <ChartLine size={16} aria-hidden /> Históricos
        </Link>
        <Link className="boton boton-fantasma boton-pequeno" to={`/alertas?torre=${torre.id_instalacion}`}>
          <Bell size={16} aria-hidden /> {torre.alertas_activas} alertas activas
        </Link>
        <Link className="boton boton-fantasma boton-pequeno" to={`/torres/${torre.id_instalacion}`}>
          Ficha
        </Link>
      </div>
    </article>
  );
}
