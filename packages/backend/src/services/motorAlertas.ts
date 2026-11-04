import type { IAlertaRepo, IBaseDatos, IMedicionRepo, INotificador, IOutbox } from '../ports/index.js';
import { registrarEvento } from './auditoria.js';

/**
 * Motor de alertas (CU-04, sección 3.1). Consume el outbox con SKIP LOCKED;
 * cada lote se evalúa en su propia transacción (atomicidad medición ↔ evaluación).
 * La notificación se envía en otro paso, después del COMMIT.
 */
export class MotorAlertas {
  static readonly MAX_INTENTOS = 5;

  constructor(
    private readonly db: IBaseDatos,
    private readonly mediciones: IMedicionRepo,
    private readonly alertas: IAlertaRepo,
    private readonly outbox: IOutbox,
    private readonly notificador: INotificador,
  ) {}

  /** Procesa hasta `max` lotes pendientes. Devuelve cuántos procesó. */
  async procesarPendientes(max = 50): Promise<number> {
    let n = 0;
    while (n < max) {
      let trabajo: { id: number; id_lote: string } | undefined;
      try {
        const hecho = await this.db.transaccion(async (tx) => {
          const [t] = await this.outbox.tomar(tx, 1);
          if (!t) return false;
          trabajo = t;
          const meds = await this.mediciones.porLote(tx, t.id_lote);
          const umbrales = await this.alertas.umbralesActivos(tx, [...new Set(meds.map((m) => m.id_sensor))]);
          // Sensor sin umbral → no se evalúa (RN-02).
          // Medición–Alerta es 1 : 0..1 (Tabla 32): si la lectura viola varios umbrales
          // del sensor se aplica solo el más severo (crítico antes que advertencia).
          for (const m of meds) {
            const violados = umbrales
              .filter((x) => x.id_sensor === m.id_sensor && (m.valor < x.valor_min || m.valor > x.valor_max))
              .sort((a, b) => (a.severidad === 'critica' ? -1 : 1) - (b.severidad === 'critica' ? -1 : 1));
            if (violados[0]) await this.alertas.registrarViolacion(tx, m, violados[0], violados[0].severidad === 'critica');
          }
          await this.outbox.marcarProcesado(tx, t.id);
          return true;
        });
        if (!hecho) break;
        n++;
      } catch (e) {
        if (!trabajo) throw e;
        const { cuarentena } = await this.outbox.registrarFallo(trabajo.id, (e as Error).message, MotorAlertas.MAX_INTENTOS);
        if (cuarentena) {
          const t = trabajo;
          await this.db.transaccion(async (tx) => {
            const r = await tx.query<{ id_dispositivo: number }>(`SELECT id_dispositivo FROM lote_ingesta WHERE id_lote = $1`, [t.id_lote]);
            if (r.rows[0]) {
              await registrarEvento(tx, r.rows[0].id_dispositivo, 'cuarentena', 'Lote en cuarentena: la evaluación de alertas falló 5 veces', {
                id_lote: t.id_lote,
                error: (e as Error).message,
              });
            }
          });
        }
        break;
      }
    }
    return n;
  }

  /**
   * Envía las notificaciones pendientes de alertas críticas (RF-11, Could).
   * Nunca declara enviado un aviso si el proveedor falla o no está configurado.
   */
  async procesarNotificaciones(): Promise<number> {
    const r = await this.db.query<{
      id_alerta: number;
      id_instalacion: number;
      torre: string;
      variable: string;
      unidad: string;
      valor: number;
      valor_min: number;
      valor_max: number;
      intentos: number;
      id_dispositivo: number;
      fecha_generacion: Date;
    }>(
      `SELECT a.id_alerta, i.id_instalacion, i.nombre AS torre, tv.nombre AS variable, tv.unidad_medida AS unidad,
              a.valor, a.valor_min, a.valor_max, a.notificacion_intentos AS intentos, d.id_dispositivo, a.fecha_generacion
         FROM alerta a
         JOIN sensor s ON s.id_sensor = a.id_sensor
         JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
         JOIN dispositivo d ON d.id_dispositivo = s.id_dispositivo
         JOIN instalacion i ON i.id_instalacion = d.id_instalacion
        WHERE a.notificacion_estado = 'pendiente'
        ORDER BY a.fecha_generacion LIMIT 20`,
    );
    let enviadas = 0;
    for (const a of r.rows) {
      if (!this.notificador.configurado) {
        await this.db.query(`UPDATE alerta SET notificacion_estado = 'no_configurada' WHERE id_alerta = $1`, [a.id_alerta]);
        continue;
      }
      const dest = await this.db.query<{ email: string }>(
        `SELECT DISTINCT u.email FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
          LEFT JOIN usuario_instalacion ui ON ui.id_usuario = u.id_usuario
          WHERE u.activo AND (r.nombre = 'supervisor' OR ui.id_instalacion = $1)`,
        [a.id_instalacion],
      );
      try {
        await this.notificador.enviar({
          destinatarios: dest.rows.map((d) => d.email),
          asunto: `[AquaPlants] Alerta CRÍTICA en ${a.torre}: ${a.variable}`,
          texto: `Valor medido ${a.valor} ${a.unidad} fuera del rango [${a.valor_min}, ${a.valor_max}] — ${a.fecha_generacion.toISOString()}`,
        });
        await this.db.query(`UPDATE alerta SET notificacion_estado = 'enviada', notificacion_intentos = notificacion_intentos + 1 WHERE id_alerta = $1`, [a.id_alerta]);
        enviadas++;
      } catch (e) {
        const fallida = a.intentos + 1 >= 3;
        await this.db.transaccion(async (tx) => {
          await tx.query(
            `UPDATE alerta SET notificacion_intentos = notificacion_intentos + 1,
                    notificacion_estado = CASE WHEN $2 THEN 'fallida' ELSE 'pendiente' END WHERE id_alerta = $1`,
            [a.id_alerta, fallida],
          );
          if (fallida) {
            await registrarEvento(tx, a.id_dispositivo, 'notificacion_fallida', 'No se pudo enviar el aviso de alerta crítica tras 3 intentos', {
              id_alerta: a.id_alerta,
              error: (e as Error).message,
            });
          }
        });
      }
    }
    return enviadas;
  }
}
