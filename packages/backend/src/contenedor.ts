import type { Config } from './config.js';
import type { IBaseDatos, INotificador, IPayloadStore } from './ports/index.js';
import { PgBaseDatos } from './adapters/pg/baseDatos.js';
import { PgAlertaRepo, PgMedicionRepo, PgOutbox } from './adapters/pg/repositorios.js';
import { MongoPayloadStore } from './adapters/mongo/payloadStore.js';
import { crearNotificador } from './adapters/notificador.js';
import { AuthService } from './services/authService.js';
import { IngestaService } from './services/ingestaService.js';
import { MotorAlertas } from './services/motorAlertas.js';
import { CorreosCuentaService } from './services/correosCuentaService.js';
import { MantenimientoService } from './services/mantenimientoService.js';
import { EstadoService } from './services/estadoService.js';
import { AlertasService } from './services/alertasService.js';
import { HistoricoService } from './services/historicoService.js';
import { UmbralService } from './services/umbralService.js';
import { InfraService } from './services/infraService.js';
import { UsuarioService } from './services/usuarioService.js';
import { InvitacionService } from './services/invitacionService.js';
import { CultivoService } from './services/cultivoService.js';
import { ContinuidadService } from './services/continuidadService.js';
import { DemoService } from './services/demoService.js';

/** Punto único de composición: aquí se inyectan los adaptadores en los servicios. */
export function crearServicios(cfg: Config, deps?: { db?: IBaseDatos; payloads?: IPayloadStore; notificador?: INotificador }) {
  const db = deps?.db ?? new PgBaseDatos(cfg.DATABASE_URL);
  const payloads = deps?.payloads ?? new MongoPayloadStore(cfg.MONGO_URL, cfg.MONGO_DB);
  const notificador = deps?.notificador ?? crearNotificador(cfg);
  const mediciones = new PgMedicionRepo();
  const outbox = new PgOutbox(db);
  const auth = new AuthService(db, cfg);
  return {
    db,
    payloads,
    auth,
    ingesta: new IngestaService(db, mediciones, outbox, payloads, cfg),
    motor: new MotorAlertas(db, mediciones, new PgAlertaRepo(), outbox, notificador),
    correosCuenta: new CorreosCuentaService(db, notificador),
    mantenimiento: new MantenimientoService(db, cfg.ANONIMIZAR_TRAS_DIAS),
    estado: new EstadoService(db, cfg),
    alertas: new AlertasService(db),
    historico: new HistoricoService(db),
    umbrales: new UmbralService(db),
    infra: new InfraService(db),
    usuarios: new UsuarioService(db, (id) => auth.invalidarCache(id)),
    invitaciones: new InvitacionService(db, cfg),
    cultivos: new CultivoService(db),
    continuidad: new ContinuidadService(db, payloads, cfg),
    demo: new DemoService(cfg),
  };
}
export type Servicios = ReturnType<typeof crearServicios>;
