// Utilidades de la prueba de carga CP-27 (D-35). Lee las conexiones de .env.nube (no versionado).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'packages/backend/package.json'));
export const pg = require('pg');
const env = Object.fromEntries(fs.readFileSync(path.join(raiz, '.env.nube'), 'utf8').split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const certificado = (url) => url.replace('sslrootcert=certificados/', `sslrootcert=${path.join(raiz, 'certificados').split(path.sep).join('/')}/`);
export const supabase = () => new pg.Client({ connectionString: certificado(env.DATABASE_URL) });
export const neon = () => new pg.Client({ connectionString: env.PAYLOADS_DATABASE_URL });
export const TORRE = 'Carga CP-27 (temporal)';
// Contiene tokens de dispositivos temporales: no se versiona (ver .gitignore).
export const ARCHIVO = new URL('./dispositivos-carga.json', import.meta.url);
