import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, ClipboardList, Cpu, Database, Leaf, Plus, SlidersHorizontal, Sprout, Users, Wrench, type LucideIcon } from 'lucide-react';
import type { Funcionalidad } from '@aquaplants/shared';
import { api, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { useAvisos } from '../estado/avisos';
import { BarraSuperior } from '../componentes/Layout';
import { Boton, Campo, Encabezado, Esqueleto, Incrustado, MensajeError, Modal, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { hoyISO, mesesRecientes } from '../util/formato';
import { Auditoria, Clientes, Infraestructura, Umbrales, Usuarios } from './Gestion';
import { Especies } from './Especies';
import { Incidencias } from './Incidencias';

interface Pestana {
  id: string;
  texto: string;
  icono: LucideIcon;
  f: Funcionalidad;
  leer?: boolean;
  Pantalla: () => JSX.Element | null;
}

/** Orden pensado para el recorrido de la demostración (docs/GUION_CRUD.md). */
const PESTANAS: Pestana[] = [
  { id: 'clientes', texto: 'Clientes', icono: Building2, f: 'clientes.gestionar', leer: true, Pantalla: Clientes },
  { id: 'especies', texto: 'Especies', icono: Leaf, f: 'especies.gestionar', leer: true, Pantalla: Especies },
  { id: 'torres', texto: 'Torres y equipos', icono: Cpu, f: 'infraestructura.gestionar', leer: true, Pantalla: Infraestructura },
  { id: 'umbrales', texto: 'Umbrales', icono: SlidersHorizontal, f: 'umbrales.gestionar', leer: true, Pantalla: Umbrales },
  { id: 'cultivos', texto: 'Cultivos', icono: Sprout, f: 'cultivos.gestionar', leer: true, Pantalla: CultivosTodos },
  { id: 'usuarios', texto: 'Usuarios', icono: Users, f: 'usuarios.gestionar', Pantalla: Usuarios },
  { id: 'incidencias', texto: 'Incidencias', icono: Wrench, f: 'incidencias.atender', leer: true, Pantalla: Incidencias },
  { id: 'auditoria', texto: 'Auditoría', icono: ClipboardList, f: 'auditoria.consultar', leer: true, Pantalla: Auditoria },
];

/**
 * Apartado único para la demostración final: todas las entidades con su CRUD en pestañas.
 * Reutiliza las mismas pantallas de Gestión (misma lógica y permisos del backend);
 * solo cambia la presentación (sin barra superior repetida, títulos como h2).
 */
export function Crud() {
  const { puede } = useSesion();
  const visibles = PESTANAS.filter((p) => puede(p.f, p.leer ? 'leer' : 'escribir'));
  const [params, setParams] = useSearchParams();
  const actual = visibles.find((p) => p.id === params.get('tab')) ?? visibles[0];
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function elegir(id: string, foco = false) {
    setParams({ tab: id }, { replace: true });
    if (foco) refs.current[id]?.focus();
  }
  function teclas(e: KeyboardEvent) {
    const i = visibles.findIndex((p) => p.id === actual?.id);
    const ir = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? visibles.length - 1 : null;
    if (ir === null) return;
    e.preventDefault();
    elegir(visibles[(ir + visibles.length) % visibles.length].id, true);
  }

  return (
    <>
      <BarraSuperior />
      <Encabezado
        titulo="CRUD"
        descripcion="Crear, ver, editar y dar de baja cada entidad del sistema. «Eliminar» es una baja lógica: se conserva el histórico y queda en Auditoría."
      />
      {!actual ? (
        <Vacio titulo="Sin acceso" icono={Database} />
      ) : (
        <>
          <div className="pestanas" role="tablist" aria-label="Entidades" onKeyDown={teclas}>
            {visibles.map((p) => (
              <button
                key={p.id}
                ref={(b) => (refs.current[p.id] = b)}
                type="button"
                role="tab"
                id={`tab-${p.id}`}
                aria-controls={`panel-${p.id}`}
                aria-selected={p.id === actual.id}
                tabIndex={p.id === actual.id ? 0 : -1}
                onClick={() => elegir(p.id)}
              >
                <p.icono size={16} aria-hidden /> {p.texto}
              </button>
            ))}
          </div>
          <section role="tabpanel" id={`panel-${actual.id}`} aria-labelledby={`tab-${actual.id}`} className="panel-pestana">
            <Incrustado.Provider value>
              <actual.Pantalla key={actual.id} />
            </Incrustado.Provider>
          </section>
        </>
      )}
    </>
  );
}

export interface CultivoFila {
  id_cultivo: number;
  id_instalacion: number;
  torre: string;
  id_especie: number;
  especie: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: 'en_curso' | 'finalizado';
}
interface TorreFila {
  id_instalacion: number;
  nombre: string;
  cliente: string;
  estado: string;
}

type ModalCultivo = { tipo: 'nuevo' } | { tipo: 'corregir' | 'cerrar'; c: CultivoFila };

/**
 * Cultivos de todas las torres visibles (antes solo desde la ficha de cada torre).
 * Un cultivo en curso por torre; «eliminar» = cerrar el cultivo con su fecha de fin.
 */
export function CultivosTodos() {
  const { puede } = useSesion();
  const avisar = useAvisos();
  const escribir = puede('cultivos.gestionar');
  const lista = useDatos<CultivoFila[]>((s) => api.get('/cultivos', s), []);
  const torres = useDatos<TorreFila[]>((s) => api.get('/torres', s), [], { activo: escribir });
  const cat = useDatos<{ especies: { id_especie: number; nombre: string }[] }>((s) => api.get('/catalogos', s), []);
  const [modal, setModal] = useState<ModalCultivo | null>(null);
  const [torre, setTorre] = useState('');
  const [especie, setEspecie] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  // Filtros de la lista por fecha de inicio (creación) del cultivo y por especie.
  const meses = mesesRecientes(12);
  const [fMes, setFMes] = useState('');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [fEspecie, setFEspecie] = useState('');
  const errorFiltro = fDesde && fHasta && fDesde > fHasta ? 'Debe ser igual o posterior a «Iniciado desde»' : undefined;
  const filtrados = (lista.datos ?? []).filter(
    (c) => (!fEspecie || String(c.id_especie) === fEspecie) && (!!errorFiltro || ((!fDesde || c.fecha_inicio >= fDesde) && (!fHasta || c.fecha_inicio <= fHasta))),
  );
  const hayFiltro = !!(fDesde || fHasta || fEspecie);
  function elegirMes(valor: string) {
    setFMes(valor);
    const m = meses.find((x) => x.valor === valor);
    setFDesde(m?.desde ?? '');
    setFHasta(m?.hasta ?? '');
  }
  function limpiar() {
    setFMes('');
    setFDesde('');
    setFHasta('');
    setFEspecie('');
  }

  const conCultivo = new Set(lista.datos?.filter((c) => c.estado === 'en_curso').map((c) => c.id_instalacion));
  const libres = (torres.datos ?? []).filter((t) => t.estado === 'activo' && !conCultivo.has(t.id_instalacion));

  function abrir(m: ModalCultivo) {
    setErrores({});
    setTorre('');
    setEspecie(m.tipo === 'corregir' ? String(m.c.id_especie) : '');
    setFecha(m.tipo === 'corregir' ? m.c.fecha_inicio : hoyISO());
    setModal(m);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;
    const err: Record<string, string> = {};
    if (modal.tipo === 'nuevo' && !torre) err.torre = 'Seleccione una torre';
    if (modal.tipo !== 'cerrar' && !especie) err.especie = 'Seleccione una especie del catálogo';
    if (!fecha) err.fecha = 'Ingrese una fecha';
    else if (fecha > hoyISO()) err.fecha = 'La fecha no puede ser futura';
    else if (modal.tipo === 'cerrar' && fecha < modal.c.fecha_inicio) err.fecha = 'Debe ser igual o posterior a la fecha de inicio';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      if (modal.tipo === 'nuevo') await api.post('/cultivos', { id_instalacion: Number(torre), id_especie: Number(especie), fecha_inicio: fecha });
      else if (modal.tipo === 'corregir') await api.patch(`/cultivos/${modal.c.id_cultivo}`, { id_especie: Number(especie), fecha_inicio: fecha });
      else await api.patch(`/cultivos/${modal.c.id_cultivo}/cerrar`, { fecha_fin: fecha });
      avisar(modal.tipo === 'nuevo' ? 'Cultivo registrado' : modal.tipo === 'corregir' ? 'Cultivo corregido' : 'Cultivo cerrado');
      setModal(null);
      void lista.refrescar();
    } catch (x) {
      const a = x as ApiError;
      setErrores({ general: a.message, fecha: a.campo('fecha_inicio') ?? a.campo('fecha_fin') ?? '' });
    } finally {
      setEnviando(false);
    }
  }

  const titulo = !modal ? '' : modal.tipo === 'nuevo' ? 'Nuevo cultivo' : modal.tipo === 'corregir' ? 'Corregir cultivo' : 'Cerrar cultivo';

  return (
    <>
      <BarraSuperior />
      <Encabezado
        titulo="Cultivos"
        descripcion="Ciclos de cultivo de todas las torres. Una torre tiene a lo más un cultivo en curso; al cerrarlo queda en el historial."
        acciones={
          escribir && (
            <Boton variante="primario" icono={Plus} onClick={() => abrir({ tipo: 'nuevo' })}>
              Nuevo cultivo
            </Boton>
          )
        }
      />
      <MensajeError error={lista.error} reintentar={lista.refrescar} />
      <Tarjeta etiqueta="Cultivos">
        {!lista.datos ? (
          <Esqueleto n={4} alto={48} />
        ) : !lista.datos.length ? (
          <Vacio titulo="Sin cultivos registrados" icono={Sprout} />
        ) : (
          <>
            <div className="filtros" role="search" aria-label="Filtrar cultivos" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
              <Selector etiqueta="Mes de inicio" value={fMes} onChange={(e) => elegirMes(e.target.value)}>
                <option value="">Todos / por fechas</option>
                {meses.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.texto}
                  </option>
                ))}
              </Selector>
              <Campo etiqueta="Iniciado desde" type="date" value={fDesde} onChange={(e) => (setFDesde(e.target.value), setFMes(''))} error={errorFiltro} />
              <Campo etiqueta="Iniciado hasta" type="date" value={fHasta} onChange={(e) => (setFHasta(e.target.value), setFMes(''))} />
              <Selector etiqueta="Especie" value={fEspecie} onChange={(e) => setFEspecie(e.target.value)}>
                <option value="">Todas</option>
                {cat.datos?.especies.map((s) => (
                  <option key={s.id_especie} value={s.id_especie}>
                    {s.nombre}
                  </option>
                ))}
              </Selector>
              {hayFiltro && (
                <Boton variante="fantasma" onClick={limpiar}>
                  Limpiar filtros
                </Boton>
              )}
            </div>
            <p className="muted pequeno" role="status" style={{ margin: '0 0 8px' }}>
              {hayFiltro ? `${filtrados.length} de ${lista.datos.length} cultivos` : `${lista.datos.length} cultivos`}
            </p>
            {!filtrados.length ? (
              <Vacio titulo="Ningún cultivo coincide con los filtros" icono={Sprout} />
            ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Torre</th>
                  <th scope="col">Especie</th>
                  <th scope="col">Inicio</th>
                  <th scope="col">Fin</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((c) => (
                  <tr key={c.id_cultivo}>
                    <td>
                      <strong>{c.torre}</strong>
                    </td>
                    <td>{c.especie}</td>
                    <td className="dato">{c.fecha_inicio}</td>
                    <td className="dato">{c.fecha_fin ?? '—'}</td>
                    <td>
                      <span className={`insignia ${c.estado === 'en_curso' ? 'e-normal' : 'e-neutro'}`}>{c.estado === 'en_curso' ? 'En curso' : 'Finalizado'}</span>
                    </td>
                    <td>
                      {escribir && c.estado === 'en_curso' && (
                        <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                          <Boton pequeno variante="fantasma" onClick={() => abrir({ tipo: 'corregir', c })}>
                            Corregir
                          </Boton>
                          <Boton pequeno variante="fantasma" onClick={() => abrir({ tipo: 'cerrar', c })}>
                            Cerrar
                          </Boton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            )}
          </>
        )}
      </Tarjeta>

      <Modal titulo={titulo} abierto={!!modal} onCerrar={() => setModal(null)}>
        {modal && (
          <form className="formulario" onSubmit={guardar} noValidate>
            {modal.tipo === 'nuevo' ? (
              <Selector etiqueta="Torre" value={torre} onChange={(e) => setTorre(e.target.value)} error={errores.torre}>
                <option value="">{libres.length ? 'Seleccione…' : 'Todas las torres tienen un cultivo en curso'}</option>
                {libres.map((t) => (
                  <option key={t.id_instalacion} value={t.id_instalacion}>
                    {t.nombre} · {t.cliente}
                  </option>
                ))}
              </Selector>
            ) : (
              <p>
                <strong>{modal.c.torre}</strong>: {modal.c.especie}, iniciado el {modal.c.fecha_inicio}
              </p>
            )}
            {modal.tipo !== 'cerrar' && (
              <Selector etiqueta="Especie" value={especie} onChange={(e) => setEspecie(e.target.value)} error={errores.especie}>
                <option value="">Seleccione…</option>
                {cat.datos?.especies.map((e) => (
                  <option key={e.id_especie} value={e.id_especie}>
                    {e.nombre}
                  </option>
                ))}
              </Selector>
            )}
            <Campo
              etiqueta={modal.tipo === 'cerrar' ? 'Fecha de fin (cosecha)' : 'Fecha de inicio'}
              type="date"
              max={hoyISO()}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              error={errores.fecha || undefined}
            />
            <MensajeError error={errores.general ? { message: errores.general } : null} />
            <div className="acciones">
              <Boton type="button" variante="fantasma" onClick={() => setModal(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" variante="primario" cargando={enviando}>
                Guardar
              </Boton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
