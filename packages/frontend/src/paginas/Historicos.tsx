import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, GitCompare } from 'lucide-react';
import type { RespuestaComparar, RespuestaEstado } from '@aquaplants/shared';
import { api, qs, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { useAvisos } from '../estado/avisos';
import { BarraSuperior } from '../componentes/Layout';
import { PanelHistorico } from '../componentes/PanelHistorico';
import { GraficoComparar } from '../componentes/Graficos';
import { Aviso, Boton, Campo, Encabezado, Esqueleto, MensajeError, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { descargarBlob } from '../util/formato';

const aLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function Historicos() {
  const [params] = useSearchParams();
  const { puede } = useSesion();
  const estado = useDatos<RespuestaEstado>((s) => api.get('/torres/estado', s), []);
  const torres = estado.datos?.torres ?? [];
  const torreInicial = params.get('torre') ? Number(params.get('torre')) : undefined;
  return (
    <>
      <BarraSuperior />
      <Encabezado titulo="Históricos" descripcion="Evolución de las variables con la banda de umbral configurada (CU-05)" />
      <MensajeError error={estado.error} />
      {estado.cargando && !estado.datos ? (
        <Esqueleto alto={360} />
      ) : (
        <Tarjeta titulo="Serie temporal">
          <PanelHistorico torres={torres} torreInicial={torreInicial} key={torreInicial ?? 'x'} />
        </Tarjeta>
      )}
      {puede('historicos.comparar_exportar') && torres.length > 0 && (
        <div className="seccion">
          <CompararExportar torres={torres.map((t) => ({ id: t.id_instalacion, nombre: t.nombre }))} />
        </div>
      )}
    </>
  );
}

/** CU-06 (Supervisor y Administrador): comparar hasta 4 torres y exportar CSV auditado. */
function CompararExportar({ torres }: { torres: { id: number; nombre: string }[] }) {
  const avisar = useAvisos();
  const catalogos = useDatos<{ tipos_variable: { id_tipo_variable: number; nombre: string; unidad: string }[] }>((s) => api.get('/catalogos', s), []);
  const [tipo, setTipo] = useState(1);
  const [sel, setSel] = useState<number[]>(torres.slice(0, 2).map((t) => t.id));
  const [desde, setDesde] = useState(aLocal(new Date(Date.now() - 24 * 3600_000)));
  const [hasta, setHasta] = useState(aLocal(new Date()));
  const [consulta, setConsulta] = useState(0);
  const [exportando, setExportando] = useState(false);

  const errorRango = useMemo(() => {
    const d = new Date(desde).getTime();
    const h = new Date(hasta).getTime();
    if (!(d < h)) return 'La fecha de inicio debe ser anterior a la de término';
    if (h - d > 90 * 86400_000) return 'Para comparar, el rango no puede superar 90 días';
    return null;
  }, [desde, hasta]);
  const errorTorres = sel.length === 0 ? 'Seleccione al menos una torre' : sel.length > 4 ? 'Máximo 4 torres' : null;

  const comp = useDatos<RespuestaComparar>(
    (s) => api.get(`/mediciones/comparar${qs({ tipo_variable: tipo, torres: sel.join(','), desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() })}`, s),
    [consulta],
    { activo: consulta > 0 && !errorRango && !errorTorres },
  );

  async function exportar() {
    setExportando(true);
    try {
      const { blob, nombre } = await api.descargar(
        `/historicos/export${qs({ torres: sel.join(','), tipo_variable: tipo, desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() })}`,
      );
      descargarBlob(blob, nombre);
      avisar('Exportación generada y registrada en la auditoría');
    } catch (e) {
      avisar(`No se pudo exportar: ${(e as ApiError).message}`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <Tarjeta titulo="Comparar torres y exportar" descripcion="Misma variable y misma granularidad para todas las series · CSV UTF-8 separado por «;»">
      <div className="filtros">
        <Selector etiqueta="Variable" value={tipo} onChange={(e) => setTipo(Number(e.target.value))}>
          {catalogos.datos?.tipos_variable.map((t) => (
            <option key={t.id_tipo_variable} value={t.id_tipo_variable}>
              {t.nombre} ({t.unidad})
            </option>
          ))}
        </Selector>
        <Campo etiqueta="Desde" type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} error={errorRango ?? undefined} />
        <Campo etiqueta="Hasta" type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '12px 0' }}>
        <legend style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 6 }}>Torres (máximo 4)</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {torres.map((t) => (
            <label key={t.id} className="insignia e-neutro" style={{ cursor: 'pointer', minHeight: 36 }}>
              <input type="checkbox" checked={sel.includes(t.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} /> {t.nombre}
            </label>
          ))}
        </div>
        {errorTorres && <span className="campo-error">{errorTorres}</span>}
      </fieldset>
      <div className="acciones" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
        <Boton variante="verde" icono={GitCompare} disabled={!!errorRango || !!errorTorres} onClick={() => setConsulta((c) => c + 1)}>
          Comparar
        </Boton>
        <Boton variante="primario" icono={Download} disabled={!!errorTorres || !(new Date(desde) < new Date(hasta))} cargando={exportando} onClick={() => void exportar()}>
          Exportar CSV
        </Boton>
      </div>
      {comp.error && <MensajeError error={comp.error} />}
      {comp.cargando && consulta > 0 && !comp.datos ? (
        <Esqueleto alto={300} />
      ) : comp.datos ? (
        <>
          {comp.datos.sin_datos.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Aviso tono="fondo-advertencia">Sin datos en el período: {comp.datos.sin_datos.map((s) => s.torre).join(', ')}. Se grafican solo las torres con datos.</Aviso>
            </div>
          )}
          {comp.datos.series.length ? <GraficoComparar datos={comp.datos} /> : <Vacio titulo="No existen mediciones para el período" />}
          <p className="muted pequeno" style={{ marginTop: 6 }}>
            Granularidad: {comp.datos.granularidad}
          </p>
        </>
      ) : null}
    </Tarjeta>
  );
}
