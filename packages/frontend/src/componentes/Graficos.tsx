import { useMemo } from 'react';
import {
  ArcElement,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { es } from 'date-fns/locale';
import { Doughnut, Line } from 'react-chartjs-2';
import type { PuntoSerie, RespuestaComparar, RespuestaHistorico } from '@aquaplants/shared';

ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, Filler, Tooltip, Legend, ArcElement);
ChartJS.defaults.font.family = "'Fira Sans', system-ui, sans-serif";
ChartJS.defaults.color = '#334155';

const VERDE = '#15803d';
const ROJO = '#b91c1c';
const ORO = '#a16207';
const SERIES = ['#15803d', '#0369a1', '#a16207', '#7c3aed'];
const GUIONES = [[], [6, 4], [2, 3], [10, 3, 2, 3]];

/**
 * Corta la línea donde faltan mediciones (huecos informados por la API o saltos
 * mayores a 2,5 veces el paso típico): nunca se interpolan valores inexistentes.
 */
function conHuecos(puntos: PuntoSerie[], huecos: { desde: string; hasta: string }[]) {
  const out: { x: number; y: number | null; min?: number; max?: number; n?: number }[] = [];
  const ts = puntos.map((p) => new Date(p.t).getTime());
  const pasos = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const paso = pasos.length ? pasos[Math.floor(pasos.length / 2)] : 0;
  const hs = huecos.map((h) => [new Date(h.desde).getTime(), new Date(h.hasta).getTime()]);
  puntos.forEach((p, i) => {
    if (i > 0) {
      const a = ts[i - 1];
      const b = ts[i];
      const enHueco = hs.some(([d, h]) => d >= a && h <= b);
      if (enHueco || (paso > 0 && b - a > paso * 2.5)) out.push({ x: a + 1, y: null });
    }
    out.push({ x: ts[i], y: p.promedio, min: p.minimo, max: p.maximo, n: p.n });
  });
  return out;
}

const escalaTiempo = {
  type: 'time' as const,
  adapters: { date: { locale: es } },
  time: { tooltipFormat: 'dd MMM HH:mm:ss', displayFormats: { minute: 'HH:mm', hour: 'dd MMM HH:mm', day: 'dd MMM' } },
  grid: { color: 'rgba(20,83,45,0.06)' },
  ticks: { maxRotation: 0, autoSkipPadding: 16 },
};

