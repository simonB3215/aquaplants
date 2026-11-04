import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Funcionalidad } from '@aquaplants/shared';
import { ProveedorSesion, useSesion } from './estado/sesion';
import { ProveedorConexion } from './estado/conexion';
import { ProveedorAvisos, useAvisos } from './estado/avisos';
import { Layout } from './componentes/Layout';
import { Login } from './paginas/Login';
import { Inicio } from './paginas/Inicio';
import { FichaTorre, Torres } from './paginas/Torres';
import { Historicos } from './paginas/Historicos';
import { Alertas } from './paginas/Alertas';
import { Continuidad } from './paginas/Continuidad';
import { Auditoria, Infraestructura, Perfil, Umbrales, Usuarios } from './paginas/Gestion';
import { OlvideContrasena, RestablecerContrasena } from './paginas/Recuperar';
import { ConfirmarRegistro, Registro } from './paginas/Registro';
import { Demo } from './paginas/Demo';
import { Vacio } from './componentes/ui';
import { api } from './api/cliente';

/** Guarda visual de rutas (la autorización real está en el backend). */
function Requiere({ f, accion = 'escribir', children }: { f: Funcionalidad; accion?: 'leer' | 'escribir'; children: ReactNode }) {
  const { puede } = useSesion();
  return puede(f, accion) ? <>{children}</> : <Vacio titulo="Sin acceso">Su rol no tiene acceso a esta sección.</Vacio>;
}

function Rutas() {
  const { usuario } = useSesion();
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    if (usuario?.rol !== 'administrador') return setDemo(false);
    api
      .get('/demo/estado')
      .then(() => setDemo(true))
      .catch(() => setDemo(false));
  }, [usuario]);

  if (!usuario)
    return (
      <Routes>
        <Route path="olvide-contrasena" element={<OlvideContrasena />} />
        <Route path="restablecer-contrasena" element={<RestablecerContrasena />} />
        <Route path="registro" element={<Registro />} />
        <Route path="confirmar-registro" element={<ConfirmarRegistro />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  if (usuario.debe_cambiar_password)
    return (
      <Routes>
        <Route element={<Layout demoHabilitada={false} />}>
          <Route path="*" element={<Perfil />} />
        </Route>
      </Routes>
    );
  return (
    <Routes>
      <Route element={<Layout demoHabilitada={demo} />}>
        <Route index element={<Inicio />} />
        <Route path="torres" element={<Torres />} />
        <Route path="torres/:id" element={<FichaTorre />} />
        <Route path="historicos" element={<Historicos />} />
        <Route path="alertas" element={<Alertas />} />
        <Route path="continuidad" element={<Continuidad />} />
        <Route path="perfil" element={<Perfil />} />
        <Route path="infraestructura" element={<Requiere f="infraestructura.gestionar" accion="leer"><Infraestructura /></Requiere>} />
        <Route path="umbrales" element={<Requiere f="umbrales.gestionar" accion="leer"><Umbrales /></Requiere>} />
        <Route path="usuarios" element={<Requiere f="usuarios.gestionar"><Usuarios /></Requiere>} />
        <Route path="auditoria" element={<Requiere f="auditoria.consultar" accion="leer"><Auditoria /></Requiere>} />
        <Route path="demo" element={<Requiere f="usuarios.gestionar"><Demo /></Requiere>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** Aviso de nueva versión de la PWA (actualización controlada). */
function ActualizacionPwa() {
  const avisar = useAvisos();
  useEffect(() => {
    const fn = (e: Event) => {
      const reg = (e as CustomEvent<ServiceWorkerRegistration>).detail;
      avisar('Hay una nueva versión de AquaPlants disponible.', {
        texto: 'Actualizar',
        fn: () => reg.waiting?.postMessage({ tipo: 'SKIP_WAITING' }),
      });
    };
    window.addEventListener('aquaplants:actualizacion', fn);
    return () => window.removeEventListener('aquaplants:actualizacion', fn);
  }, [avisar]);
  return null;
}

export function App() {
  return (
    <ProveedorConexion>
      <ProveedorSesion>
        <ProveedorAvisos>
          <BrowserRouter>
            <ActualizacionPwa />
            <Rutas />
          </BrowserRouter>
        </ProveedorAvisos>
      </ProveedorSesion>
    </ProveedorConexion>
  );
}
