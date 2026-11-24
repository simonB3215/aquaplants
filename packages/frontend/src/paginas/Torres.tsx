import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Sprout } from 'lucide-react';
import { rolConCliente, type RespuestaEstado } from '@aquaplants/shared';
import { api, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { useAvisos } from '../estado/avisos';
import { useConexion } from '../estado/conexion';
import { BarraSuperior } from '../componentes/Layout';
import { TarjetaTorre } from '../componentes/TarjetaTorre';
import { PanelHistorico } from '../componentes/PanelHistorico';
import { Boton, Campo, Encabezado, Esqueleto, MensajeError, Modal, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { FiltrosTorres } from '../componentes/FiltrosTorres';
import { diasDeCultivo, hoyISO, textoDias } from '../util/formato';
import { filtrarTorres, guardarFiltroTorres, leerFiltroTorres, type FiltroTorres } from '../util/torres';

export function Torres() {
  const { usuario, puede } = useSesion();
  const conexion = useConexion();
  const estado = useDatos<RespuestaEstado>((s) => api.get('/torres/estado', s), [], { cadaMs: 5000 });
  const [filtro, setFiltro] = useState(() => leerFiltroTorres(usuario?.id_usuario));
  const torres = estado.datos?.torres ?? [];
  const visibles = filtrarTorres(torres, filtro);
  function cambiarFiltro(f: FiltroTorres) {
    setFiltro(f);
    guardarFiltroTorres(usuario?.id_usuario, f);
  }
  return (
    <>
      <BarraSuperior actualizadoEn={estado.actualizadoEn} desactualizado={estado.desactualizado} />
      <Encabezado
        titulo={usuario?.rol === 'encargado' ? 'Mis torres' : usuario?.rol === 'supervisor' ? `Torres de ${usuario.cliente ?? 'su cliente'}` : usuario?.rol === 'tecnico' ? 'Torres de mis clientes' : 'Torres'}
        descripcion="Estado actual por torre, actualizado cada 5 segundos (CU-03)"
      />
      <MensajeError error={estado.datos ? null : estado.error} reintentar={estado.refrescar} />
      {torres.length > 0 && (
        <Tarjeta etiqueta="Filtros de torres" className="tarjeta-filtros">
          <FiltrosTorres filtro={filtro} alCambiar={cambiarFiltro} visibles={visibles.length} total={torres.length} torres={torres} />
        </Tarjeta>
      )}
      {estado.cargando && !estado.datos ? (
        <Esqueleto n={3} alto={220} />
      ) : torres.length > 0 && visibles.length === 0 ? (
        <Tarjeta etiqueta="Sin resultados">
          <Vacio titulo="Ninguna torre coincide">Pruebe con otro texto, estado o conexión, o use «Limpiar filtros».</Vacio>
        </Tarjeta>
      ) : torres.length ? (
        <div className="rejilla rejilla-torres">
          {visibles.map((t) => (
            <TarjetaTorre key={t.id_instalacion} torre={t} servidorCaido={conexion !== 'en_linea' || estado.desactualizado} mostrarCliente={!!usuario && !rolConCliente(usuario.rol)} veAlertas={puede('alertas.ver', 'leer')} />
          ))}
        </div>
      ) : (
        <Tarjeta etiqueta="Sin torres">
          <Vacio titulo="No tiene torres asignadas" />
        </Tarjeta>
      )}
    </>
  );
}

interface Cultivo {
  id_cultivo: number;
  id_instalacion: number;
  especie: string;
  id_especie: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: 'en_curso' | 'finalizado';
}
interface Catalogos {
  especies: { id_especie: number; nombre: string; descripcion: string }[];
}

/** Ficha de la torre: estado, histórico y ciclo de cultivos (CU-10). Usable en terreno desde el móvil. */
export function FichaTorre() {
  const id = Number(useParams().id);
  const { puede, usuario } = useSesion();
  const avisar = useAvisos();
  const estado = useDatos<RespuestaEstado>((s) => api.get(`/torres/${id}/estado`, s), [id], { cadaMs: 5000 });
  // Anexo C (D-37): el Técnico no ve cultivos; no se pide la lista para no recibir un 403.
  const veCultivos = puede('cultivos.gestionar', 'leer');
  const cultivos = useDatos<Cultivo[]>((s) => api.get(`/cultivos?torre=${id}`, s), [id], { activo: veCultivos });
  const catalogos = useDatos<Catalogos>((s) => api.get('/catalogos', s), []);
  const [modal, setModal] = useState<'nuevo' | 'cerrar' | 'corregir' | null>(null);
  const [especie, setEspecie] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const torre = estado.datos?.torres[0];
  const enCurso = cultivos.datos?.find((c) => c.estado === 'en_curso');
  const escribir = puede('cultivos.gestionar');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (modal !== 'cerrar' && !especie) err.id_especie = 'Seleccione una especie del catálogo';
    if (!fecha) err.fecha = 'Ingrese una fecha';
    else if (fecha > hoyISO()) err.fecha = 'La fecha no puede ser futura';
    else if (modal === 'cerrar' && enCurso && fecha < enCurso.fecha_inicio) err.fecha = 'Debe ser igual o posterior a la fecha de inicio';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      if (modal === 'nuevo') await api.post('/cultivos', { id_instalacion: id, id_especie: Number(especie), fecha_inicio: fecha });
      else if (modal === 'corregir' && enCurso) await api.patch(`/cultivos/${enCurso.id_cultivo}`, { id_especie: Number(especie), fecha_inicio: fecha });
      else if (enCurso) await api.patch(`/cultivos/${enCurso.id_cultivo}/cerrar`, { fecha_fin: fecha });
      avisar(modal === 'nuevo' ? 'Cultivo registrado' : modal === 'corregir' ? 'Cultivo corregido' : 'Cultivo cerrado');
      setModal(null);
      void cultivos.refrescar();
      void estado.refrescar();
    } catch (x) {
      const a = x as ApiError;
      setErrores({ general: a.message, fecha: a.campo('fecha_inicio') ?? a.campo('fecha_fin') ?? '' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <BarraSuperior actualizadoEn={estado.actualizadoEn} desactualizado={estado.desactualizado} />
      <Link to="/torres" className="boton boton-fantasma boton-pequeno" style={{ marginBottom: 8 }}>
        <ArrowLeft size={16} aria-hidden /> Torres
      </Link>
      <Encabezado titulo={torre?.nombre ?? 'Torre'} descripcion={torre?.ubicacion} />
      <MensajeError error={estado.error} />
      {!torre ? (
        <Esqueleto n={2} alto={200} />
      ) : (
        <div className="rejilla rejilla-principal">
          <div className="rejilla" style={{ alignContent: 'start' }}>
            <TarjetaTorre torre={torre} veAlertas={puede('alertas.ver', 'leer')} mostrarCliente={!!usuario && !rolConCliente(usuario.rol)} />
            <Tarjeta titulo="Histórico">
              <PanelHistorico torres={[torre]} />
            </Tarjeta>
          </div>
          {veCultivos && (
          <Tarjeta
            titulo="Cultivos"
            descripcion="Un cultivo en curso por torre"
            acciones={
              escribir && (
                <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                  {enCurso && (
                    <Boton
                      pequeno
                      variante="fantasma"
                      onClick={() => (setModal('corregir'), setErrores({}), setEspecie(String(enCurso.id_especie)), setFecha(enCurso.fecha_inicio))}
                    >
                      Corregir
                    </Boton>
                  )}
                  <Boton pequeno variante="primario" icono={Plus} onClick={() => (setModal(enCurso ? 'cerrar' : 'nuevo'), setErrores({}), setEspecie(''), setFecha(hoyISO()))}>
                    {enCurso ? 'Cerrar cultivo' : 'Nuevo cultivo'}
                  </Boton>
                </div>
              )
            }
          >
            {!escribir && <p className="muted pequeno" style={{ marginBottom: 8 }}>Solo lectura para su rol.</p>}
            {escribir && enCurso && (
              <p className="muted pequeno" style={{ marginBottom: 8 }}>
                Todos los dispositivos de la torre miden la misma solución, por eso admite un solo cultivo en curso. Para otro lote al mismo tiempo (por ejemplo, otra lechuga), registre otra torre con su dispositivo.
              </p>
            )}
            {cultivos.datos?.length ? (
              <ul className="lista-items">
                {cultivos.datos.map((c) => (
                  <li key={c.id_cultivo} className="item">
                    <Sprout size={18} aria-hidden />
                    <div className="item-cuerpo">
                      <div className="item-titulo">
                        {c.especie} <span className={`insignia ${c.estado === 'en_curso' ? 'e-normal' : 'e-neutro'}`}>{c.estado === 'en_curso' ? 'En curso' : 'Finalizado'}</span>
                      </div>
                      <p className="muted pequeno">
                        {c.fecha_inicio} → {c.fecha_fin ?? 'actualidad'}
                      </p>
                      <p className="pequeno">
                        {c.fecha_fin ? 'Tiempo de cosecha: ' : 'En cultivo: '}
                        <strong className="dato">{textoDias(diasDeCultivo(c.fecha_inicio, c.fecha_fin))}</strong>
                        {!c.fecha_fin && ' (aún sin cosechar)'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio titulo="Sin cultivos registrados" icono={Sprout} />
            )}
          </Tarjeta>
          )}
        </div>
      )}
      <Modal titulo={modal === 'nuevo' ? 'Registrar cultivo' : modal === 'corregir' ? 'Corregir cultivo en curso' : 'Cerrar cultivo en curso'} abierto={!!modal} onCerrar={() => setModal(null)}>
        <form className="formulario" onSubmit={guardar} noValidate>
          {modal !== 'cerrar' && (
            <Selector etiqueta="Especie" value={especie} onChange={(e) => setEspecie(e.target.value)} error={errores.id_especie}>
              <option value="">Seleccione…</option>
              {catalogos.datos?.especies.map((e) => (
                <option key={e.id_especie} value={e.id_especie}>
                  {e.nombre}
                  {e.descripcion ? ` (${e.descripcion})` : ''}
                </option>
              ))}
            </Selector>
          )}
          {modal === 'cerrar' && enCurso && (
            <p>
              {enCurso.especie}, iniciado el {enCurso.fecha_inicio}
            </p>
          )}
          <Campo etiqueta={modal === 'cerrar' ? 'Fecha de fin (cosecha)' : 'Fecha de inicio'} type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} error={errores.fecha || undefined} />
          {errores.general && (
            <div className="aviso fondo-critico" role="alert">
              <p>{errores.general}</p>
            </div>
          )}
          <div className="acciones">
            <Boton type="button" variante="fantasma" onClick={() => setModal(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="primario" cargando={enviando}>
              Guardar
            </Boton>
          </div>
        </form>
      </Modal>
    </>
  );
}
