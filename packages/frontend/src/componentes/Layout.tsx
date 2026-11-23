import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  Building2,
  ChartLine,
  ClipboardList,
  Cpu,
  Droplets,
  FlaskConical,
  Leaf,
  Gauge,
  House,
  LogOut,
  Menu,
  ServerCrash,
  SlidersHorizontal,
  Sprout,
  UserRound,
  Users,
  WifiOff,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { ETIQUETA_ROL } from '@aquaplants/shared';
import type { FuenteAvisos } from './IndicadorAlertas';
import { useSesion } from '../estado/sesion';
import { useConexion } from '../estado/conexion';
import { iniciales } from '../util/formato';
import { CampanaAlertas, NumeroAlertasNav, ProveedorAlertas } from './IndicadorAlertas';

interface ItemNav {
  ruta: string;
  texto: string;
  icono: LucideIcon;
  movil?: boolean;
  grupo?: string;
  /** Muestra el número de alertas activas junto al texto. */
  contador?: boolean;
}

/** Navegación por rol: mismo sistema visual, distinto contenido (Tabla 48 como ayuda visual). */
function itemsPara(puede: ReturnType<typeof useSesion>['puede'], rol: string, demo: boolean): ItemNav[] {
  const items: ItemNav[] = [
    { ruta: '/', texto: 'Inicio', icono: House, movil: true },
    { ruta: '/torres', texto: rol === 'encargado' ? 'Mis torres' : 'Torres', icono: Sprout, movil: true },
    { ruta: '/historicos', texto: 'Históricos', icono: ChartLine, movil: true },
  ];
  // Anexo C (D-37): el Técnico no recibe alertas de cultivo; su contador es el de incidencias.
  if (puede('alertas.ver', 'leer')) items.push({ ruta: '/alertas', texto: 'Alertas', icono: Bell, movil: true, contador: true });
  if (puede('incidencias.atender', 'leer'))
    items.push({ ruta: '/incidencias', texto: 'Incidencias', icono: Wrench, movil: rol === 'tecnico', contador: !puede('alertas.ver', 'leer') });
  items.push({ ruta: '/continuidad', texto: 'Continuidad', icono: Activity });
  if (puede('infraestructura.gestionar', 'leer') && rol !== 'encargado') items.push({ ruta: '/infraestructura', texto: 'Infraestructura', icono: Cpu, grupo: 'Gestión' });
  if (puede('umbrales.gestionar', 'leer') && rol !== 'encargado') items.push({ ruta: '/umbrales', texto: 'Umbrales', icono: SlidersHorizontal, grupo: 'Gestión' });
  if (puede('usuarios.gestionar')) items.push({ ruta: '/usuarios', texto: rol === 'supervisor' ? 'Mis Encargados' : 'Usuarios', icono: Users, grupo: 'Gestión' });
  if (puede('clientes.gestionar', 'leer')) items.push({ ruta: '/clientes', texto: 'Clientes', icono: Building2, grupo: 'Gestión' });
  if (puede('especies.gestionar', 'leer')) items.push({ ruta: '/especies', texto: 'Especies', icono: Leaf, grupo: 'Gestión' });
  if (puede('auditoria.consultar', 'leer')) items.push({ ruta: '/auditoria', texto: 'Auditoría', icono: ClipboardList, grupo: 'Gestión' });
  if (demo && puede('clientes.gestionar')) items.push({ ruta: '/demo', texto: 'Demostración', icono: FlaskConical, grupo: 'Gestión' });
  // Barra inferior: máximo 5 destinos (4 + «Más»); Perfil y el resto quedan en «Más».
  items.push({ ruta: '/perfil', texto: 'Perfil', icono: UserRound });
  return items;
}

export function IndicadorConexion() {
  const c = useConexion();
  if (c === 'en_linea') return null;
  return c === 'sin_internet' ? (
    <span className="insignia e-sin-senal" role="status">
      <WifiOff size={14} aria-hidden /> Sin Internet en este equipo
    </span>
  ) : (
    <span className="insignia e-servidor" role="status">
      <ServerCrash size={14} aria-hidden /> Sin conexión con el servidor
    </span>
  );
}

