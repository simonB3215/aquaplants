import { Router, type Request } from 'express';
import express from 'express';
import { z } from 'zod';
import {
  AsignacionSchema,
  BajaSchema,
  CambiarPasswordSchema,
  CerrarCultivoSchema,
  CompararSchema,
  CultivoSchema,
  DispositivoSchema,
  EditarCultivoSchema,
  EditarDispositivoSchema,
  EditarTorreSchema,
  EditarUmbralSchema,
  EditarUsuarioSchema,
  EventoDispositivoSchema,
  ExportarSchema,
  FiltroAlertasSchema,
  FiltroAuditoriaSchema,
  FiltroEventosSchema,
  HistoricoSchema,
  LoginSchema,
  LoteSchema,
  ResolverAlertaSchema,
  SensorSchema,
  TorreSchema,
  UmbralSchema,
  UsuarioSchema,
} from '@aquaplants/shared';
import type { Servicios } from '../contenedor.js';
import type { Config } from '../config.js';
import { ErrorApp } from '../errores.js';
import { authDispositivo, authJWT, ctx, h, idParam, ipDe, limitarTasa, permitir, q, validar } from '../middleware/index.js';
import { ESCENARIOS_DEMO, type CodigoEscenario } from '../services/demoService.js';
import { openapi } from './openapi.js';

