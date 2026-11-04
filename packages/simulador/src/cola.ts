import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

/**
 * Cola FIFO persistente basada en archivos (equivalente simulado de la cola en
 * LittleFS del firmware, ES2 §3.2). Cada elemento es un archivo JSON escrito con
 * fsync + rename atómico; solo se elimina tras la confirmación del servidor.
 * Si se supera la capacidad configurada se descartan los MÁS ANTIGUOS y se
 * registra el periodo perdido en `descartes.json` (persistente).
 */
export interface Descarte {
  desde: string;
  hasta: string;
  lotes: number;
  lecturas: number;
  motivo: string;
}

function escribirAtomico(destino: string, contenido: string) {
  const tmp = `${destino}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, contenido);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, destino);
}

export class ColaPersistente<T extends { lecturas?: { ts: string }[] }> {
  private readonly dirPend: string;
  private readonly dirRech: string;
  private readonly archDescartes: string;
  private seq = 0;

  constructor(
    dir: string,
    private readonly capacidadBytes: number,
  ) {
    this.dirPend = path.join(dir, 'pendientes');
    this.dirRech = path.join(dir, 'rechazados');
    this.archDescartes = path.join(dir, 'descartes.json');
    mkdirSync(this.dirPend, { recursive: true });
    mkdirSync(this.dirRech, { recursive: true });
    // Al reabrir tras un reinicio: limpiar temporales incompletos y continuar la secuencia.
    for (const f of readdirSync(this.dirPend)) if (f.endsWith('.tmp')) unlinkSync(path.join(this.dirPend, f));
    const ult = this.archivos().at(-1);
    this.seq = ult ? Number(ult.split('_')[0]) : 0;
  }

  private archivos(): string[] {
    return readdirSync(this.dirPend)
      .filter((f) => f.endsWith('.json'))
      .sort();
  }

  get tamanoBytes(): number {
    return this.archivos().reduce((a, f) => a + statSync(path.join(this.dirPend, f)).size, 0);
  }

  get longitud(): number {
    return this.archivos().length;
  }

  /** Persiste el elemento ANTES de intentar enviarlo. */
  encolar(id: string, item: T): void {
    const contenido = JSON.stringify(item);
    this.seq++;
    escribirAtomico(path.join(this.dirPend, `${String(this.seq).padStart(12, '0')}_${id}.json`), contenido);
    this.aplicarCapacidad();
  }

  private aplicarCapacidad() {
    let total = this.tamanoBytes;
    const archivos = this.archivos();
    let i = 0;
    while (total > this.capacidadBytes && i < archivos.length - 1) {
      const f = archivos[i++];
      const p = path.join(this.dirPend, f);
      const size = statSync(p).size;
      const item = JSON.parse(readFileSync(p, 'utf8')) as T;
      unlinkSync(p);
      total -= size;
      this.registrarDescarte(item, 'capacidad de la cola local agotada');
    }
  }

  registrarDescarte(item: T, motivo: string) {
    const ts = (item.lecturas ?? []).map((l) => l.ts).sort();
    const d = this.descartes();
    const n = item.lecturas?.length ?? 0;
    if (d && d.motivo === motivo) {
      d.desde = ts[0] && ts[0] < d.desde ? ts[0] : d.desde;
      d.hasta = ts.at(-1) && ts.at(-1)! > d.hasta ? ts.at(-1)! : d.hasta;
      d.lotes++;
      d.lecturas += n;
      escribirAtomico(this.archDescartes, JSON.stringify(d));
    } else {
      escribirAtomico(this.archDescartes, JSON.stringify({ desde: ts[0] ?? new Date().toISOString(), hasta: ts.at(-1) ?? new Date().toISOString(), lotes: 1, lecturas: n, motivo }));
    }
  }

  descartes(): Descarte | null {
    if (!existsSync(this.archDescartes)) return null;
    return JSON.parse(readFileSync(this.archDescartes, 'utf8')) as Descarte;
  }

  limpiarDescartes() {
    if (existsSync(this.archDescartes)) unlinkSync(this.archDescartes);
  }

  /** Primer elemento pendiente (FIFO) sin quitarlo. */
  primero(): { archivo: string; item: T } | null {
    const f = this.archivos()[0];
    if (!f) return null;
    return { archivo: f, item: JSON.parse(readFileSync(path.join(this.dirPend, f), 'utf8')) as T };
  }

  /** Libera un elemento SOLO tras la confirmación (201 o 200 duplicado). */
  confirmar(archivo: string) {
    const p = path.join(this.dirPend, archivo);
    if (existsSync(p)) unlinkSync(p);
  }

  /** Mueve un elemento a la cola de rechazados (401/422 no recuperable). */
  rechazar(archivo: string) {
    const p = path.join(this.dirPend, archivo);
    if (existsSync(p)) renameSync(p, path.join(this.dirRech, archivo));
  }

  get rechazados(): number {
    return readdirSync(this.dirRech).filter((f) => f.endsWith('.json')).length;
  }
}
