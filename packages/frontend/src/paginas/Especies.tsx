import { useState, type FormEvent } from 'react';
import { Leaf } from 'lucide-react';
import { api, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useAvisos } from '../estado/avisos';
import { BarraSuperior } from '../componentes/Layout';
import { Boton, Campo, Encabezado, Esqueleto, MensajeError, Modal, Tarjeta, Vacio } from '../componentes/ui';
import { numero } from '../util/formato';

interface Rango {
  id_tipo_variable: number;
  valor_min: number;
  valor_max: number;
}
export interface EspecieFila {
  id_especie: number;
  nombre: string;
  descripcion: string;
  estado: 'activo' | 'baja';
  cultivos_en_curso: number;
  cultivos_total: number;
  rangos: Rango[];
}
interface TipoVariable {
  id_tipo_variable: number;
  nombre: string;
  unidad: string;
  min_fisico: number | null;
  max_fisico: number | null;
}
/** Formulario: los rangos se editan como texto por variable; vacío = sin rango de referencia. */
interface Form {
  id_especie?: number;
  nombre: string;
  descripcion: string;
  rangos: Record<number, { min: string; max: string }>;
}

/**
 * Catálogo de especies (CRUD para la demostración final). Antes era fijo por el seed.
 * Cada especie tiene rangos de referencia por variable. Baja lógica: deja de ofrecerse
 * para cultivos nuevos; no se permite con cultivos en curso (lo valida el backend).
 */
