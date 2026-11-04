/**
 * Granularidad del histórico según el rango (CU-05 paso 4):
 * crudos hasta 24 h, 15 min hasta 7 días, 1 h hasta 30 días y 1 día en rangos mayores.
 */
export function granularidadPara(desde: Date, hasta: Date): { etiqueta: string; segundos: number } {
  const horas = (hasta.getTime() - desde.getTime()) / 3_600_000;
  if (horas <= 24) return { etiqueta: 'crudo', segundos: 0 };
  if (horas <= 24 * 7) return { etiqueta: '15 min', segundos: 900 };
  if (horas <= 24 * 30) return { etiqueta: '1 h', segundos: 3600 };
  return { etiqueta: '1 día', segundos: 86400 };
}
