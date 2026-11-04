import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Ejecutor de migraciones SQL versionadas (database/migrations/NNN_*.sql).
 * 002_timescale.sql se aplica solo si la extensión timescaledb está disponible.
 * Uso: npm run db:migrate            (aplica pendientes)
 *      npm run db:migrate -- --reset (SOLO desarrollo: borra el esquema)
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));
const candidatos = [process.env.MIGRATIONS_DIR, path.resolve(aqui, '../../../../database/migrations'), path.resolve(process.cwd(), 'database/migrations')];
const DIR = candidatos.find((c) => c && existsSync(c));

export async function migrar(url: string, opciones: { reset?: boolean; silencioso?: boolean } = {}) {
  if (!DIR) throw new Error('No se encontró database/migrations (defina MIGRATIONS_DIR)');
  const log = opciones.silencioso ? () => undefined : console.log;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    if (opciones.reset) {
      if (process.env.NODE_ENV === 'production') throw new Error('--reset no está permitido en producción');
      log('[migrate] reinicio del esquema (desarrollo)');
      await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migraciones (version text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now(), nota text)`);
    const aplicadas = new Set((await c.query<{ version: string }>('SELECT version FROM schema_migraciones')).rows.map((r) => r.version));
    const archivos = (await readdir(DIR)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const ts = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_available_extensions WHERE name = 'timescaledb'`);
    const hayTimescale = ts.rows[0].n > 0;
    for (const f of archivos) {
      if (aplicadas.has(f)) continue;
      if (f.includes('timescale') && !hayTimescale) {
        log(`[migrate] ${f}: OMITIDA (timescaledb no disponible en este servidor; se usa PostgreSQL estándar)`);
        await c.query(`INSERT INTO schema_migraciones (version, nota) VALUES ($1, 'omitida: sin timescaledb')`, [f]);
        continue;
      }
      const sql = await readFile(path.join(DIR, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query(`INSERT INTO schema_migraciones (version) VALUES ($1)`, [f]);
        await c.query('COMMIT');
        log(`[migrate] ${f}: aplicada`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Falló ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
}

const esPrincipal = process.argv[1] && /migrate\.(t|j)s$/.test(process.argv[1]);
if (esPrincipal) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_URL');
    process.exit(1);
  }
  migrar(url, { reset: process.argv.includes('--reset') })
    .then(() => console.log('[migrate] listo'))
    .catch((e) => {
      console.error('[migrate]', e.message);
      process.exit(1);
    });
}