export function Layout({ demoHabilitada }: { demoHabilitada: boolean }) {
  const { usuario, puede, cerrar } = useSesion();
  const [hojaAbierta, setHoja] = useState(false);
  const loc = useLocation();
  useEffect(() => setHoja(false), [loc.pathname]);
  if (!usuario) return null;
  const items = itemsPara(puede, usuario.rol, demoHabilitada);
  const fuente: FuenteAvisos = !puede('alertas.ver', 'leer') && puede('incidencias.atender', 'leer') ? 'incidencias' : 'alertas';
  const moviles = items.filter((i) => i.movil);
  const resto = items.filter((i) => !i.movil);

  let grupoActual: string | undefined;
  const lista: ReactNode[] = [];
  for (const i of items) {
    if (i.grupo !== grupoActual && i.grupo) lista.push(<li key={`g-${i.grupo}`} className="nav-grupo" aria-hidden>{i.grupo}</li>);
    grupoActual = i.grupo;
    lista.push(
      <li key={i.ruta}>
        <NavLink to={i.ruta} end={i.ruta === '/'} className="nav-enlace">
          <i.icono size={20} aria-hidden /> {i.texto}
          {i.contador && <NumeroAlertasNav />}
        </NavLink>
      </li>,
    );
  }

  return (
    <div className="app">
      <ProveedorAlertas activo={!usuario.debe_cambiar_password} fuente={fuente}>
        <a href="#contenido" className="saltar-contenido">
          Saltar al contenido
        </a>
        <aside className="lateral vidrio" aria-label="Navegación principal">
          <NavLink to="/" className="marca" aria-label="AquaPlants, inicio">
            <span className="marca-logo">
              <Droplets size={20} aria-hidden />
            </span>
            <span>
              AquaPlants
              <small>AquaBrain · {ETIQUETA_ROL[usuario.rol]}</small>
            </span>
          </NavLink>
          <nav>
            <ul className="nav-lista">{lista}</ul>
          </nav>
          <div className="nav-pie">
            <button className="nav-enlace boton-fantasma" style={{ width: '100%', border: 0, cursor: 'pointer' }} onClick={() => void cerrar()}>
              <LogOut size={20} aria-hidden /> Cerrar sesión
            </button>
          </div>
        </aside>

        <main id="contenido" className="principal" tabIndex={-1}>
          <Outlet />
        </main>

        {hojaAbierta && (
          <div className="hoja vidrio" id="hoja-mas" role="dialog" aria-label="Más opciones">
            <ul className="nav-lista">
              {resto.map((i) => (
                <li key={i.ruta}>
                  <NavLink to={i.ruta} className="nav-enlace">
                    <i.icono size={20} aria-hidden /> {i.texto}
                  </NavLink>
                </li>
              ))}
              <li>
                <button className="nav-enlace" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer' }} onClick={() => void cerrar()}>
                  <LogOut size={20} aria-hidden /> Cerrar sesión
                </button>
              </li>
            </ul>
          </div>
        )}
        <nav className="nav-inferior vidrio" aria-label="Navegación inferior">
          {moviles.map((i) => (
            <NavLink key={i.ruta} to={i.ruta} end={i.ruta === '/'}>
              <span className="insignia-nav">
                <i.icono size={20} aria-hidden />
              </span>
              <span>{i.texto}</span>
              {i.contador && <NumeroAlertasNav />}
            </NavLink>
          ))}
          <button aria-expanded={hojaAbierta} aria-controls="hoja-mas" onClick={() => setHoja((v) => !v)}>
            <Menu size={20} aria-hidden />
            <span>Más</span>
          </button>
        </nav>
      </ProveedorAlertas>
    </div>
  );
}

export function BarraSuperior({ actualizadoEn, desactualizado, extra }: { actualizadoEn?: Date | null; desactualizado?: boolean; extra?: ReactNode }) {
  const { usuario } = useSesion();
  if (!usuario) return null;
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  return (
    <div className="barra-superior vidrio">
      <div className="saludo">
        <span className="avatar" aria-hidden>
          {iniciales(usuario.nombre)}
        </span>
        <div className="saludo-texto">
          <strong>
            {saludo}, {usuario.nombre.split(' ')[0]}
          </strong>
          <span className="muted pequeno">{ETIQUETA_ROL[usuario.rol]}</span>
        </div>
      </div>
      <div className="barra-acciones">
        {!usuario.debe_cambiar_password && <CampanaAlertas />}
        <IndicadorConexion />
        {actualizadoEn !== undefined && (
          <span className={`insignia ${desactualizado ? 'e-advertencia' : 'e-neutro'}`} title="Última actualización recibida del servidor">
            <Gauge size={14} aria-hidden />
            {desactualizado ? 'Datos desactualizados · ' : 'Actualizado '}
            <span className="dato">{actualizadoEn ? actualizadoEn.toLocaleTimeString('es-CL') : '—'}</span>
          </span>
        )}
        {extra}
      </div>
    </div>
  );
}
