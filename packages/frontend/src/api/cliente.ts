import type { ErrorApi } from '@aquaplants/shared';

/**
 * ApiClient: única salida HTTP del frontend (Tabla 13). Agrega el JWT (que vive
 * SOLO en memoria, sección 6.1) y traduce errores a ApiError. Distingue:
 *  - Sin Internet en el teléfono (navigator.onLine = false)
 *  - API inaccesible (error de red o 5xx de infraestructura) → «Sin conexión con el servidor»
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly campos: { campo: string; mensaje: string }[] = [],
  ) {
    super(mensaje);
  }
  campo(nombre: string): string | undefined {
    return this.campos.find((c) => c.campo === nombre)?.mensaje;
  }
  get esConectividad() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

type Oyente = (evento: 'no_autenticado' | 'servidor_ok' | 'servidor_caido') => void;

let token: string | null = null;
const oyentes = new Set<Oyente>();
export const api = {
  establecerToken(t: string | null) {
    token = t;
  },
  get token() {
    return token;
  },
  suscribir(fn: Oyente): () => void {
    oyentes.add(fn);
    return () => {
      oyentes.delete(fn);
    };
  },
  get: <T>(ruta: string, señal?: AbortSignal) => solicitud<T>('GET', ruta, undefined, señal),
  post: <T>(ruta: string, cuerpo?: unknown) => solicitud<T>('POST', ruta, cuerpo),
  put: <T>(ruta: string, cuerpo?: unknown) => solicitud<T>('PUT', ruta, cuerpo),
  patch: <T>(ruta: string, cuerpo?: unknown) => solicitud<T>('PATCH', ruta, cuerpo),
  /** Descarga autenticada (CSV): no se expone el token en la URL. */
  async descargar(ruta: string): Promise<{ blob: Blob; nombre: string }> {
    const r = await crudo('GET', ruta);
    const disp = r.headers.get('content-disposition') ?? '';
    const nombre = /filename="([^"]+)"/.exec(disp)?.[1] ?? 'aquaplants.csv';
    return { blob: await r.blob(), nombre };
  },
};
const emitir = (e: Parameters<Oyente>[0]) => oyentes.forEach((f) => f(e));

async function crudo(metodo: string, ruta: string, cuerpo?: unknown, señal?: AbortSignal): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(`/api/v1${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: señal ?? AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' && señal?.aborted) throw e;
    emitir('servidor_caido');
    throw new ApiError(0, 'SIN_CONEXION', navigator.onLine ? 'Sin conexión con el servidor' : 'Sin conexión a Internet');
  }
  if (r.status >= 502 && r.status <= 504) {
    // Proxy sin API (502/504) o API sin base de datos (503): «Error de servidor».
    emitir('servidor_caido');
    const e = (await r.json().catch(() => null)) as ErrorApi | null;
    throw new ApiError(r.status, e?.codigo ?? 'SERVIDOR_INACCESIBLE', e?.mensaje ?? 'Sin conexión con el servidor');
  }
  emitir('servidor_ok');
  if (!r.ok) {
    const e = (await r.json().catch(() => null)) as ErrorApi | null;
    if (r.status === 401 && token) emitir('no_autenticado');
    throw new ApiError(r.status, e?.codigo ?? 'ERROR', e?.mensaje ?? `Error ${r.status}`, e?.campos ?? []);
  }
  return r;
}

async function solicitud<T>(metodo: string, ruta: string, cuerpo?: unknown, señal?: AbortSignal): Promise<T> {
  const r = await crudo(metodo, ruta, cuerpo, señal);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

/** Construye una query string omitiendo vacíos. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
