/**
 * Nombre propuesto para una torre nueva dentro de un cliente (evita escribirlo a mano).
 * Sigue la serie que ya usa el cliente: «Torre A, Torre B» → «Torre C»; «Torre 1, Torre 2» → «Torre 3».
 * Sin torres, o si ya se usaron A–Z, numera. Nunca repite un nombre existente (sin distinguir mayúsculas).
 */
export function siguienteNombreTorre(existentes: string[]): string {
  const usados = new Set(existentes.map((n) => n.trim().toLowerCase()));
  const letras = existentes.map((n) => /^torre ([a-z])$/i.exec(n.trim())?.[1]?.toUpperCase()).filter((x): x is string => !!x);
  const numeros = existentes.map((n) => /^torre (\d+)$/i.exec(n.trim())?.[1]).filter((x): x is string => !!x).map(Number);
  if (letras.length > numeros.length) {
    for (let c = Math.max(...letras.map((l) => l.charCodeAt(0))) + 1; c <= 90; c++) {
      const n = `Torre ${String.fromCharCode(c)}`;
      if (!usados.has(n.toLowerCase())) return n;
    }
  }
  let i = Math.max(0, ...numeros) + 1;
  while (usados.has(`torre ${i}`)) i++;
  return `Torre ${i}`;
}
