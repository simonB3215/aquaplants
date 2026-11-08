import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carpeta raíz del repositorio (este archivo vive en packages/backend/src o packages/backend/dist). */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Si la URL de PostgreSQL trae `sslrootcert` con una ruta relativa (p. ej.
 * `certificados/supabase-ca.crt`), la convierte en absoluta respecto de la raíz
 * del repositorio. Así la misma configuración funciona en cualquier computador
 * y en Render, sin importar dónde esté clonado el proyecto ni desde qué carpeta
 * se ejecute npm.
 */
export function resolverCertificado(url: string, raiz?: string): string;
export function resolverCertificado(url: string | undefined, raiz?: string): string | undefined;
export function resolverCertificado(url: string | undefined, raiz = RAIZ): string | undefined {
  if (!url) return url;
  return url.replace(/([?&]sslrootcert=)([^&]+)/, (_t, prefijo: string, valor: string) => {
    const ruta = decodeURIComponent(valor);
    if (path.isAbsolute(ruta) || /^[A-Za-z]:[\\/]/.test(ruta)) return prefijo + valor;
    return prefijo + path.resolve(raiz, ruta).split(path.sep).join('/');
  });
}
