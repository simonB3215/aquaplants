import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { autorizado, type Accion, type Funcionalidad, type RespuestaLogin, type UsuarioSesion } from '@aquaplants/shared';
import { api } from '../api/cliente';

interface Sesion {
  usuario: UsuarioSesion | null;
  /** D-31: true mientras se intenta reanudar la sesión al cargar la página. */
  verificando: boolean;
  expiraEn: string | null;
  iniciar(email: string, password: string): Promise<void>;
  cerrar(): Promise<void>;
  actualizar(u: Partial<UsuarioSesion>): void;
  /** Ayuda visual según la Tabla 48. La autorización real la hace el backend. */
  puede(f: Funcionalidad, a?: Accion): boolean;
  motivoCierre: string | null;
}

const Ctx = createContext<Sesion | null>(null);

/**
 * El JWT de acceso vive solo en memoria (ES2 §6.1). D-31: al recargar la página se
 * pide uno nuevo con la cookie httpOnly de sesión (JavaScript no puede leerla), así
 * no hay que volver a iniciar sesión mientras la sesión de 8 h siga vigente.
 */
export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [expiraEn, setExpiraEn] = useState<string | null>(null);
  const [motivoCierre, setMotivo] = useState<string | null>(null);

  const limpiar = useCallback((motivo: string | null) => {
    api.establecerToken(null);
    setUsuario(null);
    setExpiraEn(null);
    setMotivo(motivo);
  }, []);

  useEffect(
    () =>
      api.suscribir((e) => {
        if (e === 'no_autenticado') limpiar('Su sesión expiró o fue revocada. Inicie sesión nuevamente.');
      }),
    [limpiar],
  );

  // D-31: reanudar la sesión al cargar (una sola vez).
  useEffect(() => {
    let vigente = true;
    api
      .post<RespuestaLogin>('/auth/sesion')
      .then((r) => {
        if (!vigente) return;
        api.establecerToken(r.token);
        setUsuario(r.usuario);
        setExpiraEn(r.expira_en);
      })
      .catch(() => {
        /* sin sesión: se muestra el inicio de sesión */
      })
      .finally(() => vigente && setVerificando(false));
    return () => {
      vigente = false;
    };
  }, []);

  // Expiración local del token (8 h).
  useEffect(() => {
    if (!expiraEn) return;
    const ms = new Date(expiraEn).getTime() - Date.now();
    const t = setTimeout(() => limpiar('La sesión expiró (8 h). Inicie sesión nuevamente.'), Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [expiraEn, limpiar]);

  const iniciar = useCallback(async (email: string, password: string) => {
    const r = await api.post<RespuestaLogin>('/auth/login', { email, password });
    api.establecerToken(r.token);
    setUsuario(r.usuario);
    setExpiraEn(r.expira_en);
    setMotivo(null);
  }, []);

  const cerrar = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* el token se descarta igual */
    }
    limpiar(null);
  }, [limpiar]);

  const valor = useMemo<Sesion>(
    () => ({
      usuario,
      verificando,
      expiraEn,
      iniciar,
      cerrar,
      motivoCierre,
      actualizar: (u) => setUsuario((prev) => (prev ? { ...prev, ...u } : prev)),
      puede: (f, a = 'escribir') => (usuario ? autorizado(usuario.rol, f, a) : false),
    }),
    [usuario, verificando, expiraEn, iniciar, cerrar, motivoCierre],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSesion(): Sesion {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSesion fuera de ProveedorSesion');
  return c;
}
