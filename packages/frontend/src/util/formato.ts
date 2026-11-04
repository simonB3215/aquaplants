const fmtFechaHora = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtFecha = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const fechaHora = (iso: string | null | undefined) => (iso ? fmtFechaHora.format(new Date(iso)) : '—');
export const hora = (d: Date | string | null | undefined) => (d ? fmtHora.format(typeof d === 'string' ? new Date(d) : d) : '—');
export const fechaLarga = (d = new Date()) => fmtFecha.format(d);

export function duracion(segundos: number | null | undefined): string {
  if (segundos == null) return '—';
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export const hace = (iso: string | null | undefined) => (iso ? `hace ${duracion((Date.now() - new Date(iso).getTime()) / 1000)}` : 'nunca');

export function numero(v: number | null | undefined, decimales = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('es-CL', { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
}

export const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

/** Fecha local AAAA-MM-DD (para inputs type=date). */
export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
