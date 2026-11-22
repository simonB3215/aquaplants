/**
 * Matriz de autorización — Tabla 48 del informe ES2, ampliada por el Anexo C
 * (Tabla 70, D-37) con los roles Técnico y Administrador principal.
 * Fuente de verdad: el backend la aplica en cada endpoint (middleware `permitir`).
 * El frontend la usa SOLO como ayuda visual para construir el menú;
 * ocultar un botón no protege nada (sección 6.1 del ES2).
 *
 * Valores: 'si' = permitido, 'lectura' = solo lectura, 'no' = denegado.
 * Las columnas encargado, supervisor y administrador conservan la Tabla 48,
 * salvo «usuarios» del Supervisor, que pasa a «solo sus Encargados» (CU-09).
 */
export const ROLES = ['encargado', 'supervisor', 'tecnico', 'administrador', 'administrador_principal'] as const;
export type Rol = (typeof ROLES)[number];
export type Actor = Rol | 'dispositivo';

export type NivelPermiso = 'si' | 'lectura' | 'no';

type Fila = { cu: string } & Record<Actor, NivelPermiso>;
const fila = (cu: string, encargado: NivelPermiso, supervisor: NivelPermiso, tecnico: NivelPermiso, administrador: NivelPermiso, dispositivo: NivelPermiso = 'no'): Fila => ({
  cu,
  encargado,
  supervisor,
  tecnico,
  administrador,
  // El Administrador principal tiene todo lo del Administrador (y además gestiona Administradores).
  administrador_principal: administrador,
  dispositivo,
});

export const FUNCIONALIDADES = {
  'telemetria.enviar': fila('CU-01', 'no', 'no', 'no', 'no', 'si'),
  'sesion.iniciar': fila('CU-02', 'si', 'si', 'si', 'si'),
  'estado.ver': fila('CU-03', 'si', 'si', 'si', 'si'),
  // El Técnico no ve alertas de cultivo: recibe las incidencias de equipos (RN-13).
  'alertas.ver': fila('CU-04', 'si', 'si', 'no', 'si'),
  'alertas.resolver_advertencia': fila('CU-04', 'si', 'si', 'no', 'si'),
  'alertas.resolver_critica': fila('CU-04', 'no', 'si', 'no', 'si'),
  'historicos.consultar': fila('CU-05', 'si', 'si', 'si', 'si'),
  'historicos.comparar_exportar': fila('CU-06', 'no', 'si', 'no', 'si'),
  'umbrales.gestionar': fila('CU-07', 'lectura', 'lectura', 'lectura', 'si'),
  'infraestructura.gestionar': fila('CU-08', 'lectura', 'lectura', 'lectura', 'si'),
  // Supervisor: solo los Encargados de su cliente (el alcance lo aplica el servicio).
  'usuarios.gestionar': fila('CU-09', 'no', 'si', 'no', 'si'),
  'auditoria.consultar': fila('CU-09', 'no', 'no', 'no', 'si'),
  'cultivos.gestionar': fila('CU-10', 'si', 'lectura', 'no', 'si'),
  // Nuevas (Anexo C).
  'incidencias.atender': fila('RN-13', 'no', 'lectura', 'si', 'si'),
  'clientes.gestionar': fila('RN-11', 'no', 'no', 'no', 'si'),
  'administradores.gestionar': { ...fila('RN-12', 'no', 'no', 'no', 'no'), administrador_principal: 'si' },
} as const satisfies Record<string, Fila>;

export type Funcionalidad = keyof typeof FUNCIONALIDADES;
export type Accion = 'leer' | 'escribir';

/** ¿Puede el actor realizar la acción sobre la funcionalidad? Un rol desconocido no puede nada. */
export function autorizado(actor: Actor, funcionalidad: Funcionalidad, accion: Accion = 'escribir'): boolean {
  const nivel: NivelPermiso | undefined = (FUNCIONALIDADES[funcionalidad] as Record<string, NivelPermiso>)[actor];
  if (nivel === 'si') return true;
  if (nivel === 'lectura') return accion === 'leer';
  return false;
}

/** Ambos niveles de Administrador ven todo (RN-10 modificada). */
export function esAdministracion(rol: Rol): boolean {
  return rol === 'administrador' || rol === 'administrador_principal';
}

/** RN-10 modificada: solo los Administradores ven todas las torres; el resto, su alcance. */
export function accedeATodasLasTorres(rol: Rol): boolean {
  return esAdministracion(rol);
}

/** Supervisor y Encargado pertenecen a un cliente (RN-11). */
export function rolConCliente(rol: Rol): boolean {
  return rol === 'supervisor' || rol === 'encargado';
}

/**
 * RN-12: cada nivel gestiona solo niveles inferiores. El Supervisor, solo Encargados
 * (de su cliente: lo comprueba el servicio). Nadie crea ni modifica un Administrador
 * principal desde la aplicación: se designa fuera de ella (script).
 */
export function puedeGestionarRol(actor: Rol, objetivo: Rol): boolean {
  if (objetivo === 'administrador_principal') return false;
  if (actor === 'administrador_principal') return true;
  if (actor === 'administrador') return objetivo !== 'administrador';
  if (actor === 'supervisor') return objetivo === 'encargado';
  return false;
}

/** Roles que el actor puede asignar (para formularios). */
export function rolesAsignables(actor: Rol): Rol[] {
  return ROLES.filter((r) => puedeGestionarRol(actor, r));
}

export const ETIQUETA_ROL: Record<Rol, string> = {
  encargado: 'Encargado de cultivo',
  supervisor: 'Supervisor',
  tecnico: 'Técnico',
  administrador: 'Administrador',
  administrador_principal: 'Administrador principal',
};
