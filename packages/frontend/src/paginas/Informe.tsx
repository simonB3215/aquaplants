import { useEffect, useState, type FormEvent } from 'react';
import { Bell, Building2, Cpu, Download, FileText, Printer, Radio, Sprout, Wrench } from 'lucide-react';
import { api, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { BarraSuperior } from '../componentes/Layout';
import { Boton, Campo, Encabezado, Esqueleto, Kpi, MensajeError, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { GraficoConteoDiario } from '../componentes/Graficos';
import { descargarBlob, fechaHora, hoyISO } from '../util/formato';

export interface InformeGestion {
  generado_en: string;
  periodo: { desde: string; hasta: string };
  cliente: string | null;
  inventario: { clientes: number; torres: number; dispositivos: number; dispositivos_sin_senal: number; sensores: number; cultivos_en_curso: number; usuarios: number };
  telemetria: { lecturas: number; sensores_con_datos: number };
  alertas: { total: number; criticas: number; advertencias: number; resueltas: number; activas: number; horas_resolucion: number | null; pct_resueltas: number | null };
  incidencias: { total: number; cerradas: number; abiertas: number; horas_cierre: number | null; pct_cerradas: number | null };
  cultivos: { iniciados: number; finalizados: number; por_especie: { especie: string; en_curso: number; iniciados: number; finalizados: number }[] };
  por_torre: {
    id_instalacion: number;
    torre: string;
    cliente: string;
    estado: string;
    cultivo: string | null;
    lecturas: number;
    alertas: number;
    criticas: number;
    incidencias: number;
    ultima_comunicacion: string | null;
  }[];
  por_dia: { dia: string; alertas: number; incidencias: number }[];
  auditoria: { accion: string; total: number }[] | null;
}

const entero = (n: number) => n.toLocaleString('es-CL');
const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
const restarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
};
const horas = (h: number | null) => (h === null ? '—' : h < 48 ? `${h.toLocaleString('es-CL')} h` : `${(h / 24).toLocaleString('es-CL', { maximumFractionDigits: 1 })} días`);

const PERIODOS = [
  { dias: 7, texto: '7 días' },
  { dias: 30, texto: '30 días' },
  { dias: 90, texto: '90 días' },
];

/** Separador «;» y BOM para que Excel en español abra el archivo con tildes y columnas correctas. */
function aCsv(inf: InformeGestion) {
  const celda = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const filas: unknown[][] = [
    ['Informe de gestión AquaPlants'],
    ['Periodo', inf.periodo.desde, inf.periodo.hasta],
    ['Cliente', inf.cliente ?? 'Todos'],
    ['Generado', fechaHora(inf.generado_en)],
    [],
    ['Indicador', 'Valor'],
    ['Torres activas', inf.inventario.torres],
    ['Dispositivos', inf.inventario.dispositivos],
    ['Dispositivos sin señal', inf.inventario.dispositivos_sin_senal],
    ['Sensores activos', inf.inventario.sensores],
    ['Lecturas recibidas', inf.telemetria.lecturas],
    ['Alertas', inf.alertas.total],
    ['Alertas críticas', inf.alertas.criticas],
    ['Alertas resueltas (%)', inf.alertas.pct_resueltas ?? ''],
    ['Tiempo medio de resolución (h)', inf.alertas.horas_resolucion ?? ''],
    ['Incidencias', inf.incidencias.total],
    ['Incidencias cerradas (%)', inf.incidencias.pct_cerradas ?? ''],
    ['Tiempo medio de cierre (h)', inf.incidencias.horas_cierre ?? ''],
    ['Cultivos en curso', inf.inventario.cultivos_en_curso],
    ['Cultivos iniciados', inf.cultivos.iniciados],
    ['Cultivos finalizados', inf.cultivos.finalizados],
    [],
    ['Torre', 'Cliente', 'Estado', 'Cultivo', 'Lecturas', 'Alertas', 'Críticas', 'Incidencias', 'Última comunicación'],
    ...inf.por_torre.map((t) => [t.torre, t.cliente, t.estado, t.cultivo ?? '', t.lecturas, t.alertas, t.criticas, t.incidencias, fechaHora(t.ultima_comunicacion)]),
    [],
    ['Día', 'Alertas', 'Incidencias'],
    ...inf.por_dia.map((d) => [d.dia, d.alertas, d.incidencias]),
  ];
  return '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
}

/**
 * Informe de gestión (Evaluación 3): se genera en el momento desde la base de datos en la
 * nube para el periodo elegido. Se ve en pantalla, se imprime o guarda como PDF (estilos de
 * impresión) y se descarga en CSV. El Supervisor lo ve solo de su cliente (backend).
 */
export function Informe() {
  const { usuario, puede } = useSesion();
  const esAdmin = puede('clientes.gestionar', 'leer');
  const clientes = useDatos<{ id_cliente: number; nombre: string; estado: string }[]>((s) => api.get('/clientes', s), [], { activo: esAdmin });
  const hoy = hoyISO();
  const [desde, setDesde] = useState(restarDias(hoy, 29));
  const [hasta, setHasta] = useState(hoy);
  const [cliente, setCliente] = useState('');
  const [informe, setInforme] = useState<InformeGestion | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);

  async function generar(e?: FormEvent, d = desde, h = hasta) {
    e?.preventDefault();
    const err: Record<string, string> = {};
    if (!d) err.desde = 'Ingrese una fecha';
    if (!h) err.hasta = 'Ingrese una fecha';
    else if (h > hoy) err.hasta = 'No puede ser futura';
    if (d && h && d > h) err.hasta = 'Debe ser igual o posterior a «Desde»';
    setErrores(err);
    if (Object.keys(err).length) return;
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ desde: d, hasta: h });
      if (cliente) qs.set('cliente', cliente);
      setInforme(await api.get<InformeGestion>(`/informes/gestion?${qs}`));
    } catch (x) {
      const a = x as ApiError;
      setError({ message: a.campo('desde') ?? a.campo('hasta') ?? a.message });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void generar();
    // Solo al entrar: genera el informe de los últimos 30 días.
  }, []);

  function periodo(dias: number) {
    const d = restarDias(hoy, dias - 1);
    setDesde(d);
    setHasta(hoy);
    void generar(undefined, d, hoy);
  }

  const inf = informe;
  return (
    <>
      <BarraSuperior />
      <Encabezado
        titulo="Informe de gestión"
        descripcion="Resumen operativo del periodo, calculado en el momento desde la base de datos en la nube."
        acciones={
          inf && (
            <div className="acciones no-imprimir">
              <Boton icono={Download} onClick={() => descargarBlob(new Blob([aCsv(inf)], { type: 'text/csv;charset=utf-8' }), `informe-gestion-${inf.periodo.desde}-a-${inf.periodo.hasta}.csv`)}>
                CSV
              </Boton>
              <Boton variante="primario" icono={Printer} onClick={() => window.print()}>
                Imprimir o PDF
              </Boton>
            </div>
          )
        }
      />

      <Tarjeta className="no-imprimir" etiqueta="Periodo del informe">
        <form className="filtros" onSubmit={generar} noValidate style={{ alignItems: 'flex-end' }}>
          <Campo etiqueta="Desde" type="date" max={hoy} value={desde} onChange={(e) => setDesde(e.target.value)} error={errores.desde} />
          <Campo etiqueta="Hasta" type="date" max={hoy} value={hasta} onChange={(e) => setHasta(e.target.value)} error={errores.hasta} />
          {esAdmin && (
            <Selector etiqueta="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)}>
              <option value="">Todos</option>
              {clientes.datos?.map((c) => (
                <option key={c.id_cliente} value={c.id_cliente}>
                  {c.nombre}
                  {c.estado === 'baja' ? ' (de baja)' : ''}
                </option>
              ))}
            </Selector>
          )}
          <Boton type="submit" variante="primario" icono={FileText} cargando={cargando}>
            Generar informe
          </Boton>
          <div className="segmentado" role="group" aria-label="Periodos rápidos">
            {PERIODOS.map((p) => (
              <button key={p.dias} type="button" onClick={() => periodo(p.dias)} aria-pressed={desde === restarDias(hoy, p.dias - 1) && hasta === hoy}>
                {p.texto}
              </button>
            ))}
          </div>
        </form>
      </Tarjeta>

      <MensajeError error={error} reintentar={() => void generar()} />

      {!inf ? (
        cargando ? <Esqueleto n={3} alto={120} /> : !error && <Vacio titulo="Sin informe" icono={FileText} />
      ) : (
        <div className="informe" aria-busy={cargando}>
          <header className="informe-cabecera">
            <h2>Informe de gestión · AquaPlants</h2>
            <p>
              <strong>Periodo:</strong> {fechaCorta(inf.periodo.desde)} al {fechaCorta(inf.periodo.hasta)} · <strong>Cliente:</strong> {inf.cliente ?? 'Todos'}
            </p>
            <p className="muted pequeno">
              Generado el {fechaHora(inf.generado_en)} por {usuario?.nombre ?? '—'} · Fuente: base de datos PostgreSQL en la nube (Supabase)
            </p>
          </header>

          <section aria-labelledby="inf-resumen">
            <h3 id="inf-resumen">1. Resumen del periodo</h3>
            <div className="rejilla rejilla-kpi informe-kpi">
              <Kpi icono={Building2} etiqueta="Torres activas" valor={inf.inventario.torres} pie={`${inf.inventario.clientes} cliente(s) · ${inf.inventario.usuarios} usuarios activos`} />
              <Kpi
                icono={Cpu}
                etiqueta="Dispositivos"
                valor={inf.inventario.dispositivos}
                tono={inf.inventario.dispositivos_sin_senal ? 'fondo-sin-senal' : 'fondo-normal'}
                pie={`${inf.inventario.dispositivos_sin_senal} sin señal ahora · ${inf.inventario.sensores} sensores`}
              />
              <Kpi icono={Radio} etiqueta="Lecturas recibidas" valor={entero(inf.telemetria.lecturas)} tono="fondo-info" pie={`${inf.telemetria.sensores_con_datos} de ${inf.inventario.sensores} sensores con datos`} />
              <Kpi
                icono={Bell}
                etiqueta="Alertas"
                valor={inf.alertas.total}
                tono={inf.alertas.activas ? 'fondo-critico' : 'fondo-normal'}
                pie={`${inf.alertas.criticas} críticas · ${inf.alertas.pct_resueltas ?? '—'} % resueltas · ${horas(inf.alertas.horas_resolucion)} prom.`}
              />
              <Kpi
                icono={Wrench}
                etiqueta="Incidencias de equipos"
                valor={inf.incidencias.total}
                tono={inf.incidencias.abiertas ? 'fondo-sin-senal' : 'fondo-normal'}
                pie={`${inf.incidencias.abiertas} abiertas · ${inf.incidencias.pct_cerradas ?? '—'} % cerradas · ${horas(inf.incidencias.horas_cierre)} prom.`}
              />
              <Kpi icono={Sprout} etiqueta="Cultivos en curso" valor={inf.inventario.cultivos_en_curso} pie={`${inf.cultivos.iniciados} iniciados · ${inf.cultivos.finalizados} finalizados en el periodo`} />
            </div>
          </section>

          <Tarjeta titulo="2. Alertas e incidencias por día" descripcion="Cantidad generada cada día del periodo">
            <GraficoConteoDiario
              dias={inf.por_dia.map((d) => d.dia)}
              series={[
                { etiqueta: 'Alertas de cultivo', valores: inf.por_dia.map((d) => d.alertas) },
                { etiqueta: 'Incidencias de equipos', valores: inf.por_dia.map((d) => d.incidencias) },
              ]}
            />
            <details className="no-imprimir" style={{ marginTop: 8 }}>
              <summary className="pequeno">Ver los datos en tabla</summary>
              <div className="tabla-contenedor">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th scope="col">Día</th>
                      <th scope="col">Alertas</th>
                      <th scope="col">Incidencias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inf.por_dia.map((d) => (
                      <tr key={d.dia}>
                        <td className="dato">{d.dia}</td>
                        <td className="dato">{d.alertas}</td>
                        <td className="dato">{d.incidencias}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Tarjeta>

          <Tarjeta titulo="3. Detalle por torre">
            {!inf.por_torre.length ? (
              <Vacio titulo="Sin torres en el alcance" icono={Sprout} />
            ) : (
              <div className="tabla-contenedor">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th scope="col">Torre</th>
                      <th scope="col">Cultivo</th>
                      <th scope="col">Lecturas</th>
                      <th scope="col">Alertas (críticas)</th>
                      <th scope="col">Incidencias</th>
                      <th scope="col">Última comunicación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inf.por_torre.map((t) => (
                      <tr key={t.id_instalacion}>
                        <td>
                          <strong>{t.torre}</strong>
                          <div className="muted pequeno">
                            {t.cliente}
                            {t.estado === 'baja' ? ' · de baja' : ''}
                          </div>
                        </td>
                        <td>{t.cultivo ?? <span className="muted">Sin cultivo</span>}</td>
                        <td className="dato">{entero(t.lecturas)}</td>
                        <td className="dato">
                          {t.alertas} ({t.criticas})
                        </td>
                        <td className="dato">{t.incidencias}</td>
                        <td className="pequeno">{fechaHora(t.ultima_comunicacion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>

          <div className="rejilla informe-dos">
            <Tarjeta titulo="4. Cultivos" descripcion={`${inf.cultivos.iniciados} iniciados y ${inf.cultivos.finalizados} finalizados en el periodo`}>
              {!inf.cultivos.por_especie.length ? (
                <Vacio titulo="Sin cultivos en el periodo" icono={Sprout} />
              ) : (
                <table className="tabla">
                  <thead>
                    <tr>
                      <th scope="col">Especie</th>
                      <th scope="col">En curso</th>
                      <th scope="col">Iniciados</th>
                      <th scope="col">Finalizados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inf.cultivos.por_especie.map((e) => (
                      <tr key={e.especie}>
                        <td>{e.especie}</td>
                        <td className="dato">{e.en_curso}</td>
                        <td className="dato">{e.iniciados}</td>
                        <td className="dato">{e.finalizados}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Tarjeta>
            {inf.auditoria && (
              <Tarjeta titulo="5. Actividad de usuarios" descripcion="Acciones más frecuentes registradas en Auditoría">
                {!inf.auditoria.length ? (
                  <Vacio titulo="Sin actividad en el periodo" />
                ) : (
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th scope="col">Acción</th>
                        <th scope="col">Veces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inf.auditoria.map((a) => (
                        <tr key={a.accion}>
                          <td>{a.accion.replace(/_/g, ' ')}</td>
                          <td className="dato">{a.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Tarjeta>
            )}
          </div>
        </div>
      )}
    </>
  );
}
