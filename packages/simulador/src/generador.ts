/**
 * Generador determinista de señales: el valor depende solo del sensor y de la
 * marca temporal (reproducible). Los escenarios aplican desplazamientos explícitos
 * y documentados; no hay números aleatorios sin control.
 */
export interface SensorSim {
  id_sensor: number;
  clave: string;
  base: number;
  amplitud: number;
}

export type ModoSensor = { tipo: 'normal' } | { tipo: 'desplazado'; delta: number; motivo: string };

/** Pseudo-ruido determinista en [-0.5, 0.5) a partir de (sensor, minuto). */
function ruido(idSensor: number, t: number): number {
  let x = (idSensor * 374761393 + Math.floor(t / 1000) * 668265263) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296 - 0.5;
}

const LIMITES: Record<string, [number, number]> = {
  ph: [0, 14],
  ce: [0, 10],
  temperatura: [-10, 60],
  nivel: [0, 100],
  humedad: [0, 100],
};

export function valorSensor(s: SensorSim, tMs: number, modo: ModoSensor = { tipo: 'normal' }): number {
  const hora = (tMs / 3_600_000) % 24;
  const diaria = Math.sin((hora / 24) * 2 * Math.PI);
  let v = s.clave === 'nivel' ? 80 + diaria * 8 + ruido(s.id_sensor, tMs) * 2 : s.base + diaria * s.amplitud * 1.5 + ruido(s.id_sensor, tMs) * s.amplitud;
  if (modo.tipo === 'desplazado') v += modo.delta;
  const [mn, mx] = LIMITES[s.clave] ?? [-1e9, 1e9];
  return +Math.min(mx, Math.max(mn, v)).toFixed(3);
}

/** Desplazamiento que lleva la variable claramente fuera del umbral crítico (escenario B). */
export function deltaCritico(clave: string): number {
  return ({ ph: -1.6, ce: 1.6, temperatura: 9, nivel: -55, humedad: 30 } as Record<string, number>)[clave] ?? 0;
}
