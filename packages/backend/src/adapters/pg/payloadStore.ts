import pg from 'pg';
import type { DocumentoPayload, IPayloadStore } from '../../ports/index.js';
import { PersistenciaError } from '../../errores.js';

/**
 * Alternativa a MongoPayloadStore sobre un PostgreSQL separado (p. ej. Neon):
 * payload crudo en jsonb con la misma semántica — clave única id_lote
 * (idempotencia) y purga de 90 días en lugar del índice TTL.
 */
export class PgPayloadStore implements IPayloadStore {
  private pool: pg.Pool;
  private listo: Promise<void> | null = null;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 });
    this.pool.on('error', (e) => console.error('[payloads-pg] error de conexión inactiva:', e.message));
  }

  private conectar(): Promise<void> {
    if (!this.listo) {
      this.listo = (async () => {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS payload_telemetria (
            id_lote        text PRIMARY KEY,
            id_dispositivo integer NOT NULL,
            payload        jsonb NOT NULL,
            estado         text NOT NULL CHECK (estado IN ('recibido', 'procesado')),
            recibido_en    timestamptz NOT NULL DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS payload_telemetria_estado_idx ON payload_telemetria (estado, recibido_en);
          CREATE TABLE IF NOT EXISTS detalle_evento (
            id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            detalle   jsonb NOT NULL,
            creado_en timestamptz NOT NULL DEFAULT now()
          );`);
        const r = await this.pool.query(`DELETE FROM payload_telemetria WHERE recibido_en < now() - interval '90 days'`);
        if (r.rowCount) console.log(`[payloads-pg] purgados ${r.rowCount} payloads de más de 90 días`);
      })().catch((e) => {
        this.listo = null;
        throw e;
      });
    }
    return this.listo;
  }

  private async op<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await this.conectar();
      return await fn();
    } catch (e) {
      console.error('[payloads-pg] no disponible:', (e as Error).message);
      throw new PersistenciaError('Almacenamiento de payloads no disponible');
    }
  }

  async guardarRecibido(doc: Omit<DocumentoPayload, 'estado' | 'recibido_en'>): Promise<void> {
    await this.op(() =>
      this.pool.query(
        `INSERT INTO payload_telemetria (id_lote, id_dispositivo, payload, estado)
         VALUES ($1, $2, $3, 'recibido') ON CONFLICT (id_lote) DO NOTHING`,
        [doc.id_lote, doc.id_dispositivo, JSON.stringify(doc.payload)],
      ),
    );
  }

  async marcarProcesado(idLote: string): Promise<void> {
    await this.op(() => this.pool.query(`UPDATE payload_telemetria SET estado = 'procesado' WHERE id_lote = $1`, [idLote]));
  }

  async recibidosSinProcesar(antiguedadMin: number, limite: number): Promise<DocumentoPayload[]> {
    return this.op(async () => {
      const r = await this.pool.query<DocumentoPayload>(
        `SELECT id_lote, id_dispositivo, payload, estado, recibido_en FROM payload_telemetria
          WHERE estado = 'recibido' AND recibido_en < now() - make_interval(mins => $1)
          LIMIT $2`,
        [antiguedadMin, limite],
      );
      return r.rows;
    });
  }

  async guardarDetalleEvento(detalle: Record<string, unknown>): Promise<string> {
    return this.op(async () => {
      const r = await this.pool.query<{ id: string }>(`INSERT INTO detalle_evento (detalle) VALUES ($1) RETURNING id::text`, [JSON.stringify(detalle)]);
      return r.rows[0].id;
    });
  }

  async ping(): Promise<void> {
    await this.op(() => this.pool.query('SELECT 1'));
  }

  async cerrar(): Promise<void> {
    await this.pool.end();
  }
}
