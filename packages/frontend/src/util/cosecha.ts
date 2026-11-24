import { diasDeCultivo, hoyISO } from './formato';

/** Lo mínimo de un cultivo que se necesita para calcular duraciones (`GET /cultivos`). */
export interface CultivoHistorial {
  especie: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: 'en_curso' | 'finalizado';
}

export interface DuracionEspecie {
  especie: string;
  /** Promedio de días hasta la cosecha, redondeado. */
  promedio: number;
  minimo: number;
  maximo: number;
  /** Cantidad de cultivos cosechados (finalizados) usados en el cálculo. */
  cosechas: number;
}

/**
 * Cuánto dura cada especie según el historial: promedio de los cultivos ya cosechados
 * (inicio → fecha de fin). Una especie sin cosechas no aparece. Orden alfabético.
 */
export function duracionesPorEspecie(cultivos: CultivoHistorial[]): Map<string, DuracionEspecie> {
  const dias = new Map<string, number[]>();
  for (const c of cultivos) {
    if (c.estado !== 'finalizado' || !c.fecha_fin) continue;
    dias.set(c.especie, [...(dias.get(c.especie) ?? []), diasDeCultivo(c.fecha_inicio, c.fecha_fin)]);
  }
  const lista = [...dias].map(([especie, d]) => ({
    especie,
    promedio: Math.round(d.reduce((a, b) => a + b, 0) / d.length),
    minimo: Math.min(...d),
    maximo: Math.max(...d),
    cosechas: d.length,
  }));
  lista.sort((a, b) => a.especie.localeCompare(b.especie, 'es'));
  return new Map(lista.map((x) => [x.especie, x]));
}

/** Fecha AAAA-MM-DD más `n` días. */
export function sumarDias(iso: string, n: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}

/** Cosecha estimada de un cultivo en curso: inicio + duración promedio de su especie. */
export function cosechaEstimada(fechaInicio: string, duracion: DuracionEspecie | undefined, hoy = hoyISO()): { fecha: string; faltan: number } | null {
  if (!duracion) return null;
  const fecha = sumarDias(fechaInicio, duracion.promedio);
  // Días entre hoy y la fecha estimada (negativo = ya pasó).
  const faltan = fecha >= hoy ? diasDeCultivo(hoy, fecha) : -diasDeCultivo(fecha, hoy);
  return { fecha, faltan };
}

/** «faltan 22 días», «es hoy», «atrasada 3 días». */
export function textoFaltan(faltan: number): string {
  if (faltan === 0) return 'es hoy';
  const n = Math.abs(faltan);
  const dias = `${n} ${n === 1 ? 'día' : 'días'}`;
  return faltan > 0 ? `${faltan === 1 ? 'falta' : 'faltan'} ${dias}` : `atrasada ${dias}`;
}
