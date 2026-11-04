import { useEffect, useMemo, useState } from 'react';
import type { EstadoTorre, RespuestaHistorico } from '@aquaplants/shared';
import { api, qs, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { GraficoHistorico } from './Graficos';
import { Campo, Esqueleto, MensajeError, Segmentado, Selector, Vacio } from './ui';
import { ChartLine } from 'lucide-react';

export type Rango = '24h' | '7d' | '30d' | 'personalizado';
const HORAS: Record<Exclude<Rango, 'personalizado'>, number> = { '24h': 24, '7d': 168, '30d': 720 };

const aLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** CU-05: selector de torre, sensor/variable y rango (24 h, 7 d, 30 d o personalizado) con validación previa. */
export function PanelHistorico({ torres, torreInicial, sensorInicial, compacto }: { torres: EstadoTorre[]; torreInicial?: number; sensorInicial?: number; compacto?: boolean }) {
  const [idTorre, setTorre] = useState<number | undefined>(torreInicial ?? torres[0]?.id_instalacion);
  const torre = torres.find((t) => t.id_instalacion === idTorre) ?? torres[0];
  const [idSensor, setSensor] = useState<number | undefined>(sensorInicial);
  const [rango, setRango] = useState<Rango>('24h');
  const [desdeP, setDesdeP] = useState(aLocal(new Date(Date.now() - 48 * 3600_000)));
  const [hastaP, setHastaP] = useState(aLocal(new Date()));

  useEffect(() => {
    if (!torre) return;
    if (!torre.variables.some((v) => v.id_sensor === idSensor)) setSensor(torre.variables[0]?.id_sensor);
  }, [torre, idSensor]);

  const errorRango = useMemo(() => {
    if (rango !== 'personalizado') return null;
    const d = new Date(desdeP).getTime();
    const h = new Date(hastaP).getTime();
    if (!(d < h)) return 'La fecha de inicio debe ser anterior a la de término';
    if (h - d > 90 * 86400_000) return 'El rango no puede superar 90 días';
    return null;
  }, [rango, desdeP, hastaP]);

  const [ventana, setVentana] = useState(0);
  // Rango relativo: se recalcula en cada refresco (cada 60 s) para incluir lecturas nuevas.
  const { datos, error, cargando } = useDatos<RespuestaHistorico>(
    (s) => {
      const hasta = rango === 'personalizado' ? new Date(hastaP) : new Date();
      const desde = rango === 'personalizado' ? new Date(desdeP) : new Date(hasta.getTime() - HORAS[rango] * 3600_000);
      return api.get(`/mediciones/historico${qs({ sensor: idSensor, desde: desde.toISOString(), hasta: hasta.toISOString() })}`, s);
    },
    [idSensor, rango, desdeP, hastaP, ventana],
    { activo: !!idSensor && !errorRango, cadaMs: rango === 'personalizado' ? undefined : 60_000 },
  );

  if (!torres.length) return <Vacio titulo="No hay torres visibles para su usuario" />;
  return (
    <div>
      <div className="filtros" style={{ marginBottom: 12 }}>
        <Selector etiqueta="Torre" value={torre?.id_instalacion ?? ''} onChange={(e) => setTorre(Number(e.target.value))}>
          {torres.map((t) => (
            <option key={t.id_instalacion} value={t.id_instalacion}>
              {t.nombre}
            </option>
          ))}
        </Selector>
        <Selector etiqueta="Variable" value={idSensor ?? ''} onChange={(e) => setSensor(Number(e.target.value))}>
          {torre?.variables.map((v) => (
            <option key={v.id_sensor} value={v.id_sensor}>
              {v.tipo_variable} ({v.unidad})
            </option>
          ))}
        </Selector>
        <div className="campo" style={{ flex: '0 0 auto' }}>
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Rango</span>
          <Segmentado
            etiqueta="Rango de fechas"
            valor={rango}
            onCambio={(r) => {
              setRango(r);
              setVentana((v) => v + 1);
            }}
            opciones={[
              { valor: '24h', texto: '24 h' },
              { valor: '7d', texto: '7 días' },
              { valor: '30d', texto: '30 días' },
              ...(compacto ? [] : [{ valor: 'personalizado' as Rango, texto: 'Otro' }]),
            ]}
          />
        </div>
      </div>
      {rango === 'personalizado' && (
        <div className="filtros" style={{ marginBottom: 12 }}>
          <Campo etiqueta="Desde" type="datetime-local" value={desdeP} onChange={(e) => setDesdeP(e.target.value)} error={errorRango ?? undefined} />
          <Campo etiqueta="Hasta" type="datetime-local" value={hastaP} onChange={(e) => setHastaP(e.target.value)} />
        </div>
      )}
      {error && !datos && <MensajeError error={error as ApiError} />}
      {cargando && !datos ? (
        <Esqueleto alto={300} />
      ) : datos && datos.puntos.length === 0 ? (
        <Vacio titulo="No existen mediciones para el período" icono={ChartLine}>
          Pruebe con un rango mayor o revise la conectividad del dispositivo.
        </Vacio>
      ) : datos ? (
        <GraficoHistorico datos={datos} />
      ) : null}
    </div>
  );
}
