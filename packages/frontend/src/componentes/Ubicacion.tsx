import { MapPin } from 'lucide-react';

/** D-37: coordenadas GPS ingresadas a mano (texto → número o null). */
export function leerGps(lat: unknown, lon: unknown): { latitud: number | null; longitud: number | null } | { error: string } {
  const a = String(lat ?? '').trim().replace(',', '.');
  const b = String(lon ?? '').trim().replace(',', '.');
  if (!a && !b) return { latitud: null, longitud: null };
  if (!a || !b) return { error: 'Ingrese latitud y longitud juntas' };
  const la = Number(a);
  const lo = Number(b);
  if (!Number.isFinite(la) || la < -90 || la > 90) return { error: 'Latitud entre -90 y 90' };
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) return { error: 'Longitud entre -180 y 180' };
  return { latitud: la, longitud: lo };
}

/** Enlace al mapa (OpenStreetMap) con la ubicación del equipo. Solo se abre si la persona hace clic. */
export function EnlaceGps({ latitud, longitud }: { latitud: number | null; longitud: number | null }) {
  if (latitud == null || longitud == null) return null;
  const texto = `${latitud.toFixed(5)}, ${longitud.toFixed(5)}`;
  return (
    <a
      className="enlace-gps"
      href={`https://www.openstreetmap.org/?mlat=${latitud}&mlon=${longitud}#map=17/${latitud}/${longitud}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ver ubicación ${texto} en el mapa (se abre en otra pestaña)`}
    >
      <MapPin size={14} aria-hidden /> <span className="dato">{texto}</span>
    </a>
  );
}
