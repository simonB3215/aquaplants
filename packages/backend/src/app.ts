import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { Config } from './config.js';
import type { Servicios } from './contenedor.js';
import { rutasV1 } from './routes/v1.js';
import { manejadorErrores } from './middleware/index.js';

export function crearApp(cfg: Config, s: Servicios) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.TRUST_PROXY) app.set('trust proxy', cfg.TRUST_PROXY); // n.º de proxies delante (Netlify → Render = 2): IP real del cliente
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } } }));
  app.use(
    cors({
      origin: cfg.CORS_ORIGIN.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
      maxAge: 600,
    }),
  );
  app.use('/api/v1', rutasV1(s, cfg));
  app.use((_req, res) => res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada' }));
  app.use(manejadorErrores);
  return app;
}
