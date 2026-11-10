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
  caudal: [0, 30],
  consumo_hidrico: [0, 500],
  fotoperiodo: [0, 24],
};

export function valorSensor(s: SensorSim, tMs: number, modo: ModoSensor = { tipo: 'normal' }): number {
  const hora = (tMs / 3_600_000) % 24;
  const diaria = Math.sin((hora / 24) * 2 * Math.PI);
  let v =
    s.clave === 'nivel'
      ? 80 + diaria * 8 + ruido(s.id_sensor, tMs) * 2
      : s.clave === 'fotoperiodo'
        ? s.base + ruido(s.id_sensor, tMs) * 0.1 // horas de luz programadas: casi constante
        : s.base + diaria * s.amplitud * 1.5 + ruido(s.id_sensor, tMs) * s.amplitud;
  if (modo.tipo === 'desplazado') v += modo.delta;
  const [mn, mx] = LIMITES[s.clave] ?? [-1e9, 1e9];
  return +Math.min(mx, Math.max(mn, v)).toFixed(3);
}

/** Desplazamiento que lleva la variable claramente fuera del umbral crítico (escenario B). */
export function deltaCritico(clave: string): number {
  return ({ ph: -1.6, ce: 1.6, temperatura: 9, nivel: -55, humedad: 30, caudal: -5, consumo_hidrico: 60, fotoperiodo: -6 } as Record<string, number>)[clave] ?? 0;
}

/**
 * Valores de partida para un sensor que el simulador descubre en la API
 * (GET /telemetria/configuracion) y que no estaba en dispositivos.json.
 */
export const SENSOR_POR_DEFECTO: Record<string, { base: number; amplitud: number }> = {
  ph: { base: 5.9, amplitud: 0.12 },
  ce: { base: 1.2, amplitud: 0.08 },
  temperatura: { base: 21, amplitud: 0.8 },
  nivel: { base: 80, amplitud: 8 },
  humedad: { base: 60, amplitud: 4 },
  caudal: { base: 4, amplitud: 0.6 },
  consumo_hidrico: { base: 30, amplitud: 4 },
  fotoperiodo: { base: 15, amplitud: 0.4 }, // 15 h: dentro del rango de todas las especies (12–16 y 14–16)
};

/**
 * Intensidad de señal simulada (RSSI, dBm) — D-35. Varía lentamente por
 * dispositivo entre ≈ -58 y -78 dBm (enlace bueno/aceptable). Determinista.
 */
export function rssiSimulado(idDispositivo: number, tMs: number): number {
  const base = -62 - (idDispositivo % 3) * 4;
  const lenta = Math.sin((tMs / 1_800_000 + idDispositivo) * 2 * Math.PI) * 5;
  return Math.round(base + lenta + ruido(idDispositivo * 7919, tMs) * 4);
}
