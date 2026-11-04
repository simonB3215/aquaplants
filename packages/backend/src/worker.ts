import { cargarConfig, type Config } from './config.js';
import { crearServicios, type Servicios } from './contenedor.js';

/**
 * Worker: motor de alertas (outbox), notificaciones, detección de «sin señal»
 * (RN-04) y reconciliación MongoDB ↔ PostgreSQL. Se puede ejecutar como proceso
 * separado (docker compose) o dentro de la API con WORKER_EN_API=true.
 */
export function iniciarWorker(cfg: Config, s: Servicios) {
  let detenido = false;
  const ciclo = (nombre: string, cadaMs: number, fn: () => Promise<unknown>) => {
    let ocupado = false;
    const t = setInterval(async () => {
      if (ocupado || detenido) return;
      ocupado = true;
      try {
        await fn();
      } catch (e) {
        console.warn(`[worker:${nombre}]`, (e as Error).message);
      } finally {
        ocupado = false;
      }
    }, cadaMs);
    return t;
  };
  const timers = [
    ciclo('alertas', cfg.WORKER_OUTBOX_CADA_MS, () => s.motor.procesarPendientes()),
    ciclo('notificaciones', 15_000, () => s.motor.procesarNotificaciones()),
    ciclo('sin_senal', cfg.WORKER_SIN_SENAL_CADA_S * 1000, () => s.continuidad.detectarSinSenal()),
    ciclo('reconciliacion', cfg.WORKER_RECONCILIAR_CADA_S * 1000, () => s.continuidad.reconciliar(s.ingesta)),
  ];
  console.log('[worker] iniciado');
  return () => {
    detenido = true;
    timers.forEach(clearInterval);
  };
}

const esPrincipal = process.argv[1] && /worker\.(t|j)s$/.test(process.argv[1]);
if (esPrincipal) {
  const cfg = cargarConfig();
  const s = crearServicios(cfg);
  const detener = iniciarWorker(cfg, s);
  const salir = async () => {
    detener();
    await Promise.allSettled([s.db.cerrar(), s.payloads.cerrar()]);
    process.exit(0);
  };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}
