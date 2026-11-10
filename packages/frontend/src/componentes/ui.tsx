import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import {
  CircleCheck,
  CircleDashed,
  OctagonAlert,
  RefreshCw,
  ServerCrash,
  TriangleAlert,
  Wifi,
  WifiHigh,
  WifiLow,
  WifiZero,
  WifiOff,
  Inbox,
  CircleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { CalidadEnlace, EstadoConectividad, EstadoVariable } from '@aquaplants/shared';
import { NOMBRE_CONECTIVIDAD, NOMBRE_ESTADO_VARIABLE } from '@aquaplants/shared';

/* ------------------------------------------------------------------ Estados (color + ícono + texto) */
const ESTADO_VAR: Record<EstadoVariable, { clase: string; icono: LucideIcon }> = {
  normal: { clase: 'e-normal', icono: CircleCheck },
  advertencia: { clase: 'e-advertencia', icono: TriangleAlert },
  critico: { clase: 'e-critico', icono: OctagonAlert },
  sin_clasificar: { clase: 'e-neutro', icono: CircleDashed },
  sin_datos: { clase: 'e-neutro', icono: CircleDashed },
};
export function InsigniaEstado({ estado }: { estado: EstadoVariable }) {
  const e = ESTADO_VAR[estado];
  const I = e.icono;
  return (
    <span className={`insignia ${e.clase}`}>
      <I size={14} aria-hidden /> {NOMBRE_ESTADO_VARIABLE[estado]}
    </span>
  );
}

const ESTADO_CON: Record<EstadoConectividad, { clase: string; icono: LucideIcon }> = {
  conectado: { clase: 'e-normal', icono: Wifi },
  sin_senal: { clase: 'e-sin-senal', icono: WifiOff },
  sincronizando: { clase: 'e-sincronizando', icono: RefreshCw },
  baja: { clase: 'e-neutro', icono: CircleDashed },
  nunca_conectado: { clase: 'e-neutro', icono: CircleDashed },
};
export function InsigniaConectividad({ estado }: { estado: EstadoConectividad }) {
  const e = ESTADO_CON[estado];
  const I = e.icono;
  return (
    <span className={`insignia ${e.clase}`}>
      <I size={14} aria-hidden /> {NOMBRE_CONECTIVIDAD[estado]}
    </span>
  );
}

const SENAL: Record<CalidadEnlace, { texto: string; icono: LucideIcon; clase: string }> = {
  buena: { texto: 'Señal buena', icono: Wifi, clase: 'e-normal' },
  aceptable: { texto: 'Señal aceptable', icono: WifiHigh, clase: 'e-advertencia' },
  debil: { texto: 'Señal débil', icono: WifiLow, clase: 'e-critico' },
  sin_dato: { texto: 'Señal sin dato', icono: WifiZero, clase: 'e-neutro' },
};

/** D-35: calidad del enlace informada por el AquaBrain (RSSI). */
export function InsigniaSenal({ calidad, rssi }: { calidad: CalidadEnlace; rssi: number | null }) {
  const s = SENAL[calidad];
  const I = s.icono;
  return (
    <span className={`insignia ${s.clase}`} title="Intensidad de la señal (RSSI) informada en el último envío">
      <I size={14} aria-hidden /> {s.texto}
      {rssi != null && <span className="dato"> · {rssi} dBm</span>}
    </span>
  );
}

export function InsigniaSeveridad({ severidad }: { severidad: 'advertencia' | 'critica' }) {
  return severidad === 'critica' ? (
    <span className="insignia e-critico">
      <OctagonAlert size={14} aria-hidden /> Crítica
    </span>
  ) : (
    <span className="insignia e-advertencia">
      <TriangleAlert size={14} aria-hidden /> Advertencia
    </span>
  );
}

export function InsigniaServidor() {
  return (
    <span className="insignia e-servidor">
      <ServerCrash size={14} aria-hidden /> Error de servidor
    </span>
  );
}

/* ------------------------------------------------------------------ Estructura */
export function Tarjeta({ titulo, descripcion, acciones, children, className = '', etiqueta }: { titulo?: ReactNode; descripcion?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string; etiqueta?: string }) {
  const id = useId();
  return (
    <section className={`tarjeta vidrio ${className}`} aria-labelledby={titulo ? id : undefined} aria-label={!titulo ? etiqueta : undefined}>
      {(titulo || acciones) && (
        <div className="tarjeta-cab">
          <div>
            {titulo && <h2 id={id}>{titulo}</h2>}
            {descripcion && <p>{descripcion}</p>}
          </div>
          {acciones}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ icono: I, etiqueta, valor, pie, tono = 'fondo-normal' }: { icono: LucideIcon; etiqueta: string; valor: ReactNode; pie?: ReactNode; tono?: string }) {
  return (
    <div className="kpi vidrio" role="group" aria-label={etiqueta}>
      <div className="kpi-cab">
        <span className={`chip-icono ${tono}`}>
          <I size={18} aria-hidden />
        </span>
        {etiqueta}
      </div>
      <div className="kpi-valor">{valor}</div>
      {pie && <div className="kpi-pie">{pie}</div>}
    </div>
  );
}

export function Encabezado({ titulo, descripcion, acciones }: { titulo: string; descripcion?: ReactNode; acciones?: ReactNode }) {
  return (
    <header className="encabezado">
      <div>
        <h1>{titulo}</h1>
        {descripcion && <p>{descripcion}</p>}
      </div>
      {acciones && <div className="barra-acciones">{acciones}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ Controles */
type VarianteBoton = 'primario' | 'verde' | 'secundario' | 'peligro' | 'fantasma';
export function Boton({ variante = 'secundario', pequeno, icono: I, children, cargando, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton; pequeno?: boolean; icono?: LucideIcon; cargando?: boolean }) {
  return (
    <button {...p} className={`boton boton-${variante} ${pequeno ? 'boton-pequeno' : ''} ${p.className ?? ''}`} disabled={p.disabled || cargando} aria-busy={cargando || undefined}>
      {I && <I size={18} aria-hidden className={cargando ? 'girando' : ''} />}
      {children}
    </button>
  );
}

export function Campo({ etiqueta, error, ayuda, ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; error?: string; ayuda?: string }) {
  const id = useId();
  const desc = [ayuda ? `${id}-ayuda` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} {...p} aria-invalid={error ? true : undefined} aria-describedby={desc} />
      {ayuda && (
        <span id={`${id}-ayuda`} className="campo-ayuda">
          {ayuda}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="campo-error">
          <CircleAlert size={14} aria-hidden /> {error}
        </span>
      )}
    </div>
  );
}

export function Selector({ etiqueta, error, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; error?: string }) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <select id={id} {...p} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}>
        {children}
      </select>
      {error && (
        <span id={`${id}-error`} className="campo-error">
          <CircleAlert size={14} aria-hidden /> {error}
        </span>
      )}
    </div>
  );
}

export function Segmentado<T extends string>({ opciones, valor, onCambio, etiqueta }: { opciones: { valor: T; texto: string }[]; valor: T; onCambio: (v: T) => void; etiqueta: string }) {
  return (
    <div className="segmentado" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.valor} type="button" aria-pressed={o.valor === valor} onClick={() => onCambio(o.valor)}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Retroalimentación */
export function Esqueleto({ alto = 120, n = 1 }: { alto?: number; n?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="rejilla">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: alto }} />
      ))}
    </div>
  );
}

