import { useState, type FormEvent } from 'react';
import { Droplets, LogIn } from 'lucide-react';
import { useSesion } from '../estado/sesion';
import { ApiError } from '../api/cliente';
import { Aviso, Boton, Campo } from '../componentes/ui';
import { IndicadorConexion } from '../componentes/Layout';

/** CU-02 Iniciar sesión: validación previa en la SPA; el backend decide. */
export function Login() {
  const { iniciar, motivoCierre } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errores, setErrores] = useState<{ email?: string; password?: string; general?: string }>({});
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const nuevos: typeof errores = {};
    if (!email.trim()) nuevos.email = 'Ingrese su email';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nuevos.email = 'Formato de email inválido';
    if (!password) nuevos.password = 'Ingrese su contraseña';
    setErrores(nuevos);
    if (Object.keys(nuevos).length) return;
    setEnviando(true);
    try {
      await iniciar(email.trim(), password);
    } catch (err) {
      const a = err as ApiError;
      setErrores({ general: a.status === 0 ? 'Sin conexión con el servidor. Intente nuevamente.' : a.message });
    } finally {
      setEnviando(false);
    }
  }

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
        <h1 style={{ fontSize: '1.5rem', marginBottom: 6 }}>Iniciar sesión</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Acceda con su cuenta para ver el estado de sus cultivos.
        </p>
        <div style={{ marginBottom: 12 }}>
          <IndicadorConexion />
        </div>
        {motivoCierre && (
          <div style={{ marginBottom: 12 }}>
            <Aviso tono="fondo-advertencia">{motivoCierre}</Aviso>
          </div>
        )}
        <form className="formulario" onSubmit={enviar} noValidate>
          <Campo etiqueta="Email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errores.email} />
          <Campo etiqueta="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errores.password} />
          {errores.general && (
            <div className="aviso fondo-critico" role="alert">
              <p>{errores.general}</p>
            </div>
          )}
          <Boton type="submit" variante="primario" icono={LogIn} cargando={enviando}>
            Ingresar
          </Boton>
          <p className="muted pequeno">La sesión dura 8 horas y se guarda solo en memoria: al recargar la página deberá ingresar de nuevo.</p>
        </form>
      </div>
    </main>
  );
}