export function Especies() {
  const avisar = useAvisos();
  const lista = useDatos<EspecieFila[]>((s) => api.get('/especies', s), []);
  const cat = useDatos<{ tipos_variable: TipoVariable[] }>((s) => api.get('/catalogos', s), []);
  const tipos = cat.datos?.tipos_variable ?? [];
  const nombreTipo = (id: number) => tipos.find((t) => t.id_tipo_variable === id);
  /** Rango físico de la variable (lo mismo que valida el backend), para mostrarlo bajo los campos. */
  const permitido = (t: TipoVariable) =>
    t.min_fisico === null && t.max_fisico === null
      ? ''
      : `Permitido: ${t.min_fisico === null ? 'sin mínimo' : numero(t.min_fisico)} a ${t.max_fisico === null ? 'sin máximo' : numero(t.max_fisico)} ${t.unidad}`;
  const [form, setForm] = useState<Form | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  function abrir(e?: EspecieFila) {
    setErrores({});
    const rangos: Form['rangos'] = {};
    for (const r of e?.rangos ?? []) rangos[r.id_tipo_variable] = { min: String(r.valor_min), max: String(r.valor_max) };
    setForm({ id_especie: e?.id_especie, nombre: e?.nombre ?? '', descripcion: e?.descripcion ?? '', rangos });
  }

  function fueraDeRango(id: number, a: number, b: number) {
    const t = nombreTipo(id);
    return !!t && ((t.min_fisico !== null && a < t.min_fisico) || (t.max_fisico !== null && b > t.max_fisico));
  }

  function leerRangos(f: Form) {
    const err: Record<string, string> = {};
    const rangos: Rango[] = [];
    for (const [id, v] of Object.entries(f.rangos)) {
      const min = v.min.trim().replace(',', '.');
      const max = v.max.trim().replace(',', '.');
      if (!min && !max) continue;
      const a = Number(min);
      const b = Number(max);
      if (!min || !max || !Number.isFinite(a) || !Number.isFinite(b)) err[`r${id}`] = 'Ingrese mínimo y máximo, o deje ambos vacíos';
      else if (a >= b) err[`r${id}`] = 'El mínimo debe ser menor que el máximo';
      else if (fueraDeRango(Number(id), a, b)) err[`r${id}`] = `Fuera del rango permitido. ${permitido(nombreTipo(Number(id))!)}`;
      else rangos.push({ id_tipo_variable: Number(id), valor_min: a, valor_max: b });
    }
    return { err, rangos };
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { err, rangos } = leerRangos(form);
    if (!form.nombre.trim()) err.nombre = 'Obligatorio';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      const datos = { nombre: form.nombre.trim(), descripcion: form.descripcion.trim(), rangos };
      if (form.id_especie) await api.patch(`/especies/${form.id_especie}`, datos);
      else await api.post('/especies', datos);
      avisar(form.id_especie ? 'Especie actualizada' : 'Especie creada');
      setForm(null);
      void lista.refrescar();
    } catch (x) {
      const a = x as ApiError;
      setErrores({ general: a.message });
    } finally {
      setEnviando(false);
    }
  }

  async function cambiarEstado(e: EspecieFila) {
    const baja = e.estado === 'activo';
    if (baja && !window.confirm(`¿Dar de baja «${e.nombre}»? Dejará de ofrecerse para cultivos nuevos. Los cultivos anteriores la conservan.`)) return;
    try {
      await api.patch(`/especies/${e.id_especie}`, { estado: baja ? 'baja' : 'activo' });
      avisar(baja ? 'Especie dada de baja' : 'Especie reactivada');
      void lista.refrescar();
    } catch (x) {
      avisar((x as ApiError).message);
    }
  }

  return (
    <>
      <BarraSuperior />
      <Encabezado
        titulo="Especies"
        descripcion="Catálogo de cultivos con sus rangos de referencia. Las especies activas se ofrecen al registrar un cultivo."
        acciones={
          <Boton variante="primario" icono={Leaf} onClick={() => abrir()}>
            Nueva especie
          </Boton>
        }
      />
      <MensajeError error={lista.error} reintentar={lista.refrescar} />
      <Tarjeta etiqueta="Especies">
        {!lista.datos ? (
          <Esqueleto n={4} alto={48} />
        ) : !lista.datos.length ? (
          <Vacio titulo="Sin especies" icono={Leaf} />
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Especie</th>
                  <th scope="col">Rangos de referencia</th>
                  <th scope="col">Cultivos en curso</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.datos.map((e) => (
                  <tr key={e.id_especie}>
                    <td>
                      <strong>{e.nombre}</strong>
                      {e.descripcion && <div className="muted pequeno">{e.descripcion}</div>}
                    </td>
                    <td className="pequeno">
                      {e.rangos.length
                        ? e.rangos.map((r) => {
                            const t = nombreTipo(r.id_tipo_variable);
                            return (
                              <div key={r.id_tipo_variable}>
                                {t?.nombre ?? `#${r.id_tipo_variable}`}: <span className="dato">{numero(r.valor_min)}–{numero(r.valor_max)}</span> {t?.unidad}
                              </div>
                            );
                          })
                        : <span className="muted">Sin rangos</span>}
                    </td>
                    <td className="dato">
                      {e.cultivos_en_curso}
                      {e.cultivos_total > e.cultivos_en_curso && <span className="muted pequeno"> ({e.cultivos_total} en total)</span>}
                    </td>
                    <td>
                      <span className={`insignia ${e.estado === 'activo' ? 'e-normal' : 'e-neutro'}`}>{e.estado === 'activo' ? 'Activa' : 'De baja'}</span>
                    </td>
                    <td>
                      <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                        <Boton pequeno variante="fantasma" onClick={() => abrir(e)}>
                          Editar
                        </Boton>
                        <Boton
                          pequeno
                          variante="fantasma"
                          disabled={e.estado === 'activo' && e.cultivos_en_curso > 0}
                          title={e.estado === 'activo' && e.cultivos_en_curso > 0 ? 'Tiene cultivos en curso: ciérrelos primero' : undefined}
                          onClick={() => void cambiarEstado(e)}
                        >
                          {e.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}
                        </Boton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <Modal titulo={form?.id_especie ? 'Editar especie' : 'Nueva especie'} abierto={!!form} onCerrar={() => setForm(null)}>
        {form && (
          <form className="formulario" onSubmit={guardar} noValidate>
            <Campo etiqueta="Nombre" maxLength={80} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} error={errores.nombre} />
            <Campo etiqueta="Descripción (opcional)" maxLength={300} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
            <fieldset className="rangos-especie">
              <legend>Rangos de referencia</legend>
              <p className="muted pequeno">Deje ambos vacíos si la variable no aplica. Sirven de guía para definir los umbrales de cada sensor.</p>
              {tipos.map((t) => {
                const v = form.rangos[t.id_tipo_variable] ?? { min: '', max: '' };
                const poner = (k: 'min' | 'max', valor: string) => setForm({ ...form, rangos: { ...form.rangos, [t.id_tipo_variable]: { ...v, [k]: valor } } });
                return (
                  <div key={t.id_tipo_variable} className="filtros" style={{ alignItems: 'flex-start' }}>
                    <Campo
                      etiqueta={`${t.nombre} mín. (${t.unidad})`}
                      inputMode="decimal"
                      value={v.min}
                      onChange={(e) => poner('min', e.target.value)}
                      ayuda={permitido(t) || undefined}
                    />
                    <Campo
                      etiqueta={`${t.nombre} máx. (${t.unidad})`}
                      inputMode="decimal"
                      value={v.max}
                      onChange={(e) => poner('max', e.target.value)}
                      error={errores[`r${t.id_tipo_variable}`]}
                    />
                  </div>
                );
              })}
            </fieldset>
            <MensajeError error={errores.general ? { message: errores.general } : null} />
            <div className="acciones">
              <Boton type="button" variante="fantasma" onClick={() => setForm(null)}>
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
