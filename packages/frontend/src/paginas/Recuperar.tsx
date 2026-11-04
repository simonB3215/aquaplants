import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CircleCheck, Droplets, KeyRound, Mail } from 'lucide-react';
import { api, ApiError } from '../api/cliente';
import { Aviso, Boton, Campo } from '../componentes/ui';

/** Tarjeta de acceso compartida (mismo aspecto que «Iniciar sesión»). */
export function TarjetaAcceso({ titulo, descripcion, children }: { titulo: string; descripcion: string; children: ReactNode }) {
  return (
    <main className="login">
      <div className="login-tarjeta vidrio">
        <div className="marca" style={{ padding: 0, marginBottom: 24 }}>
          <span className="marca-logo">
            <Droplets size={20} aria-hidden />
          </span>
          <span>
            AquaPlants
            <small>Monitoreo AquaBrain</small>
          </span>
        </div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 6 }}>{titulo}</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          {descripcion}
        </p>
        {children}
      </div>
    </main>
  );
}

export function VolverAlLogin() {
  return (
    <Link to="/" className="enlace-acceso">
      <ArrowLeft size={16} aria-hidden />
      Volver a iniciar sesión
    </Link>
  );
}

export const errorDeRed = (a: ApiError) => (a.status === 0 ? 'Sin conexión con el servidor. Intente nuevamente.' : a.message);

/** Paso 1: pedir el enlace por correo. La respuesta es la misma exista o no la cuenta. */
export function OlvideContrasena() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [general, setGeneral] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!v) return setError('Ingrese su email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setError('Formato de email inválido');
    setError(undefined);
    setGeneral(undefined);
    setEnviando(true);
    try {
      await api.post('/auth/olvide-password', { email: v });
      setEnviado(true);
    } catch (x) {
      setGeneral(errorDeRed(x as ApiError));
    } finally {
      setEnviando(false);
    }
  }

  if (enviado)
    return (
      <TarjetaAcceso titulo="Revise su correo" descripcion="Si el email corresponde a una cuenta activa, le enviamos un enlace para elegir una contraseña nueva.">
        <div className="formulario">
          <Aviso tono="fondo-normal" icono={Mail} titulo="El enlace vence en 30 minutos y sirve una sola vez">
            Si no lo ve en unos minutos, revise las carpetas de spam o promociones.
          </Aviso>
          <VolverAlLogin />
        </div>
      </TarjetaAcceso>
    );

  return (
    <TarjetaAcceso titulo="¿Olvidó su contraseña?" descripcion="Ingrese el email de su cuenta y le enviaremos un enlace para restablecerla.">
      <form className="formulario" onSubmit={enviar} noValidate>
        <Campo etiqueta="Email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
        {general && (
          <div className="aviso fondo-critico" role="alert">
            <p>{general}</p>
          </div>
        )}
        <Boton type="submit" variante="primario" icono={Mail} cargando={enviando}>
          Enviar enlace
        </Boton>
        <VolverAlLogin />
      </form>
    </TarjetaAcceso>
  );
}

/** Lee el token del fragmento (#token=…): el fragmento no viaja al servidor ni queda en registros. */
function leerToken(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
}

/** Paso 2: elegir la contraseña nueva con el enlace recibido. */
export function RestablecerContrasena() {
  const [token] = useState(leerToken);
  const [f, setF] = useState({ nueva: '', repetir: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enlaceInvalido, setEnlaceInvalido] = useState(!/^[A-Za-z0-9_-]{43}$/.test(token));
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [avisoCorreo, setAvisoCorreo] = useState(false);

  // Quita el token de la barra de direcciones (y del historial) apenas se lee.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (f.nueva.length < 10) err.nueva = 'Al menos 10 caracteres';
    else if (!/[A-Za-z]/.test(f.nueva) || !/[0-9]/.test(f.nueva)) err.nueva = 'Debe incluir letras y números';
    if (f.nueva !== f.repetir) err.repetir = 'No coincide';
    setErrores(err);
    if (Object.keys(err).length) return;
    setEnviando(true);
    try {
      const r = await api.post<{ aviso_correo?: boolean }>('/auth/restablecer-password', { token, nueva: f.nueva });
      setAvisoCorreo(Boolean(r?.aviso_correo));
      setListo(true);
    } catch (x) {
      const a = x as ApiError;
      if (a.campo('token')) setEnlaceInvalido(true);
      else setErrores({ nueva: a.campo('nueva') ?? '', general: a.campos.length ? '' : errorDeRed(a) });
    } finally {
      setEnviando(false);
    }
  }

  if (listo)
    return (
      <TarjetaAcceso titulo="Contraseña actualizada" descripcion="Ya puede iniciar sesión con su contraseña nueva. Por seguridad se cerraron todas las sesiones abiertas.">
        <div className="formulario">
          {avisoCorreo && <Aviso tono="fondo-normal" icono={CircleCheck} titulo="Le enviamos un aviso por correo sobre este cambio" />}
          <Link to="/" className="boton boton-primario">
            Ir a iniciar sesión
          </Link>
        </div>
      </TarjetaAcceso>
    );

  if (enlaceInvalido)
    return (
      <TarjetaAcceso titulo="Enlace no válido" descripcion="El enlace está incompleto, ya se usó o expiró. Los enlaces sirven una sola vez durante 30 minutos.">
        <div className="formulario">
          <Link to="/olvide-contrasena" className="boton boton-primario">
            Solicitar un enlace nuevo
          </Link>
          <VolverAlLogin />
        </div>
      </TarjetaAcceso>
    );

  return (
    <TarjetaAcceso titulo="Elegir contraseña nueva" descripcion="Escriba su contraseña nueva. Al guardarla se cerrarán todas las sesiones abiertas.">
      <form className="formulario" onSubmit={enviar} noValidate>
        <Campo etiqueta="Nueva contraseña" type="password" autoComplete="new-password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} error={errores.nueva || undefined} ayuda="Mínimo 10 caracteres, con letras y números." />
        <Campo etiqueta="Repetir nueva contraseña" type="password" autoComplete="new-password" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} error={errores.repetir} />
        {errores.general && (
          <div className="aviso fondo-critico" role="alert">
            <p>{errores.general}</p>
          </div>
        )}
        <Boton type="submit" variante="primario" icono={KeyRound} cargando={enviando}>
          Guardar contraseña
        </Boton>
        <VolverAlLogin />
      </form>
    </TarjetaAcceso>
  );
}
