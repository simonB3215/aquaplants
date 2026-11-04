import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType, type z } from 'zod';
import { autorizado, type Accion, type Funcionalidad } from '@aquaplants/shared';
import { ErrorApp, NoAutenticadoError, NoAutorizadoError } from '../errores.js';
import type { AuthService, DispositivoAutenticado, UsuarioToken } from '../services/authService.js';
import type { UsuarioCtx } from '../services/acceso.js';

declare module 'express-serve-static-core' {
  interface Request {
    usuario?: UsuarioToken;
    dispositivo?: DispositivoAutenticado;
  }
}

export const ipDe = (req: Request) => req.ip ?? null;

export function ctx(req: Request): UsuarioCtx {
  if (!req.usuario) throw new NoAutenticadoError();
  return { id_usuario: req.usuario.id_usuario, rol: req.usuario.rol, ip: ipDe(req) };
}

/** Envuelve controladores async para delegar errores al manejador central. */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

function bearer(req: Request): string | null {
  const a = req.headers.authorization;
  if (!a || !a.startsWith('Bearer ')) return null;
  return a.slice(7).trim() || null;
}

/** authJWT(): sesión de usuario humano. */
export function authJWT(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const t = bearer(req);
    if (!t) return next(new NoAutenticadoError());
    auth
      .verificar(t)
      .then((u) => {
        req.usuario = u;
        next();
      })
      .catch(next);
  };
}

/** authDispositivo(): credencial exclusiva de dispositivo (no acepta JWT de usuarios, NEG-12). */
export function authDispositivo(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const t = bearer(req);
    if (!t) return next(new NoAutenticadoError('Credencial de dispositivo requerida', 'CREDENCIAL_DISPOSITIVO_INVALIDA'));
    auth
      .autenticarDispositivo(t, ipDe(req))
      .then((d) => {
        req.dispositivo = d;
        next();
      })
      .catch(next);
  };
}

/** rbac según Tabla 48 (fuente de verdad en @aquaplants/shared). */
export function permitir(funcionalidad: Funcionalidad, accion: Accion = 'escribir'): RequestHandler {
  return (req, _res, next) => {
    if (!req.usuario) return next(new NoAutenticadoError());
    if (!autorizado(req.usuario.rol, funcionalidad, accion)) return next(new NoAutorizadoError());
    next();
  };
}

/** validar(esquema): body/query con Zod; 422 con lista de campos. */
export function validar<S extends ZodType>(esquema: S, origen: 'body' | 'query' = 'body'): RequestHandler {
  return (req, _res, next) => {
    const r = esquema.safeParse(req[origen]);
    if (!r.success) return next(r.error);
    (req as unknown as Record<string, unknown>)[origen === 'body' ? 'body' : 'datosQuery'] = r.data;
    next();
  };
}
export const q = <T>(req: Request) => (req as unknown as { datosQuery: T }).datosQuery;
export type Inferir<S extends ZodType> = z.infer<S>;

export function idParam(req: Request, nombre = 'id'): number {
  const n = Number(req.params[nombre]);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorApp(422, 'VALIDACION', `Parámetro ${nombre} inválido`, [{ campo: nombre, mensaje: 'Debe ser un entero positivo' }]);
  return n;
}

/** Limitador de tasa en memoria por clave (dispositivo autenticado o IP). */
export function limitarTasa(porMinuto: number, clave: (req: Request) => string | null): RequestHandler {
  const ventanas = new Map<string, { inicio: number; n: number }>();
  return (req, res, next) => {
    const k = clave(req);
    if (!k) return next();
    const ahora = Date.now();
    const v = ventanas.get(k);
    if (!v || ahora - v.inicio >= 60_000) {
      ventanas.set(k, { inicio: ahora, n: 1 });
      if (ventanas.size > 10_000) for (const [kk, vv] of ventanas) if (ahora - vv.inicio >= 60_000) ventanas.delete(kk);
      return next();
    }
    v.n++;
    if (v.n > porMinuto) {
      const espera = Math.ceil((60_000 - (ahora - v.inicio)) / 1000);
      res.setHeader('Retry-After', String(espera));
      return next(new ErrorApp(429, 'DEMASIADAS_SOLICITUDES', 'Límite de solicitudes excedido'));
    }
    next();
  };
}

/** Manejo centralizado de errores: formato {codigo, mensaje, campos[]} (Tabla 11). */
export function manejadorErrores(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      codigo: 'VALIDACION',
      mensaje: 'Los datos enviados no cumplen el formato esperado',
      campos: err.issues.map((i) => ({ campo: i.path.join('.') || '(cuerpo)', mensaje: i.message })),
    });
  }
  if (err instanceof ErrorApp) {
    if (err.cabeceras) for (const [k, v] of Object.entries(err.cabeceras)) res.setHeader(k, v);
    return res.status(err.status).json({ codigo: err.codigo, mensaje: err.message, ...(err.campos ? { campos: err.campos } : {}) });
  }
  const e = err as { type?: string; status?: number };
  if (e.type === 'entity.parse.failed') return res.status(400).json({ codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido' });
  if (e.type === 'entity.too.large') return res.status(413).json({ codigo: 'CUERPO_DEMASIADO_GRANDE', mensaje: 'El cuerpo excede el tamaño permitido' });
  console.error('[api] error no controlado', req.method, req.path, err);
  res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' });
}
