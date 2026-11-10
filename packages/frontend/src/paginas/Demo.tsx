import { useState } from 'react';
import { FlaskConical, Play } from 'lucide-react';
import { api, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useAvisos } from '../estado/avisos';
import { BarraSuperior } from '../componentes/Layout';
import { Aviso, Boton, Encabezado, Esqueleto, Selector, Tarjeta } from '../componentes/ui';
import { fechaHora } from '../util/formato';

interface EstadoSim {
  id_dispositivo: number;
  nombre: string;
  torre: string;
  energia: boolean;
  red: boolean;
  intervalo_s: number;
  cola_lotes: number;
  cola_bytes: number;
  capacidad_bytes: number;
  eventos_pendientes: number;
  rechazados: number;
  enviados_ok: number;
  duplicados: number;
  ultimo_envio_ok: string | null;
  ultimo_error: string | null;
  proximo_reintento: string | null;
}
interface EstadoDemo {
  escenarios: Record<string, string>;
  simulador_disponible: boolean;
  simulador: { dispositivos: EstadoSim[] } | null;
}

/**
 * Modo demostración académico (solo con DEMO_MODE=true, nunca en producción).
 * Cada botón ejecuta un escenario REAL del simulador o de la API; no cambia textos.
 */
export function Demo() {
  const avisar = useAvisos();
  const r = useDatos<EstadoDemo>((s) => api.get('/demo/estado', s), [], { cadaMs: 2000 });
  const [disp, setDisp] = useState<number | ''>('');
  const [resultado, setResultado] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const dispositivos = r.datos?.simulador?.dispositivos ?? [];

  async function ejecutar(codigo: string) {
    setOcupado(codigo);
    try {
      const out = await api.post(`/demo/escenarios/${codigo}`, { id_dispositivo: disp || dispositivos[0]?.id_dispositivo });
      setResultado(out);
      avisar(`Escenario ${codigo} ejecutado`);
      void r.refrescar();
    } catch (e) {
      setResultado({ error: (e as ApiError).message });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <BarraSuperior />
      <Encabezado titulo="Modo demostración" descripcion="Escenarios reproducibles sobre el simulador AquaBrain real (aislado de producción)" />
      {r.error?.status === 404 && <Aviso tono="fondo-advertencia" titulo="El modo demostración está desactivado (DEMO_MODE=false)" />}
      {!r.datos ? (
        <Esqueleto alto={200} />
      ) : (
        <>
          {!r.datos.simulador_disponible && (
            <div style={{ marginBottom: 12 }}>
              <Aviso tono="fondo-critico" titulo="Simulador no disponible">
                Inicie el simulador con <code>npm run sim</code> (lo abre <code>iniciar-nube.ps1</code>).
              </Aviso>
            </div>
          )}
          <div className="rejilla rejilla-principal">
            <Tarjeta titulo="Escenarios" descripcion="A–F actúan sobre el dispositivo seleccionado; G hace una petición real como Encargado.">
              <div style={{ marginBottom: 12, maxWidth: 360 }}>
                <Selector etiqueta="Dispositivo" value={disp} onChange={(e) => setDisp(e.target.value ? Number(e.target.value) : '')}>
                  {dispositivos.map((d) => (
                    <option key={d.id_dispositivo} value={d.id_dispositivo}>
                      {d.nombre} · {d.torre}
                    </option>
                  ))}
                </Selector>
              </div>
              <ul className="lista-items">
                {Object.entries(r.datos.escenarios).map(([k, v]) => (
                  <li key={k} className="item" style={{ alignItems: 'center' }}>
                    <span className="chip-icono fondo-info dato" aria-hidden>
                      {k}
                    </span>
                    <div className="item-cuerpo">{v}</div>
                    <Boton pequeno variante="verde" icono={Play} cargando={ocupado === k} disabled={!!ocupado || (k !== 'G' && !r.datos!.simulador_disponible)} onClick={() => void ejecutar(k)}>
                      Ejecutar
                    </Boton>
                  </li>
                ))}
              </ul>
              {resultado != null && (
                <div style={{ marginTop: 12 }}>
                  {typeof (resultado as { correo?: unknown }).correo === 'string' && (
                    <div style={{ marginBottom: 8 }}>
                      <Aviso
                        tono={(resultado as { alerta_activa_previa?: number | null }).alerta_activa_previa ? 'fondo-advertencia' : 'fondo-normal'}
                        titulo={(resultado as { correo: string }).correo}
                      />
                    </div>
                  )}
                  <strong className="pequeno">Resultado</strong>
                  <pre className="credencial-unica" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>
                    {JSON.stringify(resultado, null, 2)}
                  </pre>
                </div>
              )}
            </Tarjeta>
            <Tarjeta titulo="Simulador en vivo" descripcion="Estado real de cada AquaBrain virtual">
              <ul className="lista-items">
                {dispositivos.map((d) => (
                  <li key={d.id_dispositivo} className="item" style={{ flexDirection: 'column' }}>
                    <div className="item-titulo">
                      <FlaskConical size={16} aria-hidden /> {d.nombre}
                      <span className={`insignia ${d.energia ? 'e-normal' : 'e-critico'}`}>{d.energia ? 'Con energía' : 'Sin energía'}</span>
                      <span className={`insignia ${d.red ? 'e-normal' : 'e-sin-senal'}`}>{d.red ? 'Con red' : 'Sin red'}</span>
                    </div>
                    <div className="pequeno" style={{ width: '100%' }}>
                      Cola local: <span className="dato">{d.cola_lotes}</span> lotes · {(d.cola_bytes / 1024).toFixed(1)} / {(d.capacidad_bytes / 1024).toFixed(0)} KB
                      <div className="barra-progreso" style={{ marginTop: 4 }} aria-hidden>
                        <span style={{ width: `${Math.min(100, (d.cola_bytes / d.capacidad_bytes) * 100)}%` }} />
                      </div>
                    </div>
                    <p className="muted pequeno">
                      Enviados {d.enviados_ok} · duplicados confirmados {d.duplicados} · rechazados {d.rechazados} · último envío {fechaHora(d.ultimo_envio_ok)}
                      {d.ultimo_error && ` · último error: ${d.ultimo_error}`}
                      {d.proximo_reintento && ` · reintento ${fechaHora(d.proximo_reintento)}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          </div>
        </>
      )}
    </>
  );
}
