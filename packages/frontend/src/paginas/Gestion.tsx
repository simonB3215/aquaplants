import { useState, type FormEvent } from 'react';
import { Ban, Building2, KeyRound, Link2, MapPin, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { ETIQUETA_ROL, esAdministracion, puedeGestionarRol, rolConCliente, rolesAsignables, type AvisoAlertas, type Rol } from '@aquaplants/shared';
import { EnlaceGps, leerGps } from '../componentes/Ubicacion';
import { api, qs, ApiError } from '../api/cliente';
import { useDatos } from '../hooks/useDatos';
import { useSesion } from '../estado/sesion';
import { useAvisos } from '../estado/avisos';
import { BarraSuperior } from '../componentes/Layout';
import { SeleccionMultiple } from '../componentes/SeleccionMultiple';
import { Aviso, Boton, Campo, Encabezado, Esqueleto, MensajeError, Modal, Paginador, Selector, Tarjeta, Vacio } from '../componentes/ui';
import { fechaHora, hace, numero } from '../util/formato';
import { FiltrosUsuarios } from '../componentes/FiltrosUsuarios';
import { ESTADOS_USUARIO, estadoUsuario, filtrarUsuarios, SIN_FILTROS } from '../util/usuarios';

/* =================================================================== Usuarios (CU-09 + Anexo C) */
interface UsuarioFila {
  id_usuario: number;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  bloqueado: boolean;
  debe_cambiar_password: boolean;
  torres: number[];
  /** D-37: cliente del Supervisor/Encargado y clientes que atiende un Técnico. */
  id_cliente: number | null;
  cliente: string | null;
  clientes: number[];
}
interface TorreFila {
  id_instalacion: number;
  nombre: string;
  tipo: string;
  ubicacion: string;
  estado: string;
  dispositivos: number;
  id_cliente: number;
  cliente: string;
  responsables: { id_usuario: number; nombre: string; rol: string }[];
}
export interface ClienteFila {
  id_cliente: number;
  nombre: string;
  estado: 'activo' | 'baja';
  torres: number;
  usuarios: number;
  tecnicos: number;
}

/** Clientes visibles para quien puede verlos (solo Administradores). */
function useClientes() {
  const { puede } = useSesion();
  return useDatos<ClienteFila[]>((s) => api.get('/clientes', s), [], { activo: puede('clientes.gestionar', 'leer') });
}

export function Usuarios() {
  const { usuario } = useSesion();
  const avisar = useAvisos();
  const lista = useDatos<UsuarioFila[]>((s) => api.get('/usuarios', s), []);
  const torres = useDatos<TorreFila[]>((s) => api.get('/torres', s), []);
  const clientes = useClientes();
  const [edit, setEdit] = useState<Partial<UsuarioFila> | null>(null);
  const [filtro, setFiltro] = useState(SIN_FILTROS);
  const visibles = filtrarUsuarios(lista.datos ?? [], filtro);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [secreto, setSecreto] = useState<{ email: string; pass: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (!usuario) return null;
  const admin = esAdministracion(usuario.rol);
  const asignables = rolesAsignables(usuario.rol);
  const clientesActivos = (clientes.datos ?? []).filter((c) => c.estado === 'activo');
  const esYo = (u: Partial<UsuarioFila>) => u.id_usuario === usuario.id_usuario;
  /** RN-12: solo se ofrece gestionar a quien el backend también lo permite. */
  const gestionable = (u: UsuarioFila) => esYo(u) || puedeGestionarRol(usuario.rol, u.rol);
  const nombreTorre = (id: number) => torres.datos?.find((t) => t.id_instalacion === id)?.nombre ?? `#${id}`;
  const nombreCliente = (id: number) => clientes.datos?.find((c) => c.id_cliente === id)?.nombre ?? `#${id}`;

  function alcance(u: UsuarioFila) {
    if (esAdministracion(u.rol)) return 'Todos los clientes';
    if (u.rol === 'tecnico') return u.clientes.length ? `Atiende: ${u.clientes.map(nombreCliente).join(', ')}` : 'Sin clientes asignados';
    const cliente = u.cliente ?? 'Sin cliente';
    if (u.rol === 'supervisor') return `${cliente} · todas sus torres`;
    return `${admin ? `${cliente} · ` : ''}${u.torres.map(nombreTorre).join(', ') || 'Sin torres'}`;
  }

  function nuevo() {
    setErrores({});
    // El Supervisor solo crea Encargados de su propio cliente.
    setEdit({ rol: 'encargado', torres: [], clientes: [], id_cliente: admin ? (clientesActivos.length === 1 ? clientesActivos[0].id_cliente : null) : usuario!.id_cliente });
  }

  function cuerpo(e: Partial<UsuarioFila>) {
    if (esYo(e)) return { nombre: e.nombre };
    const rol = e.rol as Rol;
    return {
      nombre: e.nombre,
      rol,
      ...(admin && rolConCliente(rol) && e.id_cliente ? { id_cliente: e.id_cliente } : {}),
      ...(rol === 'encargado' ? { torres: e.torres ?? [] } : {}),
      ...(rol === 'tecnico' ? { clientes: e.clientes ?? [] } : {}),
    };
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const err: Record<string, string> = {};
    if (!edit.nombre?.trim()) err.nombre = 'Obligatorio';
    if (!edit.id_usuario && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(edit.email ?? '')) err.email = 'Email inválido';
    if (!esYo(edit) && admin && rolConCliente(edit.rol as Rol) && !edit.id_cliente) err.id_cliente = 'Seleccione el cliente';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      if (edit.id_usuario) {
        await api.patch(`/usuarios/${edit.id_usuario}`, cuerpo(edit));
        avisar('Usuario actualizado');
      } else {
        const r = await api.post<{ password_temporal: string }>('/usuarios', { ...cuerpo(edit), email: edit.email });
        setSecreto({ email: edit.email!, pass: r.password_temporal });
      }
      setEdit(null);
      void lista.refrescar();
    } catch (x) {
      const a = x as ApiError;
      setErrores({
        general: a.message,
        email: a.campo('email') ?? (a.codigo === 'EMAIL_DUPLICADO' ? a.message : ''),
        id_cliente: a.campo('id_cliente') ?? '',
        torres: a.campo('torres') ?? '',
      });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarActivo(u: UsuarioFila) {
    if (u.activo && !window.confirm(`¿Desactivar a ${u.nombre}? Sus sesiones se invalidarán y su historial se conserva.`)) return;
    try {
      await api.patch(`/usuarios/${u.id_usuario}`, { activo: !u.activo });
      avisar(u.activo ? 'Usuario desactivado' : 'Usuario reactivado');
      void lista.refrescar();
    } catch (x) {
      avisar((x as ApiError).message);
    }
  }
  async function restablecer(u: UsuarioFila) {
    try {
      const r = await api.post<{ password_temporal: string }>(`/usuarios/${u.id_usuario}/restablecer-password`);
      setSecreto({ email: u.email, pass: r.password_temporal });
    } catch (x) {
      avisar((x as ApiError).message);
    }
  }

  // Torres que se pueden asignar a un Encargado: activas y del cliente elegido (RN-11).
  const torresDelCliente = (idCliente: number | null | undefined) =>
    (torres.datos ?? []).filter((t) => t.estado === 'activo' && (!admin || t.id_cliente === idCliente)).map((t) => ({ id: t.id_instalacion, texto: t.nombre }));
  const rolesDelFormulario = edit && esYo(edit) ? [edit.rol as Rol] : asignables;

  return (
    <>
      <BarraSuperior />
      <Encabezado
        titulo={admin ? 'Usuarios y roles' : 'Mis Encargados'}
        descripcion={
          admin
            ? 'Alta, edición, desactivación y asignación (CU-09). Cada nivel gestiona solo los niveles inferiores (RN-12).'
            : `Encargados de ${usuario.cliente ?? 'su cliente'}: créelos, asígneles torres o desactívelos (CU-09).`
        }
        acciones={
          <Boton variante="primario" icono={UserPlus} onClick={nuevo}>
            {admin ? 'Nuevo usuario' : 'Nuevo Encargado'}
          </Boton>
        }
      />
      <MensajeError error={lista.error} />
      <Tarjeta etiqueta="Usuarios">
        {lista.datos && <FiltrosUsuarios filtro={filtro} alCambiar={setFiltro} visibles={visibles.length} total={lista.datos.length} roles={[...new Set(lista.datos.map((u) => u.rol as Rol))]} />}
        {!lista.datos ? (
          <Esqueleto n={3} alto={48} />
        ) : lista.datos.length === 0 ? (
          <Vacio titulo={admin ? 'Sin usuarios' : 'Todavía no tiene Encargados'}>{admin ? '' : 'Use «Nuevo Encargado» o un enlace de invitación.'}</Vacio>
        ) : visibles.length === 0 ? (
          <Vacio titulo="Ningún usuario coincide">Pruebe con otro texto, rol o estado, o use «Limpiar filtros».</Vacio>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Email</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Alcance</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((u) => (
                  <tr key={u.id_usuario}>
                    <td>
                      <strong>{u.nombre}</strong>
                      {esYo(u) && <span className="muted pequeno"> (usted)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{ETIQUETA_ROL[u.rol]}</td>
                    <td className="pequeno">{alcance(u)}</td>
                    <td>
                      <span className={`insignia ${ESTADOS_USUARIO[estadoUsuario(u)].clase}`}>{ESTADOS_USUARIO[estadoUsuario(u)].texto}</span>
                    </td>
                    <td>
                      {gestionable(u) ? (
                        <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                          <Boton pequeno variante="fantasma" onClick={() => (setErrores({}), setEdit(u))}>
                            Editar
                          </Boton>
                          <Boton pequeno variante="fantasma" icono={KeyRound} onClick={() => void restablecer(u)} aria-label={`Restablecer contraseña de ${u.nombre}`} />
                          {!esYo(u) && (
                            <Boton pequeno variante="fantasma" onClick={() => void alternarActivo(u)}>
                              {u.activo ? 'Desactivar' : 'Reactivar'}
                            </Boton>
                          )}
                        </div>
                      ) : (
                        <span className="muted pequeno" title="Cada nivel gestiona solo niveles inferiores (RN-12)">
                          Solo lectura
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <PanelInvitaciones torres={torres.datos ?? []} varios={admin} alRegistrar={() => void lista.refrescar()} />

      <Modal titulo={edit?.id_usuario ? 'Editar usuario' : admin ? 'Nuevo usuario' : 'Nuevo Encargado'} abierto={!!edit} onCerrar={() => setEdit(null)}>
        {edit && (
          <form className="formulario" onSubmit={guardar} noValidate>
            <Campo etiqueta="Nombre" value={edit.nombre ?? ''} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} error={errores.nombre} />
            <Campo etiqueta="Email" type="email" disabled={!!edit.id_usuario} value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} error={errores.email || undefined} />
            {rolesDelFormulario.length > 1 ? (
              <Selector etiqueta="Rol" value={edit.rol} onChange={(e) => setEdit({ ...edit, rol: e.target.value as Rol })}>
                {rolesDelFormulario.map((r) => (
                  <option key={r} value={r}>
                    {ETIQUETA_ROL[r]}
                  </option>
                ))}
              </Selector>
            ) : (
              <p className="pequeno">
                Rol: <strong>{ETIQUETA_ROL[(edit.rol ?? rolesDelFormulario[0]) as Rol]}</strong>
                {esYo(edit) && <span className="muted"> · usted no puede cambiar su propio rol ni sus asignaciones</span>}
              </p>
            )}
            {!esYo(edit) && admin && rolConCliente(edit.rol as Rol) && (
              <Selector
                etiqueta="Cliente (RN-11)"
                value={edit.id_cliente ?? ''}
                onChange={(e) => setEdit({ ...edit, id_cliente: e.target.value ? Number(e.target.value) : null, torres: [] })}
                error={errores.id_cliente || undefined}
              >
                <option value="">Seleccione…</option>
                {clientesActivos.map((c) => (
                  <option key={c.id_cliente} value={c.id_cliente}>
                    {c.nombre}
                  </option>
                ))}
              </Selector>
            )}
            {!esYo(edit) && edit.rol === 'encargado' && (
              <SeleccionMultiple
                etiqueta="Torres asignadas (RN-10)"
                opciones={torresDelCliente(edit.id_cliente)}
                seleccion={edit.torres ?? []}
                alCambiar={(ids) => setEdit({ ...edit, torres: ids })}
                error={errores.torres || undefined}
              />
            )}
            {!esYo(edit) && edit.rol === 'tecnico' && (
              <SeleccionMultiple
                etiqueta="Clientes que atiende (incidencias de equipos)"
                opciones={clientesActivos.map((c) => ({ id: c.id_cliente, texto: c.nombre }))}
                seleccion={edit.clientes ?? []}
                alCambiar={(ids) => setEdit({ ...edit, clientes: ids })}
              />
            )}
            {!esYo(edit) && edit.rol === 'supervisor' && <p className="muted pequeno">El Supervisor ve todas las torres de su cliente y gestiona a sus Encargados.</p>}
            {!edit.id_usuario && <p className="muted pequeno">Se generará una contraseña temporal que el usuario deberá cambiar en su primer acceso.</p>}
            {errores.general && (
              <div className="aviso fondo-critico" role="alert">
                <p>{errores.general}</p>
              </div>
            )}
            <div className="acciones">
              <Boton type="button" variante="fantasma" onClick={() => setEdit(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" variante="primario" cargando={enviando}>
                Guardar
              </Boton>
            </div>
          </form>
        )}
      </Modal>
      <Modal titulo="Contraseña temporal" abierto={!!secreto} onCerrar={() => setSecreto(null)}>
        <p style={{ marginBottom: 8 }}>
          Entregue esta contraseña a <strong>{secreto?.email}</strong> por un canal seguro. <strong>Se muestra una sola vez.</strong>
        </p>
        <div className="credencial-unica">{secreto?.pass}</div>
        <div className="acciones" style={{ marginTop: 12 }}>
          <Boton variante="verde" onClick={() => void navigator.clipboard?.writeText(secreto?.pass ?? '')}>
            Copiar
          </Boton>
          <Boton onClick={() => setSecreto(null)}>Entendido</Boton>
        </div>
      </Modal>
    </>
  );
}

/* =================================================================== Clientes (D-37, RN-11) */
export function Clientes() {
  const avisar = useAvisos();
  const lista = useClientes();
  const [form, setForm] = useState<{ id_cliente?: number; nombre: string } | null>(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.nombre.trim()) return setError('Obligatorio');
    setEnviando(true);
    try {
      if (form.id_cliente) await api.patch(`/clientes/${form.id_cliente}`, { nombre: form.nombre.trim() });
      else await api.post('/clientes', { nombre: form.nombre.trim() });
      avisar(form.id_cliente ? 'Cliente actualizado' : 'Cliente creado');
      setForm(null);
      void lista.refrescar();
    } catch (x) {
      setError((x as ApiError).message);
    } finally {
      setEnviando(false);
    }
  }
  async function cambiarEstado(c: ClienteFila) {
    const baja = c.estado === 'activo';
    if (baja && !window.confirm(`¿Dar de baja a ${c.nombre}? Debe no tener torres activas ni usuarios activos. Sus datos se conservan.`)) return;
    try {
      await api.patch(`/clientes/${c.id_cliente}`, { estado: baja ? 'baja' : 'activo' });
      avisar(baja ? 'Cliente dado de baja' : 'Cliente reactivado');
      void lista.refrescar();
    } catch (x) {
      avisar((x as ApiError).message);
    }
  }

  return (
    <>
      <BarraSuperior />
      <Encabezado
        titulo="Clientes"
        descripcion="Cada torre pertenece a un cliente; su Supervisor y sus Encargados solo ven ese cliente (RN-11)."
        acciones={
          <Boton variante="primario" icono={Building2} onClick={() => (setError(''), setForm({ nombre: '' }))}>
            Nuevo cliente
          </Boton>
        }
      />
      <MensajeError error={lista.error} />
      <Tarjeta etiqueta="Clientes">
        {!lista.datos ? (
          <Esqueleto n={3} alto={48} />
        ) : !lista.datos.length ? (
          <Vacio titulo="Sin clientes" icono={Building2} />
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">Torres activas</th>
                  <th scope="col">Usuarios activos</th>
                  <th scope="col">Técnicos</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.datos.map((c) => (
                  <tr key={c.id_cliente}>
                    <td>
                      <strong>{c.nombre}</strong>
                      {c.id_cliente === 1 && <span className="muted pequeno"> · datos anteriores a la separación por clientes</span>}
                    </td>
                    <td className="dato">{c.torres}</td>
                    <td className="dato">{c.usuarios}</td>
                    <td className="dato">{c.tecnicos}</td>
                    <td>
                      <span className={`insignia ${c.estado === 'activo' ? 'e-normal' : 'e-neutro'}`}>{c.estado === 'activo' ? 'Activo' : 'De baja'}</span>
                    </td>
                    <td>
                      <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                        <Boton pequeno variante="fantasma" onClick={() => (setError(''), setForm({ id_cliente: c.id_cliente, nombre: c.nombre }))}>
                          Renombrar
                        </Boton>
                        <Boton pequeno variante="fantasma" onClick={() => void cambiarEstado(c)}>
                          {c.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}
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
      <Modal titulo={form?.id_cliente ? 'Renombrar cliente' : 'Nuevo cliente'} abierto={!!form} onCerrar={() => setForm(null)}>
        {form && (
          <form className="formulario" onSubmit={guardar} noValidate>
            <Campo etiqueta="Nombre del cliente" maxLength={120} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} error={error || undefined} />
            <p className="muted pequeno">Después asigne torres al cliente en Infraestructura y cree su Supervisor en Usuarios.</p>
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

/* =================================================================== Invitaciones (D-28) */
interface InvitacionFila {
  id_invitacion: number;
  descripcion: string;
  creada_en: string;
  vence_en: string;
  max_usos: number;
  usos: number;
  por_confirmar: number;
  estado: 'vigente' | 'vencida' | 'agotada' | 'anulada';
  creada_por: string;
  cliente?: string;
  torres: { id_instalacion: number; nombre: string }[];
}
const ETIQUETA_INVITACION: Record<InvitacionFila['estado'], { texto: string; clase: string }> = {
  vigente: { texto: 'Vigente', clase: 'e-normal' },
  vencida: { texto: 'Vencida', clase: 'e-neutro' },
  agotada: { texto: 'Sin cupos', clase: 'e-advertencia' },
  anulada: { texto: 'Anulada', clase: 'e-neutro' },
};

/**
 * Enlaces de invitación por torre: quien se registra con uno queda como Encargado
 * de esas torres tras confirmar su email. Rol fijo, vencimiento y cupo (D-28).
 */
function PanelInvitaciones({ torres, varios, alRegistrar }: { torres: TorreFila[]; varios: boolean; alRegistrar: () => void }) {
  const etiqueta = (t: TorreFila) => (varios ? `${t.nombre} · ${t.cliente}` : t.nombre);
  const avisar = useAvisos();
  const lista = useDatos<InvitacionFila[]>((s) => api.get('/invitaciones', s), []);
  const [form, setForm] = useState<{ torres: number[]; dias: string; max_usos: string; descripcion: string } | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [enlace, setEnlace] = useState<{ url: string; vence_en: string; torres: string } | null>(null);

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const dias = Number(form.dias);
    const cupo = Number(form.max_usos);
    const err: Record<string, string> = {};
    if (!form.torres.length) err.torres = 'Elija al menos una torre';
    if (!Number.isInteger(dias) || dias < 1 || dias > 30) err.dias = 'Entre 1 y 30 días';
    if (!Number.isInteger(cupo) || cupo < 1 || cupo > 500) err.max_usos = 'Entre 1 y 500 personas';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      const r = await api.post<{ enlace: string; vence_en: string }>('/invitaciones', { torres: form.torres, dias, max_usos: cupo, descripcion: form.descripcion.trim() || undefined });
      const nombres = torres.filter((t) => form.torres.includes(t.id_instalacion)).map((t) => t.nombre).join(', ');
      setEnlace({ url: r.enlace, vence_en: r.vence_en, torres: nombres });
      setForm(null);
      void lista.refrescar();
    } catch (x) {
      setErrores({ general: (x as ApiError).message });
    } finally {
      setEnviando(false);
    }
  }

  async function anular(i: InvitacionFila) {
    if (!window.confirm('¿Anular este enlace? Nadie más podrá registrarse con él. Las cuentas ya creadas se mantienen.')) return;
    try {
      await api.patch(`/invitaciones/${i.id_invitacion}/anular`);
      avisar('Enlace anulado');
      void lista.refrescar();
      alRegistrar();
    } catch (x) {
      avisar((x as ApiError).message);
    }
  }

  return (
    <>
      <Tarjeta
        etiqueta="Enlaces de invitación"
        titulo="Enlaces de invitación"
        descripcion={`Comparta un enlace por torre: cada persona crea su cuenta y confirma su email. Siempre entran como Encargado de cultivo${varios ? ' del cliente de esas torres' : ''}.`}
        acciones={
          <Boton variante="primario" icono={Link2} onClick={() => (setErrores({}), setForm({ torres: [], dias: '7', max_usos: '20', descripcion: '' }))}>
            Nuevo enlace
          </Boton>
        }
      >
        <MensajeError error={lista.error} />
        {!lista.datos ? (
          <Esqueleto n={2} alto={44} />
        ) : !lista.datos.length ? (
          <Vacio titulo="Sin enlaces todavía">Cree un enlace para que el personal de una torre se registre solo.</Vacio>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Torres</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Registrados</th>
                  <th scope="col">Vence</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.datos.map((i) => (
                  <tr key={i.id_invitacion}>
                    <td className="pequeno">
                      {i.torres.map((t) => t.nombre).join(', ')}
                      {varios && i.cliente && <span className="muted"> · {i.cliente}</span>}
                    </td>
                    <td className="pequeno">{i.descripcion || <span className="muted">—</span>}</td>
                    <td>
                      {i.usos} / {i.max_usos}
                      {i.por_confirmar > 0 && <span className="muted pequeno"> · {i.por_confirmar} por confirmar</span>}
                    </td>
                    <td className="pequeno">{fechaHora(i.vence_en)}</td>
                    <td>
                      <span className={`insignia ${ETIQUETA_INVITACION[i.estado].clase}`}>{ETIQUETA_INVITACION[i.estado].texto}</span>
                    </td>
                    <td>
                      {i.estado !== 'anulada' && (
                        <Boton pequeno variante="fantasma" icono={Ban} onClick={() => void anular(i)}>
                          Anular
                        </Boton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <Modal titulo="Nuevo enlace de invitación" abierto={!!form} onCerrar={() => setForm(null)}>
        {form && (
          <form className="formulario" onSubmit={crear} noValidate>
            <SeleccionMultiple
              etiqueta={varios ? 'Torres a las que tendrán acceso (de un mismo cliente)' : 'Torres a las que tendrán acceso'}
              opciones={torres.filter((t) => t.estado === 'activo').map((t) => ({ id: t.id_instalacion, texto: etiqueta(t) }))}
              seleccion={form.torres}
              alCambiar={(ids) => setForm({ ...form, torres: ids })}
              error={errores.torres}
            />
            <Campo etiqueta="Válido por (días)" type="number" min={1} max={30} inputMode="numeric" value={form.dias} onChange={(e) => setForm({ ...form, dias: e.target.value })} error={errores.dias} />
            <Campo etiqueta="Máximo de personas" type="number" min={1} max={500} inputMode="numeric" value={form.max_usos} onChange={(e) => setForm({ ...form, max_usos: e.target.value })} error={errores.max_usos} ayuda="Cuando se llena el cupo, el enlace deja de funcionar." />
            <Campo etiqueta="Descripción (opcional)" maxLength={120} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} ayuda="Por ejemplo: «Turno mañana, temporada 2027»." />
            <p className="muted pequeno">Rol que se otorga: Encargado de cultivo (fijo).{varios ? ' Para otros roles use «Nuevo usuario».' : ''}</p>
            {errores.general && (
              <div className="aviso fondo-critico" role="alert">
                <p>{errores.general}</p>
              </div>
            )}
            <div className="acciones">
              <Boton type="button" variante="fantasma" onClick={() => setForm(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" variante="primario" cargando={enviando}>
                Crear enlace
              </Boton>
            </div>
          </form>
        )}
      </Modal>

      <Modal titulo="Enlace de invitación" abierto={!!enlace} onCerrar={() => setEnlace(null)}>
        <p style={{ marginBottom: 8 }}>
          Comparta este enlace con el personal de <strong>{enlace?.torres}</strong> (WhatsApp, correo…). Vence el {enlace ? fechaHora(enlace.vence_en) : ''}. <strong>Se muestra una sola vez.</strong>
        </p>
        <div className="credencial-unica" style={{ wordBreak: 'break-all' }}>
          {enlace?.url}
        </div>
        <div className="acciones" style={{ marginTop: 12 }}>
          <Boton variante="verde" onClick={() => void navigator.clipboard?.writeText(enlace?.url ?? '').then(() => avisar('Enlace copiado'))}>
            Copiar enlace
          </Boton>
          <Boton onClick={() => setEnlace(null)}>Entendido</Boton>
        </div>
      </Modal>
    </>
  );
}

/* =================================================================== Infraestructura (CU-08) */
interface DispositivoFila {
  id_dispositivo: number;
  nombre: string;
  id_instalacion: number;
  torre: string;
  estado: string;
  intervalo_muestreo_s: number;
  ultima_comunicacion: string | null;
  latitud: number | null;
  longitud: number | null;
  sensores: { id_sensor: number; id_tipo_variable: number; tipo_variable: string; unidad: string; estado: string }[];
}

export function Infraestructura() {
  const { puede, usuario } = useSesion();
  const escribir = puede('infraestructura.gestionar');
  const clientes = useClientes();
  const clientesActivos = (clientes.datos ?? []).filter((c) => c.estado === 'activo');
  // Supervisor y Encargado ven un solo cliente: no hace falta repetirlo en cada torre.
  const verCliente = !!usuario && !rolConCliente(usuario.rol);
  const avisar = useAvisos();
  const torres = useDatos<TorreFila[]>((s) => api.get('/torres', s), []);
  const disps = useDatos<DispositivoFila[]>((s) => api.get('/dispositivos', s), []);
  const usuarios = useDatos<UsuarioFila[]>((s) => api.get('/usuarios', s), [], { activo: puede('usuarios.gestionar') });
  const cat = useDatos<{ tipos_variable: { id_tipo_variable: number; nombre: string; unidad: string }[] }>((s) => api.get('/catalogos', s), []);
  const [modal, setModal] = useState<null | { tipo: 'torre' | 'dispositivo' | 'sensor' | 'baja' | 'asignar' | 'gps'; datos: Record<string, unknown> }>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [credencial, setCredencial] = useState<{ nombre: string; credencial: string } | null>(null);
  const refrescar = () => void Promise.all([torres.refrescar(), disps.refrescar()]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;
    const d = modal.datos;
    try {
      if (modal.tipo === 'torre') {
        if (!String(d.nombre ?? '').trim()) return setErrores({ nombre: 'Obligatorio' });
        const cliente = d.id_cliente ? { id_cliente: Number(d.id_cliente) } : {};
        if (!d.id_cliente && clientesActivos.length > 1) return setErrores({ id_cliente: 'Seleccione el cliente' });
        if (d.id_instalacion) await api.patch(`/torres/${d.id_instalacion}`, { nombre: d.nombre, tipo: d.tipo, ubicacion: d.ubicacion, ...cliente });
        else await api.post('/torres', { nombre: d.nombre, tipo: d.tipo ?? 'aeroponica', ubicacion: d.ubicacion ?? '', ...cliente });
        avisar('Torre guardada');
      } else if (modal.tipo === 'dispositivo') {
        if (!String(d.nombre ?? '').trim()) return setErrores({ nombre: 'Obligatorio' });
        const gps = leerGps(d.latitud, d.longitud);
        if ('error' in gps) return setErrores({ gps: gps.error });
        const r = await api.post<{ credencial: string; nombre: string }>('/dispositivos', { nombre: d.nombre, id_instalacion: Number(d.id_instalacion), intervalo_muestreo_s: Number(d.intervalo ?? 60), ...gps });
        setCredencial({ nombre: r.nombre, credencial: r.credencial });
      } else if (modal.tipo === 'sensor') {
        await api.post('/sensores', { id_dispositivo: Number(d.id_dispositivo), id_tipo_variable: Number(d.id_tipo_variable ?? 1) });
        avisar('Sensor agregado');
      } else if (modal.tipo === 'baja') {
        if (!String(d.motivo ?? '').trim()) return setErrores({ motivo: 'Indique el motivo' });
        if (!d.confirmar) return setErrores({ confirmar: 'Debe confirmar la baja' });
        await api.patch(`${d.ruta}/baja`, { motivo: d.motivo, confirmar: true });
        avisar('Baja lógica registrada (el histórico se conserva)');
      } else if (modal.tipo === 'gps') {
        const gps = leerGps(d.latitud, d.longitud);
        if ('error' in gps) return setErrores({ gps: gps.error });
        await api.patch(`/dispositivos/${d.id_dispositivo}`, gps);
        avisar(gps.latitud === null ? 'Ubicación borrada' : 'Ubicación guardada');
      } else if (modal.tipo === 'asignar') {
        await api.put(`/torres/${d.id_instalacion}/usuarios`, { usuarios: d.usuarios });
        avisar('Responsables actualizados');
      }
      setModal(null);
      refrescar();
    } catch (x) {
      const a = x as ApiError;
      setErrores({ general: a.message, nombre: a.campo('nombre') ?? (a.codigo === 'NOMBRE_DUPLICADO' ? a.message : ''), gps: a.campo('longitud') ?? a.campo('latitud') ?? '' });
    }
  }
  async function regenerar(dv: DispositivoFila) {
    if (!window.confirm(`¿Regenerar la credencial de ${dv.nombre}? La actual dejará de funcionar de inmediato.`)) return;
    try {
      const r = await api.post<{ credencial: string }>(`/dispositivos/${dv.id_dispositivo}/credencial`);
      setCredencial({ nombre: dv.nombre, credencial: r.credencial });
      refrescar();
    } catch (x) {
      avisar((x as ApiError).message);
    }
  }
  const abrir = (tipo: NonNullable<typeof modal>['tipo'], datos: Record<string, unknown> = {}) => (setErrores({}), setModal({ tipo, datos }));
  const set = (k: string, v: unknown) => setModal((m) => (m ? { ...m, datos: { ...m.datos, [k]: v } } : m));

  return (
    <>
      <BarraSuperior />
      <Encabezado
        titulo="Infraestructura"
        descripcion={escribir ? 'Torres → dispositivos AquaBrain → sensores (CU-08). Las bajas son lógicas y conservan el histórico.' : 'Solo lectura para su rol (Tabla 48).'}
        acciones={
          escribir && (
            <>
              <Boton variante="secundario" icono={Plus} onClick={() => abrir('torre', { tipo: 'aeroponica', id_cliente: clientesActivos.length === 1 ? clientesActivos[0].id_cliente : undefined })}>
                Torre
              </Boton>
              <Boton variante="primario" icono={Plus} onClick={() => abrir('dispositivo', { id_instalacion: torres.datos?.find((t) => t.estado === 'activo')?.id_instalacion, intervalo: 60 })}>
                Dispositivo
              </Boton>
            </>
          )
        }
      />
      <MensajeError error={torres.error ?? disps.error} />
      {!torres.datos || !disps.datos ? (
        <Esqueleto n={3} alto={140} />
      ) : (
        <div className="rejilla rejilla-torres">
          {torres.datos.map((t) => (
            <Tarjeta
              key={t.id_instalacion}
              titulo={t.nombre}
              descripcion={`${verCliente ? `${t.cliente} · ` : ''}${t.tipo === 'aeroponica' ? 'Aeropónica' : 'Hidropónica'} · ${t.ubicacion || 'sin ubicación'}`}
              acciones={<span className={`insignia ${t.estado === 'activo' ? 'e-normal' : 'e-neutro'}`}>{t.estado === 'activo' ? 'Activa' : 'De baja'}</span>}
            >
              <p className="pequeno muted" style={{ marginBottom: 8 }}>
                Responsables: {t.responsables.map((r) => r.nombre).join(', ') || 'sin asignar'}
              </p>
              <ul className="lista-items">
                {(disps.datos ?? [])
                  .filter((d) => d.id_instalacion === t.id_instalacion)
                  .map((d) => (
                    <li key={d.id_dispositivo} className="item" style={{ flexDirection: 'column' }}>
                      <div className="item-titulo">
                        {d.nombre} <span className={`insignia ${d.estado === 'baja' ? 'e-neutro' : d.estado === 'sin_senal' ? 'e-sin-senal' : 'e-normal'}`}>{d.estado === 'baja' ? 'De baja' : d.estado === 'sin_senal' ? 'Sin señal' : 'Activo'}</span>
                      </div>
                      <p className="muted pequeno">
                        Intervalo {d.intervalo_muestreo_s} s · última comunicación {hace(d.ultima_comunicacion)}
                      </p>
                      {d.latitud != null ? <EnlaceGps latitud={d.latitud} longitud={d.longitud} /> : <p className="muted pequeno">Sin ubicación GPS</p>}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {d.sensores.map((s) => (
                          <span key={s.id_sensor} className={`insignia ${s.estado === 'activo' ? 'e-neutro' : 'e-sin-senal'}`} style={{ fontWeight: 500 }}>
                            #{s.id_sensor} {s.tipo_variable}
                            {s.estado !== 'activo' && ' (baja)'}
                            {escribir && s.estado === 'activo' && d.estado !== 'baja' && (
                              <button
                                className="boton-fantasma"
                                style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0, minHeight: 24 }}
                                aria-label={`Dar de baja sensor ${s.id_sensor}`}
                                onClick={() => abrir('baja', { ruta: `/sensores/${s.id_sensor}`, nombre: `sensor #${s.id_sensor} (${s.tipo_variable})` })}
                              >
                                <Trash2 size={12} aria-hidden />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      {escribir && d.estado !== 'baja' && (
                        <div className="acciones" style={{ justifyContent: 'flex-start' }}>
                          <Boton pequeno variante="fantasma" icono={Plus} onClick={() => abrir('sensor', { id_dispositivo: d.id_dispositivo, id_tipo_variable: 1 })}>
                            Sensor
                          </Boton>
                          <Boton pequeno variante="fantasma" icono={KeyRound} onClick={() => void regenerar(d)}>
                            Credencial
                          </Boton>
                          <Boton pequeno variante="fantasma" icono={MapPin} onClick={() => abrir('gps', { id_dispositivo: d.id_dispositivo, nombre: d.nombre, latitud: d.latitud ?? '', longitud: d.longitud ?? '' })}>
                            Ubicación
                          </Boton>
                          <Boton pequeno variante="fantasma" onClick={() => abrir('baja', { ruta: `/dispositivos/${d.id_dispositivo}`, nombre: d.nombre })}>
                            Dar de baja
                          </Boton>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
              {escribir && t.estado === 'activo' && (
                <div className="acciones" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
                  <Boton pequeno variante="fantasma" onClick={() => abrir('torre', { ...t })}>
                    Editar
                  </Boton>
                  <Boton pequeno variante="fantasma" onClick={() => abrir('asignar', { id_instalacion: t.id_instalacion, id_cliente: t.id_cliente, nombre: t.nombre, usuarios: t.responsables.filter((r) => r.rol === 'encargado').map((r) => r.id_usuario) })}>
                    Responsables
                  </Boton>
                  <Boton pequeno variante="fantasma" onClick={() => abrir('baja', { ruta: `/torres/${t.id_instalacion}`, nombre: t.nombre })}>
                    Dar de baja
                  </Boton>
                </div>
              )}
            </Tarjeta>
          ))}
        </div>
      )}

      <Modal
        titulo={{ torre: 'Torre', dispositivo: 'Nuevo dispositivo AquaBrain', sensor: 'Nuevo sensor', baja: `Dar de baja ${String(modal?.datos.nombre ?? '')}`, asignar: `Responsables de ${String(modal?.datos.nombre ?? '')}`, gps: `Ubicación GPS de ${String(modal?.datos.nombre ?? '')}` }[modal?.tipo ?? 'torre']}
        abierto={!!modal}
        onCerrar={() => setModal(null)}
      >
        {modal && (
          <form className="formulario" onSubmit={enviar} noValidate>
            {modal.tipo === 'torre' && (
              <>
                <Campo etiqueta="Nombre" value={String(modal.datos.nombre ?? '')} onChange={(e) => set('nombre', e.target.value)} error={errores.nombre || undefined} />
                <Selector etiqueta="Tipo" value={String(modal.datos.tipo ?? 'aeroponica')} onChange={(e) => set('tipo', e.target.value)}>
                  <option value="aeroponica">Aeropónica</option>
                  <option value="hidroponica">Hidropónica</option>
                </Selector>
                <Campo etiqueta="Ubicación" value={String(modal.datos.ubicacion ?? '')} onChange={(e) => set('ubicacion', e.target.value)} />
                {clientesActivos.length > 0 && (
                  <Selector
                    etiqueta="Cliente (RN-11)"
                    value={String(modal.datos.id_cliente ?? '')}
                    onChange={(e) => set('id_cliente', e.target.value ? Number(e.target.value) : undefined)}
                    error={errores.id_cliente || undefined}
                  >
                    <option value="">Seleccione…</option>
                    {clientesActivos.map((c) => (
                      <option key={c.id_cliente} value={c.id_cliente}>
                        {c.nombre}
                      </option>
                    ))}
                  </Selector>
                )}
                {!!modal.datos.id_instalacion && (
                  <p className="muted pequeno">Al cambiar de cliente, la torre deja de estar asignada a sus Encargados. Solo se mueven torres del «Cliente inicial» o sin dispositivos.</p>
                )}
              </>
            )}
            {(modal.tipo === 'gps' || modal.tipo === 'dispositivo') && (
              <fieldset className="campo-grupo">
                <legend className="pequeno">Ubicación GPS {modal.tipo === 'dispositivo' && '(opcional)'}</legend>
                <div className="fila-2">
                  <Campo etiqueta="Latitud" inputMode="decimal" placeholder="-33.45" value={String(modal.datos.latitud ?? '')} onChange={(e) => set('latitud', e.target.value)} />
                  <Campo etiqueta="Longitud" inputMode="decimal" placeholder="-70.66" value={String(modal.datos.longitud ?? '')} onChange={(e) => set('longitud', e.target.value)} />
                </div>
                {errores.gps ? <span className="campo-error">{errores.gps}</span> : <p className="muted pequeno">Ingreso manual (el AquaBrain no tiene GPS). Deje ambos vacíos para no guardar ubicación.</p>}
              </fieldset>
            )}
            {modal.tipo === 'dispositivo' && (
              <>
                <Campo etiqueta="Nombre" value={String(modal.datos.nombre ?? '')} onChange={(e) => set('nombre', e.target.value)} error={errores.nombre || undefined} />
                <Selector etiqueta="Torre" value={String(modal.datos.id_instalacion ?? '')} onChange={(e) => set('id_instalacion', e.target.value)}>
                  {torres.datos
                    ?.filter((t) => t.estado === 'activo')
                    .map((t) => (
                      <option key={t.id_instalacion} value={t.id_instalacion}>
                        {t.nombre}
                      </option>
                    ))}
                </Selector>
                <Campo etiqueta="Intervalo de muestreo (s)" type="number" min={5} max={3600} value={String(modal.datos.intervalo ?? 60)} onChange={(e) => set('intervalo', e.target.value)} ayuda="«Sin señal» se declara tras 3 intervalos sin comunicación." />
              </>
            )}
            {modal.tipo === 'sensor' && (
              <Selector etiqueta="Tipo de variable" value={String(modal.datos.id_tipo_variable ?? 1)} onChange={(e) => set('id_tipo_variable', e.target.value)}>
                {cat.datos?.tipos_variable.map((t) => (
                  <option key={t.id_tipo_variable} value={t.id_tipo_variable}>
                    {t.nombre} ({t.unidad})
                  </option>
                ))}
              </Selector>
            )}
            {modal.tipo === 'baja' && (
              <>
                <Aviso tono="fondo-advertencia">La baja es lógica: se conserva el histórico de mediciones y, si es un dispositivo, su credencial queda revocada.</Aviso>
                <Campo etiqueta="Motivo" value={String(modal.datos.motivo ?? '')} onChange={(e) => set('motivo', e.target.value)} error={errores.motivo} />
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!modal.datos.confirmar} onChange={(e) => set('confirmar', e.target.checked)} /> Confirmo la baja
                </label>
                {errores.confirmar && <span className="campo-error">{errores.confirmar}</span>}
              </>
            )}
            {modal.tipo === 'asignar' && (
              <SeleccionMultiple
                etiqueta="Encargados responsables"
                nombreItem="encargado"
                femenino={false}
                opciones={(usuarios.datos ?? [])
                  .filter((u) => u.activo && u.rol === 'encargado' && u.id_cliente === modal.datos.id_cliente)
                  .map((u) => ({ id: u.id_usuario, texto: `${u.nombre} (${u.email})` }))}
                seleccion={(modal.datos.usuarios as number[]) ?? []}
                alCambiar={(ids) => set('usuarios', ids)}
              />
            )}
            {errores.general && (
              <div className="aviso fondo-critico" role="alert">
                <p>{errores.general}</p>
              </div>
            )}
            <div className="acciones">
              <Boton type="button" variante="fantasma" onClick={() => setModal(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" variante={modal.tipo === 'baja' ? 'peligro' : 'primario'}>
                {modal.tipo === 'baja' ? 'Dar de baja' : 'Guardar'}
              </Boton>
            </div>
          </form>
        )}
      </Modal>
      <Modal titulo="Credencial del dispositivo" abierto={!!credencial} onCerrar={() => setCredencial(null)}>
        <p style={{ marginBottom: 8 }}>
          Credencial de <strong>{credencial?.nombre}</strong>. Cárguela en la placa. <strong>Se muestra una sola vez</strong>; el servidor guarda solo su resumen SHA-256.
        </p>
        <div className="credencial-unica">{credencial?.credencial}</div>
        <div className="acciones" style={{ marginTop: 12 }}>
          <Boton variante="verde" onClick={() => void navigator.clipboard?.writeText(credencial?.credencial ?? '')}>
            Copiar
          </Boton>
          <Boton onClick={() => setCredencial(null)}>Entendido</Boton>
        </div>
      </Modal>
    </>
  );
}

/* =================================================================== Umbrales (CU-07) */
interface Umbral {
  id_umbral: number;
  severidad: 'advertencia' | 'critica';
  valor_min: number;
  valor_max: number;
  version: number;
  actualizado_en: string;
}
export function Umbrales() {
  const { puede } = useSesion();
  const escribir = puede('umbrales.gestionar');
  const avisar = useAvisos();
  const disps = useDatos<DispositivoFila[]>((s) => api.get('/dispositivos', s), []);
  const cat = useDatos<{ tipos_variable: { id_tipo_variable: number; min_fisico: number; max_fisico: number }[]; rangos_referencia: { id_especie: number; id_tipo_variable: number; valor_min: number; valor_max: number }[]; especies: { id_especie: number; nombre: string }[] }>(
    (s) => api.get('/catalogos', s),
    [],
  );
  const sensores = (disps.datos ?? []).filter((d) => d.estado !== 'baja').flatMap((d) => d.sensores.filter((s) => s.estado === 'activo').map((s) => ({ ...s, torre: d.torre, dispositivo: d.nombre })));
  const [idSensor, setSensor] = useState<number | null>(null);
  const sensor = sensores.find((s) => s.id_sensor === idSensor) ?? sensores[0];
  const umbrales = useDatos<Umbral[]>((s) => api.get(`/sensores/${sensor!.id_sensor}/umbrales`, s), [sensor?.id_sensor], { activo: !!sensor });
  const [form, setForm] = useState<Record<string, { min: string; max: string; error?: string }>>({});
  const fisico = cat.datos?.tipos_variable.find((t) => t.id_tipo_variable === sensor?.id_tipo_variable);
  const sugerencias = cat.datos?.rangos_referencia.filter((r) => r.id_tipo_variable === sensor?.id_tipo_variable) ?? [];

  async function guardar(sev: 'advertencia' | 'critica') {
    const f = form[sev];
    const actual = umbrales.datos?.find((u) => u.severidad === sev);
    const min = Number(f?.min);
    const max = Number(f?.max);
    let error: string | undefined;
    if (f?.min === '' || f?.max === '' || Number.isNaN(min) || Number.isNaN(max)) error = 'Ingrese mínimo y máximo';
    else if (min >= max) error = 'El mínimo debe ser menor que el máximo';
    else if (fisico && (min < fisico.min_fisico || max > fisico.max_fisico)) error = `Fuera del rango físico (${fisico.min_fisico}–${fisico.max_fisico})`;
    if (error) return setForm({ ...form, [sev]: { ...f, error } });
    try {
      await api.put(`/sensores/${sensor!.id_sensor}/umbrales`, { severidad: sev, valor_min: min, valor_max: max, version: actual?.version });
      avisar('Umbral guardado y auditado. Se aplica desde la próxima medición.');
      setForm({ ...form, [sev]: { min: '', max: '' } });
      void umbrales.refrescar();
    } catch (x) {
      const a = x as ApiError;
      setForm({ ...form, [sev]: { ...f, error: a.campos[0]?.mensaje ?? a.message } });
      if (a.status === 409) void umbrales.refrescar();
    }
  }
  async function desactivar(u: Umbral) {
    if (!window.confirm('¿Desactivar este umbral? El sensor dejará de evaluarse para esa severidad.')) return;
    try {
      await api.patch(`/umbrales/${u.id_umbral}/desactivar`);
      avisar('Umbral desactivado');
      void umbrales.refrescar();
    } catch (x) {
      avisar((x as ApiError).message);
    }
  }

  return (
    <>
      <BarraSuperior />
      <Encabezado titulo="Umbrales" descripcion={escribir ? 'Rangos por sensor y severidad (CU-07). Control de versión optimista y auditoría de cada cambio.' : 'Solo lectura para su rol (Tabla 48).'} />
      {!disps.datos ? (
        <Esqueleto alto={200} />
      ) : !sensor ? (
        <Vacio titulo="No hay sensores activos" />
      ) : (
        <div className="rejilla rejilla-principal">
          <Tarjeta titulo="Sensor">
            <Selector etiqueta="Torre · dispositivo · variable" value={sensor.id_sensor} onChange={(e) => setSensor(Number(e.target.value))}>
              {sensores.map((s) => (
                <option key={s.id_sensor} value={s.id_sensor}>
                  {s.torre} · {s.dispositivo} · {s.tipo_variable} (#{s.id_sensor})
                </option>
              ))}
            </Selector>
            <p className="muted pequeno" style={{ marginTop: 8 }}>
              Rango físico de la variable: {fisico ? `${fisico.min_fisico} – ${fisico.max_fisico} ${sensor.unidad}` : '—'}
            </p>
            {sugerencias.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong className="pequeno">Rangos de referencia por especie</strong>
                <ul className="pequeno" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {sugerencias.map((r) => (
                    <li key={r.id_especie}>
                      {cat.datos?.especies.find((e) => e.id_especie === r.id_especie)?.nombre}: {r.valor_min} – {r.valor_max}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Tarjeta>
          <div className="rejilla">
            {(['advertencia', 'critica'] as const).map((sev) => {
              const u = umbrales.datos?.find((x) => x.severidad === sev);
              const f = form[sev] ?? { min: '', max: '' };
              return (
                <Tarjeta key={sev} titulo={sev === 'critica' ? 'Umbral crítico' : 'Umbral de advertencia'} descripcion={u ? `Vigente: ${numero(u.valor_min)} – ${numero(u.valor_max)} ${sensor.unidad} · versión ${u.version} · ${fechaHora(u.actualizado_en)}` : 'Sin umbral: no se evalúa (RN-02)'}>
                  {escribir ? (
                    <div className="formulario formulario-2">
                      <Campo etiqueta="Mínimo" type="number" step="any" inputMode="decimal" placeholder={u ? String(u.valor_min) : ''} value={f.min} onChange={(e) => setForm({ ...form, [sev]: { ...f, min: e.target.value, error: undefined } })} />
                      <Campo etiqueta="Máximo" type="number" step="any" inputMode="decimal" placeholder={u ? String(u.valor_max) : ''} value={f.max} onChange={(e) => setForm({ ...form, [sev]: { ...f, max: e.target.value, error: undefined } })} error={f.error} />
                      <div className="acciones" style={{ gridColumn: '1 / -1' }}>
                        {u && (
                          <Boton variante="fantasma" onClick={() => void desactivar(u)}>
                            Desactivar
                          </Boton>
                        )}
                        <Boton variante="primario" icono={ShieldCheck} onClick={() => void guardar(sev)}>
                          {u ? 'Actualizar' : 'Crear'}
                        </Boton>
                      </div>
                    </div>
                  ) : (
                    <p className="muted pequeno">Solo lectura.</p>
                  )}
                </Tarjeta>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/* =================================================================== Auditoría (CU-09) */
interface FilaAuditoria {
  id_log: string;
  ts: string;
  accion: string;
  entidad: string;
  id_entidad: string | null;
  detalle: Record<string, unknown> | null;
  ip: string | null;
  usuario: string | null;
}
export function Auditoria() {
  const [accion, setAccion] = useState('');
  const [pagina, setPagina] = useState(1);
  const r = useDatos<{ datos: FilaAuditoria[]; total: number; acciones: string[] }>((s) => api.get(`/auditoria${qs({ accion, pagina, por_pagina: 25 })}`, s), [accion, pagina]);
  return (
    <>
      <BarraSuperior />
      <Encabezado titulo="Auditoría" descripcion="Registro inmutable de acciones: solo lectura, nadie puede modificarlo ni eliminarlo (RN-07)." />
      <Tarjeta etiqueta="Registro de auditoría">
        <div className="filtros" style={{ marginBottom: 12 }}>
          <Selector etiqueta="Acción" value={accion} onChange={(e) => (setAccion(e.target.value), setPagina(1))}>
            <option value="">Todas</option>
            {r.datos?.acciones.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Selector>
        </div>
        <MensajeError error={r.error} />
        {!r.datos ? (
          <Esqueleto n={4} alto={40} />
        ) : (
          <>
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Usuario</th>
                    <th scope="col">Acción</th>
                    <th scope="col">Entidad</th>
                    <th scope="col">Detalle</th>
                    <th scope="col">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {r.datos.datos.map((f) => (
                    <tr key={f.id_log}>
                      <td className="dato">{fechaHora(f.ts)}</td>
                      <td>{f.usuario ?? 'Sistema'}</td>
                      <td>{f.accion}</td>
                      <td>
                        {f.entidad} {f.id_entidad && `#${f.id_entidad}`}
                      </td>
                      <td className="pequeno" style={{ maxWidth: 360, wordBreak: 'break-word' }}>
                        <code>{f.detalle ? JSON.stringify(f.detalle) : ''}</code>
                      </td>
                      <td className="pequeno">{f.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador pagina={pagina} total={r.datos.total} porPagina={25} onCambio={setPagina} />
          </>
        )}
      </Tarjeta>
    </>
  );
}

/* =================================================================== Perfil */
export function Perfil() {
  const { usuario, actualizar, expiraEn } = useSesion();
  const avisar = useAvisos();
  const [f, setF] = useState({ actual: '', nueva: '', repetir: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  async function cambiar(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!f.actual) err.actual = 'Obligatorio';
    if (f.nueva.length < 10) err.nueva = 'Al menos 10 caracteres';
    else if (!/[A-Za-z]/.test(f.nueva) || !/[0-9]/.test(f.nueva)) err.nueva = 'Debe incluir letras y números';
    if (f.nueva !== f.repetir) err.repetir = 'No coincide';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      const r = await api.post<{ aviso_correo?: boolean }>('/auth/cambiar-password', { actual: f.actual, nueva: f.nueva });
      avisar(
        r?.aviso_correo
          ? 'Contraseña actualizada y aviso enviado por correo. Inicie sesión con la nueva contraseña.'
          : 'Contraseña actualizada. Inicie sesión con la nueva contraseña.',
      );
      actualizar({ debe_cambiar_password: false });
      setF({ actual: '', nueva: '', repetir: '' });
    } catch (x) {
      const a = x as ApiError;
      setErrores({ actual: a.campo('actual') ?? '', nueva: a.campo('nueva') ?? '', general: a.campos.length ? '' : a.message });
    } finally {
      setEnviando(false);
    }
  }
  if (!usuario) return null;
  return (
    <>
      <BarraSuperior />
      <Encabezado titulo="Perfil" />
      <div className="rejilla rejilla-principal">
        <Tarjeta titulo="Cambiar contraseña">
          {usuario.debe_cambiar_password && (
            <div style={{ marginBottom: 12 }}>
              <Aviso tono="fondo-advertencia" titulo="Debe cambiar su contraseña temporal" />
            </div>
          )}
          <form className="formulario" onSubmit={cambiar} noValidate>
            <Campo etiqueta="Contraseña actual" type="password" autoComplete="current-password" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} error={errores.actual || undefined} />
            <Campo etiqueta="Nueva contraseña" type="password" autoComplete="new-password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} error={errores.nueva || undefined} ayuda="Mínimo 10 caracteres, con letras y números." />
            <Campo etiqueta="Repetir nueva contraseña" type="password" autoComplete="new-password" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} error={errores.repetir} />
            {errores.general && (
              <div className="aviso fondo-critico" role="alert">
                <p>{errores.general}</p>
              </div>
            )}
            <div className="acciones">
              <Boton type="submit" variante="primario" cargando={enviando}>
                Actualizar contraseña
              </Boton>
            </div>
          </form>
        </Tarjeta>
        <Tarjeta titulo="Mi cuenta">
          <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
            <div>
              <dt className="muted pequeno">Nombre</dt>
              <dd style={{ margin: 0 }}>{usuario.nombre}</dd>
            </div>
            <div>
              <dt className="muted pequeno">Email</dt>
              <dd style={{ margin: 0 }}>{usuario.email}</dd>
            </div>
            <div>
              <dt className="muted pequeno">Rol</dt>
              <dd style={{ margin: 0 }}>{ETIQUETA_ROL[usuario.rol]}</dd>
            </div>
            {usuario.cliente && (
              <div>
                <dt className="muted pequeno">Cliente</dt>
                <dd style={{ margin: 0 }}>{usuario.cliente}</dd>
              </div>
            )}
            <div>
              <dt className="muted pequeno">Sesión válida hasta</dt>
              <dd style={{ margin: 0 }}>{fechaHora(expiraEn)}</dd>
            </div>
          </dl>
        </Tarjeta>
        {/* El Técnico no recibe correos de alertas de cultivo: sus incidencias llegan en la aplicación (RN-13). */}
        {!usuario.debe_cambiar_password && usuario.rol !== 'tecnico' && <PreferenciaAvisos />}
      </div>
    </>
  );
}

/** D-32: el ALERTA_URGENTE_MIN por defecto del backend. */
const MINUTOS_URGENTE = 30;
const OPCIONES_AVISO: { valor: AvisoAlertas; titulo: string; detalle: string; soloAdmin?: boolean }[] = [
  { valor: 'todas', titulo: 'Todas las alertas críticas', detalle: 'Un correo apenas se genera una alerta crítica en sus torres.' },
  { valor: 'urgentes', titulo: 'Solo las urgentes', detalle: `Solo si una alerta crítica sigue sin resolverse después de ${MINUTOS_URGENTE} minutos.` },
  { valor: 'ninguna', titulo: 'No recibir alertas', detalle: 'Las alertas se siguen viendo en la aplicación.', soloAdmin: true },
];

function PreferenciaAvisos() {
  const { usuario, actualizar } = useSesion();
  const avisar = useAvisos();
  const [guardando, setGuardando] = useState<AvisoAlertas | null>(null);
  const [error, setError] = useState('');
  if (!usuario) return null;
  async function elegir(valor: AvisoAlertas) {
    if (valor === usuario!.aviso_alertas || guardando) return;
    setGuardando(valor);
    setError('');
    try {
      const r = await api.patch<{ aviso_alertas: AvisoAlertas }>('/auth/avisos', { aviso_alertas: valor });
      actualizar({ aviso_alertas: r.aviso_alertas });
      avisar('Preferencia de avisos guardada.');
    } catch (x) {
      setError((x as ApiError).message);
    } finally {
      setGuardando(null);
    }
  }
  const opciones = OPCIONES_AVISO.filter((o) => !o.soloAdmin || esAdministracion(usuario.rol));
  return (
    <Tarjeta titulo="Avisos por correo">
      <fieldset className="opciones-aviso" disabled={guardando !== null}>
        <legend className="muted pequeno">
          Alertas críticas de {usuario.rol === 'encargado' ? 'sus torres' : usuario.rol === 'supervisor' ? `las torres de ${usuario.cliente ?? 'su cliente'}` : 'todas las torres'}
        </legend>
        {opciones.map((o) => (
          <label key={o.valor} className="opcion-aviso" data-activa={usuario.aviso_alertas === o.valor || undefined}>
            <input type="radio" name="aviso_alertas" value={o.valor} checked={usuario.aviso_alertas === o.valor} onChange={() => elegir(o.valor)} />
            <span>
              <strong>{o.titulo}</strong>
              <span className="muted pequeno">{guardando === o.valor ? 'Guardando…' : o.detalle}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <div className="aviso fondo-critico" role="alert" style={{ marginTop: 12 }}>
          <p>{error}</p>
        </div>
      )}
      <p className="muted pequeno" style={{ marginTop: 12, marginBottom: 0 }}>
        Los correos de seguridad de su cuenta (cambio de contraseña, enlaces de acceso) se envían siempre.
      </p>
    </Tarjeta>
  );
}
