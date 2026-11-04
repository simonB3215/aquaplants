import pg from 'pg';
import type { Consulta, IBaseDatos, ResultadoConsulta } from '../../ports/index.js';
import { ErrorApp, PersistenciaError, ConflictoError } from '../../errores.js';

// int8 (bigint) y numeric como string por defecto; los timestamps como Date.
pg.types.setTypeParser(20, (v) => v); // bigint → string (ids de medición/alerta grandes)

/** Traduce errores de PostgreSQL a errores de dominio (Tabla 11/12). */
export function traducirErrorPg(e: unknown): never {
  if (e instanceof ErrorApp) throw e;
  const err = e as { code?: string; message?: string };
  const code = err.code ?? '';
  if (code.startsWith('23')) {
    // Violación de restricción no prevista: 409 sin exponer el detalle técnico.
    console.error('[pg] restricción', code, err.message);
    throw new ConflictoError('La operación viola una restricción de integridad', 'RESTRICCION');
  }
  if (code === 'P0001') {
    throw new ErrorApp(405, 'NO_PERMITIDO', err.message ?? 'Operación no permitida');
  }
  if (
    code.startsWith('08') ||
    code === '57P01' ||
    code === '57P03' ||
    code === '53300' ||
    /ECONNREFUSED|timeout|Connection terminated|ENOTFOUND/i.test(err.message ?? '')
  ) {
    console.error('[pg] no disponible', err.message);
    throw new PersistenciaError();
  }
  throw e;
}

class ClienteTx implements Consulta {
  constructor(private readonly c: pg.PoolClient) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<ResultadoConsulta<T>> {
    const r = await this.c.query(sql, params as unknown[]);
    return { rows: r.rows as T[], rowCount: r.rowCount };
  }
}

export class PgBaseDatos implements IBaseDatos {
  private readonly pool: pg.Pool;

  constructor(url: string, opciones: Partial<pg.PoolConfig> = {}) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 2000, // Tabla 12: timeout de 2 s → 503
      statement_timeout: 10_000, // Tabla 28: 504/aviso si una consulta excede 10 s
      ...opciones,
    });
    this.pool.on('error', (e) => console.error('[pg] error del pool', e.message));
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<ResultadoConsulta<T>> {
    try {
      const r = await this.pool.query(sql, params as unknown[]);
      return { rows: r.rows as T[], rowCount: r.rowCount };
    } catch (e) {
      traducirErrorPg(e);
    }
  }

  async transaccion<T>(fn: (tx: Consulta) => Promise<T>): Promise<T> {
    let cliente: pg.PoolClient;
    try {
      cliente = await this.pool.connect();
    } catch (e) {
      traducirErrorPg(e);
    }
    try {
      await cliente.query('BEGIN');
      const r = await fn(new ClienteTx(cliente));
      await cliente.query('COMMIT');
      return r;
    } catch (e) {
      try {
        await cliente.query('ROLLBACK');
      } catch {
        /* conexión perdida: el servidor revierte solo */
      }
      traducirErrorPg(e);
    } finally {
      cliente.release();
    }
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }

  async cerrar(): Promise<void> {
    await this.pool.end();
  }
}
