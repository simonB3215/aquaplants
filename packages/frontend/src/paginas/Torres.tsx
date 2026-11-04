import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Sprout } from 'lucide-react';
import type { RespuestaEstado } from '@aquaplants/shared';
import { api, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { useAvisos } from '../estado/avisos';
import { useConexion } from '../estado/conexion';
import { BarraSuperior } from '../componentes/Layout';
import { TarjetaTorre } from '../componentes/TarjetaTorre';
import { PanelHistorico } from '../componentes/PanelHistorico';
import { Boton, Campo, Encabezado, Esqueleto, MensajeError, Modal, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { hoyISO } from '../util/formato';

export function Torres() {
  const { usuario } = useSesion();
  const conexion = useConexion();
  const estado = useDatos<RespuestaEstado>((s) => api.get('/torres/estado', s), [], { cadaMs: 5000 });
  return (
    <>
      <BarraSuperior actualizadoEn={estado.actualizadoEn} desactualizado={estado.desactualizado} />
      <Encabezado titulo={usuario?.rol === 'encargado' ? 'Mis torres' : 'Torres'} descripcion="Estado actual por torre, actualizado cada 5 segundos (CU-03)" />
      <MensajeError error={estado.datos ? null : estado.error} reintentar={estado.refrescar} />
      {estado.cargando && !estado.datos ? (
        <Esqueleto n={3} alto={220} />
      ) : estado.datos?.torres.length ? (
        <div className="rejilla rejilla-torres">
          {estado.datos.torres.map((t) => (
            <TarjetaTorre key={t.id_instalacion} torre={t} servidorCaido={conexion !== 'en_linea' || estado.desactualizado} />
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
  const { puede } = useSesion();
  const avisar = useAvisos();
  const estado = useDatos<RespuestaEstado>((s) => api.get(`/torres/${id}/estado`, s), [id], { cadaMs: 5000 });
  const cultivos = useDatos<Cultivo[]>((s) => api.get(`/cultivos?torre=${id}`, s), [id]);
  const catalogos = useDatos<Catalogos>((s) => api.get('/catalogos', s), []);
  const [modal, setModal] = useState<'nuevo' | 'cerrar' | null>(null);
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
    if (modal === 'nuevo' && !especie) err.id_especie = 'Seleccione una especie del catálogo';
    if (!fecha) err.fecha = 'Ingrese una fecha';
    else if (fecha > hoyISO()) err.fecha = 'La fecha no puede ser futura';
    else if (modal === 'cerrar' && enCurso && fecha < enCurso.fecha_inicio) err.fecha = 'Debe ser igual o posterior a la fecha de inicio';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      if (modal === 'nuevo') await api.post('/cultivos', { id_instalacion: id, id_especie: Number(especie), fecha_inicio: fecha });
      else if (enCurso) await api.patch(`/cultivos/${enCurso.id_cultivo}/cerrar`, { fecha_fin: fecha });
      avisar(modal === 'nuevo' ? 'Cultivo registrado' : 'Cultivo cerrado');
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
            <TarjetaTorre torre={torre} />
            <Tarjeta titulo="Histórico">
              <PanelHistorico torres={[torre]} />
            </Tarjeta>
          </div>
          <Tarjeta
            titulo="Cultivos"
            descripcion="Un cultivo en curso por torre"
            acciones={
              escribir && (
                <Boton pequeno variante="primario" icono={Plus} onClick={() => (setModal(enCurso ? 'cerrar' : 'nuevo'), setErrores({}), setFecha(hoyISO()))}>
                  {enCurso ? 'Cerrar cultivo' : 'Nuevo cultivo'}
                </Boton>
              )
            }
          >
            {!escribir && <p className="muted pequeno" style={{ marginBottom: 8 }}>Solo lectura para su rol.</p>}
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
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio titulo="Sin cultivos registrados" icono={Sprout} />
            )}
          </Tarjeta>
        </div>
      )}
      <Modal titulo={modal === 'nuevo' ? 'Registrar cultivo' : 'Cerrar cultivo en curso'} abierto={!!modal} onCerrar={() => setModal(null)}>
        <form className="formulario" onSubmit={guardar} noValidate>
          {modal === 'nuevo' && (
            <Selector etiqueta="Especie" value={especie} onChange={(e) => setEspecie(e.target.value)} error={errores.id_especie}>
              <option value="">Seleccione…</option>
              {catalogos.datos?.especies.map((e) => (
                <option key={e.id_especie} value={e.id_especie}>
                  {e.nombre} ({e.descripcion})
                </option>
              ))}
            </Selector>
          )}
          {modal === 'cerrar' && enCurso && (
            <p>
              {enCurso.especie}, iniciado el {enCurso.fecha_inicio}
            </p>
          )}
          <Campo etiqueta={modal === 'nuevo' ? 'Fecha de inicio' : 'Fecha de fin (cosecha)'} type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} error={errores.fecha || undefined} />
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
