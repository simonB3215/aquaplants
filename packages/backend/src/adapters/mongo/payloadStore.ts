import { MongoClient, type Collection, type Db } from 'mongodb';
import type { DocumentoPayload, IPayloadStore } from '../../ports/index.js';
import { PersistenciaError } from '../../errores.js';

/**
 * Payload crudo de telemetría y detalle variable de eventos en MongoDB
 * (ES2 §4.4). Índice único {id_lote} (idempotencia) y TTL de 90 días.
 */
export class MongoPayloadStore implements IPayloadStore {
  private cliente: MongoClient;
  private db!: Db;
  private payloads!: Collection<DocumentoPayload>;
  private detalles!: Collection<Record<string, unknown>>;
  private listo: Promise<void> | null = null;

  constructor(
    url: string,
    private readonly nombreDb: string,
  ) {
    this.cliente = new MongoClient(url, { serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000 });
  }

  private conectar(): Promise<void> {
    if (!this.listo) {
      this.listo = (async () => {
        await this.cliente.connect();
        this.db = this.cliente.db(this.nombreDb);
        this.payloads = this.db.collection<DocumentoPayload>('payload_telemetria');
        this.detalles = this.db.collection('detalle_evento');
        await this.payloads.createIndex({ id_lote: 1 }, { unique: true });
        await this.payloads.createIndex({ estado: 1, recibido_en: 1 });
        try {
          await this.payloads.createIndex({ recibido_en: 1 }, { expireAfterSeconds: 90 * 86400, name: 'ttl_90d' });
        } catch (e) {
          console.warn('[mongo] índice TTL no creado:', (e as Error).message);
        }
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
      console.error('[mongo] no disponible:', (e as Error).message);
      throw new PersistenciaError('Almacenamiento de payloads no disponible');
    }
  }

  async guardarRecibido(doc: Omit<DocumentoPayload, 'estado' | 'recibido_en'>): Promise<void> {
    await this.op(() =>
      this.payloads.updateOne(
        { id_lote: doc.id_lote },
        { $setOnInsert: { ...doc, estado: 'recibido', recibido_en: new Date() } },
        { upsert: true },
      ),
    );
  }

  async marcarProcesado(idLote: string): Promise<void> {
    await this.op(() => this.payloads.updateOne({ id_lote: idLote }, { $set: { estado: 'procesado' } }));
  }

  async recibidosSinProcesar(antiguedadMin: number, limite: number): Promise<DocumentoPayload[]> {
    const limiteFecha = new Date(Date.now() - antiguedadMin * 60_000);
    return this.op(() =>
      this.payloads
        .find({ estado: 'recibido', recibido_en: { $lt: limiteFecha } }, { projection: { _id: 0 } })
        .limit(limite)
        .toArray() as Promise<DocumentoPayload[]>,
    );
  }

  async guardarDetalleEvento(detalle: Record<string, unknown>): Promise<string> {
    return this.op(async () => {
      const r = await this.detalles.insertOne({ ...detalle, creado_en: new Date() });
      return r.insertedId.toString();
    });
  }

  async ping(): Promise<void> {
    await this.op(() => this.db.command({ ping: 1 }));
  }

  async cerrar(): Promise<void> {
    await this.cliente.close();
  }
}