export function rutasV1(s: Servicios, cfg: Config): Router {
  const r = Router();
  const auth = authJWT(s.auth);

  // ------------------------------------------------------------ Salud (RF-14) y contrato
  r.get(
    '/health',
    h(async (_req, res) => {
      const salud = await s.continuidad.salud();
      res.status(salud.estado === 'ok' ? 200 : 503).json(salud);
    }),
  );
  r.get('/openapi.json', (_req, res) => res.json(openapi));

  // ------------------------------------------------------------ CU-01 Telemetría (solo dispositivos)
  const json64k = express.json({ limit: '64kb' });
  const tasaDispositivo = limitarTasa(cfg.DEVICE_RATE_LIMIT_PER_MIN, (req) => (req.dispositivo ? `d${req.dispositivo.id_dispositivo}` : null));
  r.post(
    '/telemetria',
    authDispositivo(s.auth), // identidad verificada ANTES de leer el cuerpo o aplicar límites
    tasaDispositivo,
    json64k,
    validar(LoteSchema),
    h(async (req, res) => {
      const out = await s.ingesta.registrarLote(req.dispositivo!, req.body, ipDe(req));
      res.status(out.duplicado ? 200 : 201).json(out);
    }),
  );
  r.post(
    '/telemetria/eventos',
    authDispositivo(s.auth),
    tasaDispositivo,
    json64k,
    validar(EventoDispositivoSchema),
    h(async (req, res) => {
      const out = await s.ingesta.registrarEventoDispositivo(req.dispositivo!, req.body);
      res.status(out.registrado ? 201 : 200).json(out);
    }),
  );

  r.use(express.json({ limit: '64kb' }));

  // ------------------------------------------------------------ CU-02 Sesión
  const tasaLogin = limitarTasa(cfg.LOGIN_RATE_LIMIT_PER_MIN, (req) => `ip${ipDe(req)}`);
  r.post(
    '/auth/login',
    tasaLogin,
    validar(LoginSchema),
    h(async (req, res) => {
      res.json(await s.auth.login(req.body.email, req.body.password, ipDe(req)));
    }),
  );
  r.post(
    '/auth/logout',
    auth,
    h(async (req, res) => {
      await s.auth.logout(req.usuario!, ipDe(req));
      res.status(204).end();
    }),
  );
  r.get(
    '/auth/me',
    auth,
    h(async (req, res) => {
      res.json(await s.auth.me(req.usuario!.id_usuario));
    }),
  );
  r.post(
    '/auth/cambiar-password',
    auth,
    validar(CambiarPasswordSchema),
    h(async (req, res) => {
      await s.auth.cambiarPassword(req.usuario!.id_usuario, req.body.actual, req.body.nueva, ipDe(req));
      res.status(204).end();
    }),
  );

  // ------------------------------------------------------------ CU-03 Estado actual
  r.get(
    '/torres/estado',
    auth,
    permitir('estado.ver'),
    h(async (req, res) => {
      res.json(await s.estado.estado(ctx(req)));
    }),
  );
  r.get(
    '/torres/:id/estado',
    auth,
    permitir('estado.ver'),
    h(async (req, res) => {
      res.json(await s.estado.estado(ctx(req), idParam(req)));
    }),
  );

  // ------------------------------------------------------------ CU-04 Alertas
  r.get(
    '/alertas',
    auth,
    permitir('alertas.ver'),
    validar(FiltroAlertasSchema, 'query'),
    h(async (req, res) => {
      res.json(await s.alertas.listar(ctx(req), q(req)));
    }),
  );
  const resolver = h(async (req, res) => {
    const body = ResolverAlertaSchema.parse(req.body ?? {});
    res.json(await s.alertas.resolver(ctx(req), idParam(req), body.comentario));
  });
  // La severidad se comprueba en el servicio (advertencia vs crítica, Tabla 48).
  r.patch('/alertas/:id/resolver', auth, permitir('alertas.resolver_advertencia'), resolver);
  r.patch('/alertas/:id', auth, permitir('alertas.resolver_advertencia'), resolver); // alias usado en NEG-01

  // ------------------------------------------------------------ CU-05 / CU-06 Históricos
  const historico = [
    auth,
    permitir('historicos.consultar', 'leer'),
    validar(HistoricoSchema, 'query'),
    h(async (req: Request, res) => {
      const f = q<z.infer<typeof HistoricoSchema>>(req);
      res.json(await s.historico.historico(ctx(req), f.sensor, new Date(f.desde), new Date(f.hasta)));
    }),
  ];
  r.get('/mediciones/historico', ...historico);
  r.get('/historicos', ...historico); // alias indicado en el prompt maestro
  r.get(
    '/mediciones/comparar',
    auth,
    permitir('historicos.comparar_exportar'),
    validar(CompararSchema, 'query'),
    h(async (req, res) => {
      const f = q<z.infer<typeof CompararSchema>>(req);
      res.json(await s.historico.comparar(ctx(req), f.tipo_variable, f.torres, new Date(f.desde), new Date(f.hasta)));
    }),
  );
  const exportar = [
    auth,
    permitir('historicos.comparar_exportar'),
    validar(ExportarSchema, 'query'),
    h(async (req: Request, res) => {
      const f = q<z.infer<typeof ExportarSchema>>(req);
      const desde = new Date(f.desde);
      const hasta = new Date(f.hasta);
      let inicio = false;
      await s.historico.exportar(ctx(req), { torres: f.torres, tipo_variable: f.tipo_variable, desde, hasta }, async (chunk) => {
        if (!inicio) {
          inicio = true;
          const nombre = `aquaplants_torres-${f.torres.join('-')}_${f.desde.slice(0, 10)}_${f.hasta.slice(0, 10)}.csv`;
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
        }
        if (!res.write(chunk)) await new Promise((ok) => res.once('drain', ok));
      });
      res.end();
    }),
  ];
  r.get('/historicos/export', ...exportar);
  r.get('/mediciones/export', ...exportar);

  // ------------------------------------------------------------ CU-07 Umbrales
  r.get(
    '/sensores/:id/umbrales',
    auth,
    permitir('umbrales.gestionar', 'leer'),
    h(async (req, res) => {
      res.json(await s.umbrales.listar(ctx(req), idParam(req), req.query.inactivos === 'true'));
    }),
  );
  r.put(
    '/sensores/:id/umbrales',
    auth,
    permitir('umbrales.gestionar'),
    validar(UmbralSchema),
    h(async (req, res) => {
      res.json(await s.umbrales.definir(ctx(req), idParam(req), req.body));
    }),
  );
  r.put(
    '/umbrales/:id',
    auth,
    permitir('umbrales.gestionar'),
    validar(EditarUmbralSchema),
    h(async (req, res) => {
      res.json(await s.umbrales.editar(ctx(req), idParam(req), req.body));
    }),
  );
  r.patch(
    '/umbrales/:id/desactivar',
    auth,
    permitir('umbrales.gestionar'),
    h(async (req, res) => {
      res.json(await s.umbrales.desactivar(ctx(req), idParam(req)));
    }),
  );

  // ------------------------------------------------------------ CU-08 Torres, dispositivos, sensores
  const leerInfra = permitir('infraestructura.gestionar', 'leer');
  const escribirInfra = permitir('infraestructura.gestionar');
  r.get('/catalogos', auth, h(async (_req, res) => void res.json(await s.infra.catalogos())));
  r.get('/torres', auth, leerInfra, h(async (req, res) => void res.json(await s.infra.listarTorres(ctx(req)))));
  r.post('/torres', auth, escribirInfra, validar(TorreSchema), h(async (req, res) => void res.status(201).json(await s.infra.crearTorre(ctx(req), req.body))));
  r.patch('/torres/:id', auth, escribirInfra, validar(EditarTorreSchema), h(async (req, res) => void res.json(await s.infra.editarTorre(ctx(req), idParam(req), req.body))));
  r.patch('/torres/:id/baja', auth, escribirInfra, validar(BajaSchema), h(async (req, res) => void res.json(await s.infra.bajaTorre(ctx(req), idParam(req), req.body.motivo))));
  r.put(
    '/torres/:id/usuarios',
    auth,
    escribirInfra,
    validar(AsignacionSchema),
    h(async (req, res) => void res.json(await s.infra.asignarUsuarios(ctx(req), idParam(req), req.body.usuarios))),
  );
  r.get('/dispositivos', auth, leerInfra, h(async (req, res) => void res.json(await s.infra.listarDispositivos(ctx(req)))));
  r.post('/dispositivos', auth, escribirInfra, validar(DispositivoSchema), h(async (req, res) => void res.status(201).json(await s.infra.crearDispositivo(ctx(req), req.body))));
  r.patch(
    '/dispositivos/:id',
    auth,
    escribirInfra,
    validar(EditarDispositivoSchema),
    h(async (req, res) => void res.json(await s.infra.editarDispositivo(ctx(req), idParam(req), req.body))),
  );
  r.patch('/dispositivos/:id/baja', auth, escribirInfra, validar(BajaSchema), h(async (req, res) => void res.json(await s.infra.bajaDispositivo(ctx(req), idParam(req), req.body.motivo))));
  r.post('/dispositivos/:id/credencial', auth, escribirInfra, h(async (req, res) => void res.json(await s.infra.regenerarCredencial(ctx(req), idParam(req)))));
  r.post('/sensores', auth, escribirInfra, validar(SensorSchema), h(async (req, res) => void res.status(201).json(await s.infra.crearSensor(ctx(req), req.body))));
  r.patch('/sensores/:id/baja', auth, escribirInfra, validar(BajaSchema), h(async (req, res) => void res.json(await s.infra.bajaSensor(ctx(req), idParam(req), req.body.motivo))));

  // ------------------------------------------------------------ CU-09 Usuarios y auditoría
  const adminUsuarios = permitir('usuarios.gestionar');
  r.get('/roles', auth, adminUsuarios, h(async (_req, res) => void res.json(await s.usuarios.roles())));
  r.get('/usuarios', auth, adminUsuarios, h(async (_req, res) => void res.json(await s.usuarios.listar())));
  r.post('/usuarios', auth, adminUsuarios, validar(UsuarioSchema), h(async (req, res) => void res.status(201).json(await s.usuarios.crear(ctx(req), req.body))));
  r.patch('/usuarios/:id', auth, adminUsuarios, validar(EditarUsuarioSchema), h(async (req, res) => void res.json(await s.usuarios.editar(ctx(req), idParam(req), req.body))));
  r.post('/usuarios/:id/restablecer-password', auth, adminUsuarios, h(async (req, res) => void res.json(await s.usuarios.restablecerPassword(ctx(req), idParam(req)))));
  r.get(
    '/auditoria',
    auth,
    permitir('auditoria.consultar', 'leer'),
    validar(FiltroAuditoriaSchema, 'query'),
    h(async (req, res) => void res.json(await s.usuarios.auditoria(q(req)))),
  );
  // RN-07: nadie edita ni elimina la auditoría → 405 (NEG-09, CP-17).
  r.all('/auditoria/:id', auth, (req, _res, next) => {
    if (req.method === 'GET') return next();
    next(new ErrorApp(405, 'METODO_NO_PERMITIDO', 'La auditoría es de solo inserción: no se puede modificar ni eliminar'));
  });

  // ------------------------------------------------------------ CU-10 Cultivos
  r.get(
    '/cultivos',
    auth,
    permitir('cultivos.gestionar', 'leer'),
    h(async (req, res) => void res.json(await s.cultivos.listar(ctx(req), req.query.torre ? Number(req.query.torre) : undefined))),
  );
  r.post('/cultivos', auth, permitir('cultivos.gestionar'), validar(CultivoSchema), h(async (req, res) => void res.status(201).json(await s.cultivos.crear(ctx(req), req.body))));
  r.patch(
    '/cultivos/:id',
    auth,
    permitir('cultivos.gestionar'),
    validar(EditarCultivoSchema),
    h(async (req, res) => void res.json(await s.cultivos.editar(ctx(req), idParam(req), req.body))),
  );
  r.patch(
    '/cultivos/:id/cerrar',
    auth,
    permitir('cultivos.gestionar'),
    validar(CerrarCultivoSchema),
    h(async (req, res) => void res.json(await s.cultivos.cerrar(ctx(req), idParam(req), req.body.fecha_fin))),
  );

  // ------------------------------------------------------------ Eventos y continuidad operativa
  r.get('/eventos', auth, permitir('estado.ver'), validar(FiltroEventosSchema, 'query'), h(async (req, res) => void res.json(await s.continuidad.eventos(ctx(req), q(req)))));
  r.get('/continuidad', auth, permitir('estado.ver'), h(async (req, res) => void res.json(await s.continuidad.resumen(ctx(req)))));

  // ------------------------------------------------------------ Modo demostración (aislado)
  if (cfg.DEMO_MODE) {
    const soloAdmin = permitir('usuarios.gestionar');
    r.get('/demo/estado', auth, soloAdmin, h(async (_req, res) => void res.json(await s.demo.estado())));
    r.post(
      '/demo/escenarios/:codigo',
      auth,
      soloAdmin,
      h(async (req, res) => {
        const codigo = String(req.params.codigo).toUpperCase();
        if (!(codigo in ESCENARIOS_DEMO)) throw new ErrorApp(404, 'ESCENARIO_DESCONOCIDO', 'Escenario inexistente');
        const id = req.body?.id_dispositivo ? Number(req.body.id_dispositivo) : undefined;
        const resultado = await s.demo.ejecutar(codigo as CodigoEscenario, id);
        await s.db.transaccion((tx) =>
          import('../services/auditoria.js').then((m) => m.auditar(tx, ctx(req), 'demo_escenario', 'demo', codigo, { id_dispositivo: id ?? null })),
        );
        res.json(resultado);
      }),
    );
  }

  r.use((_req, _res, next) => next(new ErrorApp(404, 'NO_ENCONTRADO', 'Ruta no encontrada')));
  return r;
}
