import { useState } from 'react';
import { CheckCheck, Clock, Repeat } from 'lucide-react';
import type { Alerta } from '@aquaplants/shared';
import { api, ApiError } from '../api/cliente';
import { useSesion } from '../estado/sesion';
import { useAvisos } from '../estado/avisos';
import { fechaHora, numero } from '../util/formato';
import { Boton, InsigniaSeveridad, Modal, Vacio } from './ui';

/** Lista de alertas con acción «Resolver» solo si la Tabla 48 lo permite al rol (ayuda visual; el backend decide). */
export function ListaAlertas({ alertas, alResolver, compacta }: { alertas: Alerta[]; alResolver: () => void; compacta?: boolean }) {
  const { puede } = useSesion();
  const avisar = useAvisos();
  const [sel, setSel] = useState<Alerta | null>(null);
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const permitido = (a: Alerta) => (a.severidad === 'critica' ? puede('alertas.resolver_critica') : puede('alertas.resolver_advertencia'));

  async function resolver() {
    if (!sel) return;
    if (sel.severidad === 'critica' && !comentario.trim()) {
      setError('El comentario es obligatorio para resolver una alerta crítica');
      return;
    }
    setEnviando(true);
    try {
      await api.patch(`/alertas/${sel.id_alerta}/resolver`, { comentario: comentario.trim() || undefined });
      avisar('Alerta marcada como resuelta');
      setSel(null);
      setComentario('');
      setError(null);
      alResolver();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        avisar('La alerta ya fue resuelta por otro usuario');
        setSel(null);
        alResolver();
      } else setError(err.campo('comentario') ?? err.message);
    } finally {
      setEnviando(false);
    }
  }

  if (!alertas.length) return <Vacio titulo="Sin alertas" icono={CheckCheck}>No hay alertas para los filtros seleccionados.</Vacio>;
  return (
    <>
      <ul className="lista-items">
        {alertas.map((a) => (
          <li key={a.id_alerta} className="item">
            <div className="item-cuerpo">
              <div className="item-titulo">
                <InsigniaSeveridad severidad={a.severidad} />
                <span>
                  {a.tipo_variable} · {a.torre}
                </span>
                {a.estado === 'resuelta' && <span className="insignia e-neutro">Resuelta</span>}
              </div>
              <p className="pequeno" style={{ marginTop: 4 }}>
                Medido <strong className="dato">{numero(a.valor)} {a.unidad}</strong> fuera de [{numero(a.valor_min)} – {numero(a.valor_max)}]
                {a.ocurrencias > 1 && (
                  <>
                    {' '}
                    · último <span className="dato">{numero(a.ultimo_valor)}</span>
                  </>
                )}
              </p>
              <p className="muted pequeno" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                <span>
                  <Clock size={12} aria-hidden /> {fechaHora(a.fecha_generacion)}
                </span>
                {a.ocurrencias > 1 && (
                  <span>
                    <Repeat size={12} aria-hidden /> {a.ocurrencias} ocurrencias
                  </span>
                )}
                {!compacta && a.severidad === 'critica' && <span>Aviso externo: {etiquetaNotif(a.notificacion_estado)}</span>}
                {a.estado === 'resuelta' && (
                  <span>
                    Resuelta por {a.resuelta_por} {fechaHora(a.fecha_resolucion)}
                    {a.comentario && ` — «${a.comentario}»`}
                  </span>
                )}
              </p>
            </div>
            {a.estado === 'activa' &&
              (permitido(a) ? (
                <Boton pequeno variante="verde" onClick={() => setSel(a)}>
                  Resolver
                </Boton>
              ) : (
                <span className="muted pequeno" style={{ maxWidth: 120 }}>
                  Requiere Supervisor
                </span>
              ))}
          </li>
        ))}
      </ul>
      <Modal titulo="Resolver alerta" abierto={!!sel} onCerrar={() => setSel(null)}>
        {sel && (
          <div className="formulario">
            <p>
              <InsigniaSeveridad severidad={sel.severidad} /> {sel.tipo_variable} en {sel.torre}: <span className="dato">{numero(sel.valor)} {sel.unidad}</span>
            </p>
            <div className="campo">
              <label htmlFor="comentario">Comentario {sel.severidad === 'critica' ? '(obligatorio)' : '(opcional)'}</label>
              <textarea id="comentario" rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'comentario-error' : undefined} maxLength={500} />
              {error && (
                <span id="comentario-error" className="campo-error">
                  {error}
                </span>
              )}
            </div>
            <div className="acciones">
              <Boton variante="fantasma" onClick={() => setSel(null)}>
                Cancelar
              </Boton>
              <Boton variante="primario" onClick={() => void resolver()} cargando={enviando}>
                Marcar como resuelta
              </Boton>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function etiquetaNotif(e: string) {
  return ({ enviada: 'enviado', fallida: 'falló (ver eventos)', no_configurada: 'proveedor no configurado', pendiente: 'pendiente', no_aplica: 'no aplica' } as Record<string, string>)[e] ?? e;
}
