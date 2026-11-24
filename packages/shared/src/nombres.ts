/**
 * Nombre propuesto para una torre nueva dentro de un cliente (evita escribirlo a mano).
 * Sigue la serie que ya usa el cliente, aunque el nombre lleve un agregado («Torre A · Lechuga»):
 * «Torre A, Torre B» → «Torre C»; «Torre 1, Torre 2» → «Torre 3».
 * Sin serie, o si ya se usaron A–Z, numera. Nunca repite una serie existente (sin distinguir mayúsculas).
 */
export function siguienteNombreTorre(existentes: string[]): string {
  // «Torre X» al inicio, seguido de fin o de un separador (espacio, ·, -, :, coma, paréntesis).
  const serie = (n: string, patron: string) => new RegExp(`^torre (${patron})(?=$|[\\s·\\-:,(])`, 'i').exec(n.trim())?.[1];
  const letras = existentes.map((n) => serie(n, '[a-z]')?.toUpperCase()).filter((x): x is string => !!x);
  const numeros = existentes.map((n) => serie(n, '\\d+')).filter((x): x is string => !!x).map(Number);
  const usados = new Set(existentes.map((n) => n.trim().toLowerCase()));
  if (letras.length > numeros.length) {
    const tomadas = new Set(letras);
    for (let c = Math.max(...letras.map((l) => l.charCodeAt(0))) + 1; c <= 90; c++) {
      const l = String.fromCharCode(c);
      if (!tomadas.has(l) && !usados.has(`torre ${l.toLowerCase()}`)) return `Torre ${l}`;
    }
  }
  const tomados = new Set(numeros);
  let i = Math.max(0, ...numeros) + 1;
  while (tomados.has(i) || usados.has(`torre ${i}`)) i++;
  return `Torre ${i}`;
}
