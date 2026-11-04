import { cargarConfig } from './config.js';
import { crearServicios } from './contenedor.js';
import { crearApp } from './app.js';
import { iniciarWorker } from './worker.js';

const cfg = cargarConfig();
const s = crearServicios(cfg);
const app = crearApp(cfg, s);
const detenerWorker = cfg.WORKER_EN_API ? iniciarWorker(cfg, s) : () => undefined;

const server = app.listen(cfg.PORT, () => {
  console.log(`[api] AquaPlants API escuchando en :${cfg.PORT} (${cfg.NODE_ENV}${cfg.DEMO_MODE ? ', DEMO' : ''})`);
});

const salir = () => {
  detenerWorker();
  server.close(async () => {
    await Promise.allSettled([s.db.cerrar(), s.payloads.cerrar()]);
    process.exit(0);
  });
};
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
