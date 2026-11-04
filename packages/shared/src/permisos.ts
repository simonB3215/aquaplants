/**
 * Matriz de autorización — Tabla 48 del informe ES2 (fuente de verdad).
 *
 * El backend aplica esta matriz en cada endpoint (middleware `permitir`).
 * El frontend la usa SOLO como ayuda visual para construir el menú;
 * ocultar un botón no protege nada (sección 6.1 del ES2).
 *
 * Valores: 'si' = permitido, 'lectura' = solo lectura, 'no' = denegado.
 */
export const ROLES = ['encargado', 'supervisor', 'administrador'] as const;
export type Rol = (typeof ROLES)[number];
export type Actor = Rol | 'dispositivo';

export type NivelPermiso = 'si' | 'lectura' | 'no';

export const FUNCIONALIDADES = {
  'telemetria.enviar': { cu: 'CU-01', encargado: 'no', supervisor: 'no', administrador: 'no', dispositivo: 'si' },
  'sesion.iniciar': { cu: 'CU-02', encargado: 'si', supervisor: 'si', administrador: 'si', dispositivo: 'no' },
  'estado.ver': { cu: 'CU-03', encargado: 'si', supervisor: 'si', administrador: 'si', dispositivo: 'no' },
  'alertas.ver': { cu: 'CU-04', encargado: 'si', supervisor: 'si', administrador: 'si', dispositivo: 'no' },
  'alertas.resolver_advertencia': { cu: 'CU-04', encargado: 'si', supervisor: 'si', administrador: 'si', dispositivo: 'no' },
  'alertas.resolver_critica': { cu: 'CU-04', encargado: 'no', supervisor: 'si', administrador: 'si', dispositivo: 'no' },
  'historicos.consultar': { cu: 'CU-05', encargado: 'si', supervisor: 'si', administrador: 'si', dispositivo: 'no' },
  'historicos.comparar_exportar': { cu: 'CU-06', encargado: 'no', supervisor: 'si', administrador: 'si', dispositivo: 'no' },
  'umbrales.gestionar': { cu: 'CU-07', encargado: 'lectura', supervisor: 'lectura', administrador: 'si', dispositivo: 'no' },
  'infraestructura.gestionar': { cu: 'CU-08', encargado: 'lectura', supervisor: 'lectura', administrador: 'si', dispositivo: 'no' },
  'usuarios.gestionar': { cu: 'CU-09', encargado: 'no', supervisor: 'no', administrador: 'si', dispositivo: 'no' },
  'auditoria.consultar': { cu: 'CU-09', encargado: 'no', supervisor: 'no', administrador: 'si', dispositivo: 'no' },
  'cultivos.gestionar': { cu: 'CU-10', encargado: 'si', supervisor: 'lectura', administrador: 'si', dispositivo: 'no' },
} as const satisfies Record<string, { cu: string } & Record<Actor, NivelPermiso>>;

export type Funcionalidad = keyof typeof FUNCIONALIDADES;
export type Accion = 'leer' | 'escribir';

/** ¿Puede el actor realizar la acción sobre la funcionalidad? */
export function autorizado(actor: Actor, funcionalidad: Funcionalidad, accion: Accion = 'escribir'): boolean {
  const nivel: NivelPermiso = FUNCIONALIDADES[funcionalidad][actor];
  if (nivel === 'si') return true;
  if (nivel === 'lectura') return accion === 'leer';
  return false;
}

/** Restricción de datos RN-10: el Encargado solo accede a sus torres asignadas. */
export function accedeATodasLasTorres(rol: Rol): boolean {
  return rol === 'supervisor' || rol === 'administrador';
}

export const ETIQUETA_ROL: Record<Rol, string> = {
  encargado: 'Encargado de cultivo',
  supervisor: 'Supervisor',
  administrador: 'Administrador',
};