/** CU-05: serie temporal con banda de umbral (advertencia) y límites críticos. */
export function GraficoHistorico({ datos }: { datos: RespuestaHistorico }) {
  const adv = datos.umbrales.find((u) => u.severidad === 'advertencia');
  const crit = datos.umbrales.find((u) => u.severidad === 'critica');
  const serie = useMemo(() => conHuecos(datos.puntos, datos.huecos), [datos]);
  const extremos = [new Date(datos.desde).getTime(), new Date(datos.hasta).getTime()];
  const linea = (y: number) => extremos.map((x) => ({ x, y }));

  const data: ChartData<'line', { x: number; y: number | null }[]> = {
    datasets: [
      {
        label: `${datos.sensor.tipo_variable} (${datos.sensor.unidad})${datos.granularidad !== 'crudo' ? ` · promedio ${datos.granularidad}` : ''}`,
        data: serie,
        borderColor: VERDE,
        backgroundColor: 'rgba(21,128,61,0.12)',
        borderWidth: 2,
        pointRadius: serie.length > 120 ? 0 : 2,
        tension: 0.25,
        spanGaps: false,
      },
      ...(adv
        ? [
            { label: 'Rango óptimo (máx.)', data: linea(adv.valor_max), borderColor: ORO, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: '+1', backgroundColor: 'rgba(21,128,61,0.08)' },
            { label: 'Rango óptimo (mín.)', data: linea(adv.valor_min), borderColor: ORO, borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
          ]
        : []),
      ...(crit
        ? [
            { label: 'Límite crítico (máx.)', data: linea(crit.valor_max), borderColor: ROJO, borderWidth: 1.5, borderDash: [8, 4], pointRadius: 0 },
            { label: 'Límite crítico (mín.)', data: linea(crit.valor_min), borderColor: ROJO, borderWidth: 1.5, borderDash: [8, 4], pointRadius: 0 },
          ]
        : []),
    ],
  };
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 250 },
    interaction: { mode: 'nearest', intersect: false, axis: 'x' },
    parsing: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (i) => i.datasetIndex === 0,
        callbacks: {
          label: (ctx) => {
            const p = ctx.raw as { y: number; min?: number; max?: number; n?: number };
            const base = `${p.y?.toFixed(2)} ${datos.sensor.unidad}`;
            return p.n && p.n > 1 ? `${base} (mín ${p.min?.toFixed(2)} · máx ${p.max?.toFixed(2)} · ${p.n} lecturas)` : base;
          },
        },
      },
    },
    scales: { x: { ...escalaTiempo, min: extremos[0], max: extremos[1] }, y: { grid: { color: 'rgba(20,83,45,0.06)' }, title: { display: true, text: datos.sensor.unidad } } },
  };
  return (
    <>
      <div className="grafico" role="img" aria-label={`Gráfico de ${datos.sensor.tipo_variable} en ${datos.sensor.torre}: ${datos.puntos.length} puntos entre ${new Date(datos.desde).toLocaleString('es-CL')} y ${new Date(datos.hasta).toLocaleString('es-CL')}`}>
        <Line data={data} options={options} />
      </div>
      <div className="leyenda-umbral">
        <span>
          <i className="muestra" style={{ background: VERDE }} /> Medición ({datos.granularidad})
        </span>
        {adv && (
          <span>
            <i className="muestra" style={{ background: 'rgba(21,128,61,0.15)', border: `1px dashed ${ORO}` }} /> Rango óptimo {adv.valor_min}–{adv.valor_max}
          </span>
        )}
        {crit && (
          <span>
            <i className="muestra" style={{ borderTop: `2px dashed ${ROJO}`, height: 0 }} /> Límites críticos {crit.valor_min} / {crit.valor_max}
          </span>
        )}
        {!adv && !crit && <span>Sensor sin umbral: el gráfico se muestra sin banda.</span>}
        {datos.huecos.length > 0 && <span>Cortes en la línea = periodos sin mediciones ({datos.huecos.length}); no se inventan valores.</span>}
      </div>
    </>
  );
}

/** CU-06: series superpuestas (color + patrón de línea + leyenda). */
export function GraficoComparar({ datos }: { datos: RespuestaComparar }) {
  const data: ChartData<'line', { x: number; y: number }[]> = {
    datasets: datos.series.map((s, i) => ({
      label: s.torre,
      data: s.puntos.map((p) => ({ x: new Date(p.t).getTime(), y: p.promedio })),
      borderColor: SERIES[i % 4],
      borderDash: GUIONES[i % 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
    })),
  };
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    parsing: false,
    interaction: { mode: 'nearest', intersect: false, axis: 'x' },
    plugins: { legend: { position: 'bottom', labels: { usePointStyle: false, boxWidth: 28 } } },
    scales: { x: escalaTiempo, y: { title: { display: true, text: datos.tipo_variable.unidad }, grid: { color: 'rgba(20,83,45,0.06)' } } },
  };
  return (
    <div className="grafico" role="img" aria-label={`Comparación de ${datos.tipo_variable.nombre} entre ${datos.series.map((s) => s.torre).join(', ')}`}>
      <Line data={data} options={options} />
    </div>
  );
}

/** Distribución de estados (equivalente monitoreo del donut de la referencia). */
export function DonutEstados({ conteo }: { conteo: { etiqueta: string; valor: number; color: string }[] }) {
  const total = conteo.reduce((a, c) => a + c.valor, 0);
  return (
    <div>
      <div style={{ position: 'relative', height: 200, width: 200, margin: '0 auto' }} role="img" aria-label={conteo.map((c) => `${c.etiqueta}: ${c.valor}`).join(', ')}>
        <Doughnut
          data={{ labels: conteo.map((c) => c.etiqueta), datasets: [{ data: conteo.map((c) => c.valor), backgroundColor: conteo.map((c) => c.color), borderWidth: 2, borderColor: '#fff' }] }}
          options={{ responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }}
        />
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          <div>
            <div className="kpi-valor">{total}</div>
            <div className="muted pequeno">variables</div>
          </div>
        </div>
      </div>
      <ul className="donut-leyenda">
        {conteo.map((c) => (
          <li key={c.etiqueta}>
            <i className="muestra" style={{ background: c.color }} />
            {c.etiqueta}
            <span className="dato">
              {c.valor} {total ? `(${Math.round((c.valor / total) * 100)} %)` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
