/** Para buscar sin distinguir mayúsculas ni tildes. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
