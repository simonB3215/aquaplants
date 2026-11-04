/** Excepciones de dominio tipadas (Tabla 11 del ES2). */
export class ErrorApp extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly campos?: { campo: string; mensaje: string }[],
    public readonly cabeceras?: Record<string, string>,
  ) {
    super(mensaje);
  }
}

export class ReglaNegocioError extends ErrorApp {
  constructor(mensaje: string, campos?: { campo: string; mensaje: string }[], codigo = 'REGLA_NEGOCIO') {
    super(422, codigo, mensaje, campos);
  }
}
export class ConflictoError extends ErrorApp {
  constructor(mensaje: string, codigo = 'CONFLICTO') {
    super(409, codigo, mensaje);
  }
}
export class NoAutorizadoError extends ErrorApp {
  constructor(mensaje = 'No tiene permisos para esta operación', codigo = 'PROHIBIDO') {
    super(403, codigo, mensaje);
  }
}
export class NoAutenticadoError extends ErrorApp {
  constructor(mensaje = 'Autenticación requerida', codigo = 'NO_AUTENTICADO') {
    super(401, codigo, mensaje);
  }
}
export class NoEncontradoError extends ErrorApp {
  constructor(mensaje = 'Recurso no encontrado') {
    super(404, 'NO_ENCONTRADO', mensaje);
  }
}
export class PersistenciaError extends ErrorApp {
  constructor(mensaje = 'Servicio de datos no disponible', retryAfterS = 30) {
    super(503, 'SERVICIO_NO_DISPONIBLE', mensaje, undefined, { 'Retry-After': String(retryAfterS) });
  }
}