export function Vacio({ titulo, children, icono: I = Inbox }: { titulo: string; children?: ReactNode; icono?: LucideIcon }) {
  return (
    <div className="vacio">
      <I size={32} aria-hidden />
      <strong>{titulo}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Aviso({ tono = 'fondo-info', icono: I = CircleAlert, titulo, children }: { tono?: string; icono?: LucideIcon; titulo?: string; children?: ReactNode }) {
  return (
    <div className={`aviso ${tono}`} role="status">
      <I size={18} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
      <div>
        {titulo && <strong>{titulo}</strong>}
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

export function MensajeError({ error, reintentar }: { error: { message: string; status?: number } | null; reintentar?: () => void }) {
  if (!error) return null;
  return (
    <div className="aviso fondo-critico" role="alert">
      <CircleAlert size={18} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <strong>{error.status === 403 ? 'Sin permiso' : 'No se pudo completar la operación'}</strong>
        <p>{error.message}</p>
      </div>
      {reintentar && (
        <Boton pequeno variante="fantasma" onClick={reintentar}>
          Reintentar
        </Boton>
      )}
    </div>
  );
}

export function Modal({ titulo, abierto, onCerrar, children }: { titulo: string; abierto: boolean; onCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    const primero = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    primero?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      previo?.focus();
    };
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <h2 id={id}>{titulo}</h2>
          <button className="boton boton-fantasma boton-icono" onClick={onCerrar} aria-label="Cerrar">
            <X size={20} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Paginador({ pagina, total, porPagina, onCambio }: { pagina: number; total: number; porPagina: number; onCambio: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <nav className="acciones" aria-label="Paginación" style={{ marginTop: 12, alignItems: 'center' }}>
      <span className="muted pequeno">
        {total} registros · página {pagina} de {paginas}
      </span>
      <Boton pequeno variante="fantasma" disabled={pagina <= 1} onClick={() => onCambio(pagina - 1)}>
        Anterior
      </Boton>
      <Boton pequeno variante="fantasma" disabled={pagina >= paginas} onClick={() => onCambio(pagina + 1)}>
        Siguiente
      </Boton>
    </nav>
  );
}
