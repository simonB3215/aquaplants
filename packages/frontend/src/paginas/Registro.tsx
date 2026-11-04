import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Mail, UserPlus } from 'lucide-react';
import { api, ApiError } from '../api/cliente';
import { Aviso, Boton, Campo, Esqueleto } from '../componentes/ui';
import { errorDeRed, TarjetaAcceso, VolverAlLogin } from './Recuperar';

const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Lee un token del fragmento (#clave=…): el fragmento no viaja al servidor ni queda en registros. */
function leerFragmento(clave: string): string {
  return new URLSearchParams(window.location.hash.slice(1)).get(clave) ?? '';
}

/** Quita el token de la barra de direcciones (y del historial) apenas se lee. */
function useLimpiarFragmento() {
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
}

function fechaLarga(iso: string) {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' });
}

function EnlaceNoDisponible({ mensaje }: { mensaje?: string }) {
  return (
    <TarjetaAcceso titulo="Invitación no disponible" descripcion={mensaje ?? 'El enlace está incompleto, venció, fue anulado o ya no tiene cupos.'}>
      <div className="formulario">
        <Aviso tono="fondo-info" titulo="Pida un enlace nuevo al administrador de AquaPlants" />
        <VolverAlLogin />
      </div>
    </TarjetaAcceso>
  );
}

/** D-28 paso 1: la persona abre el enlace de invitación y crea su cuenta. */
export function Registro() {
  const [token] = useState(() => leerFragmento('invitacion'));
  useLimpiarFragmento();
  const [info, setInfo] = useState<{ torres: string[]; vence_en: string } | null>(null);
  const [invalida, setInvalida] = useState<string | null>(FORMATO_TOKEN.test(token) ? null : '');
  const [f, setF] = useState({ nombre: '', email: '', password: '', repetir: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    if (invalida !== null) return;
    api
      .post<{ torres: string[]; vence_en: string }>('/auth/invitacion', { token })
      .then(setInfo)
      .catch((x: ApiError) => setInvalida(x.status === 0 ? errorDeRed(x) : x.message));
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!f.nombre.trim()) err.nombre = 'Ingrese su nombre';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) err.email = 'Formato de email inválido';
    if (f.password.length < 10) err.password = 'Al menos 10 caracteres';
    else if (!/[A-Za-z]/.test(f.password) || !/[0-9]/.test(f.password)) err.password = 'Debe incluir letras y números';
    if (f.password !== f.repetir) err.repetir = 'No coincide';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      await api.post('/auth/registro', { token, nombre: f.nombre.trim(), email: f.email.trim(), password: f.password });
      setEnviado(true);
    } catch (x) {
      const a = x as ApiError;
      if (a.campo('token')) setInvalida(a.message);
      else setErrores({ nombre: a.campo('nombre') ?? '', email: a.campo('email') ?? '', password: a.campo('password') ?? '', general: a.campos.length ? '' : errorDeRed(a) });
    } finally {
      setEnviando(false);
    }
  }

  if (invalida !== null) return <EnlaceNoDisponible mensaje={invalida || undefined} />;

  if (enviado)
    return (
      <TarjetaAcceso titulo="Revise su correo" descripcion={`Le enviamos un enlace a ${f.email.trim()} para confirmar su email y activar la cuenta.`}>
        <div className="formulario">
          <Aviso tono="fondo-normal" icono={Mail} titulo="El enlace vence en 24 horas y sirve una sola vez">
            Si no lo ve en unos minutos, revise las carpetas de spam o promociones. Si ya tenía una cuenta con ese email, le avisamos por correo.
          </Aviso>
          <VolverAlLogin />
        </div>
      </TarjetaAcceso>
    );

  if (!info)
    return (
      <TarjetaAcceso titulo="Crear cuenta" descripcion="Verificando la invitación…">
        <Esqueleto n={3} alto={44} />
      </TarjetaAcceso>
    );

  return (
    <TarjetaAcceso titulo="Crear cuenta" descripcion="Le invitaron a AquaPlants. Complete sus datos para crear su cuenta.">
      <form className="formulario" onSubmit={enviar} noValidate>
        <Aviso tono="fondo-info" titulo={`Encargado de cultivo de: ${info.torres.join(', ') || '—'}`}>
          Invitación válida hasta el {fechaLarga(info.vence_en)}.
        </Aviso>
        <Campo etiqueta="Nombre y apellido" autoComplete="name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} error={errores.nombre || undefined} />
        <Campo etiqueta="Email" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={errores.email || undefined} />
        <Campo etiqueta="Contraseña" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={errores.password || undefined} ayuda="Mínimo 10 caracteres, con letras y números." />
        <Campo etiqueta="Repetir contraseña" type="password" autoComplete="new-password" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} error={errores.repetir} />
        {errores.general && (
          <div className="aviso fondo-critico" role="alert">
            <p>{errores.general}</p>
          </div>
        )}
        <Boton type="submit" variante="primario" icono={UserPlus} cargando={enviando}>
          Crear cuenta
        </Boton>
        <VolverAlLogin />
      </form>
    </TarjetaAcceso>
  );
}

/**
 * D-28 paso 2: confirmar el email. Se pide un clic (no se confirma al cargar)
 * para que un antivirus de correo que abra el enlace no active la cuenta solo.
 */
export function ConfirmarRegistro() {
  const [token] = useState(() => leerFragmento('token'));
  useLimpiarFragmento();
  const [error, setError] = useState<string | null>(FORMATO_TOKEN.test(token) ? null : 'El enlace está incompleto.');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    try {
      const r = await api.post<{ email: string }>('/auth/registro/confirmar', { token });
      setListo(r.email);
    } catch (x) {
      setError(errorDeRed(x as ApiError));
    } finally {
      setEnviando(false);
    }
  }

  if (listo)
    return (
      <TarjetaAcceso titulo="Cuenta activada" descripcion={`Su email ${listo} quedó confirmado. Ya puede iniciar sesión con la contraseña que eligió.`}>
        <div className="formulario">
          <Aviso tono="fondo-normal" icono={CircleCheck} titulo="Bienvenido a AquaPlants" />
          <Link to="/" className="boton boton-primario">
            Ir a iniciar sesión
          </Link>
        </div>
      </TarjetaAcceso>
    );

  if (error)
    return (
      <TarjetaAcceso titulo="No se pudo activar la cuenta" descripcion={error}>
        <div className="formulario">
          <Aviso tono="fondo-info" titulo="Vuelva a registrarse con el enlace de invitación o pida uno nuevo al administrador" />
          <VolverAlLogin />
        </div>
      </TarjetaAcceso>
    );

  return (
    <TarjetaAcceso titulo="Confirmar email" descripcion="Presione el botón para confirmar su email y activar su cuenta de AquaPlants.">
      <div className="formulario">
        <Boton variante="primario" icono={CircleCheck} cargando={enviando} onClick={() => void confirmar()}>
          Activar mi cuenta
        </Boton>
        <VolverAlLogin />
      </div>
    </TarjetaAcceso>
  );
}
