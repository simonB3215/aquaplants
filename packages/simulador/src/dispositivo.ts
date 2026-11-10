import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EventoDispositivo, Lote } from '@aquaplants/shared';
import { ColaPersistente } from './cola.js';
import { rssiSimulado, SENSOR_POR_DEFECTO, valorSensor, type ModoSensor, type SensorSim } from './generador.js';

export interface ConfigDispositivo {
  id_dispositivo: number;
  nombre: string;
  torre: string;
  token: string;
  intervalo_s: number;
  sensores: SensorSim[];
}

export interface OpcionesSim {
  apiUrl: string;
  dataDir: string;
  capacidadBytes: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** false en pruebas: las mediciones se disparan manualmente con medir(). */
  medicionAutomatica?: boolean;
}

type EventoPendiente = EventoDispositivo & { lecturas?: undefined };

export interface EstadoDispositivo {
  id_dispositivo: number;
  nombre: string;
  torre: string;
  energia: boolean;
  red: boolean;
  intervalo_s: number;
  cola_lotes: number;
  cola_bytes: number;
  capacidad_bytes: number;
  eventos_pendientes: number;
  rechazados: number;
  descartes: ReturnType<ColaPersistente<Lote>['descartes']>;
  enviados_ok: number;
  duplicados: number;
  ultimo_envio_ok: string | null;
  ultimo_error: string | null;
  proximo_reintento: string | null;
  credencial_rechazada: boolean;
  modos: Record<number, ModoSensor>;
  /** Intensidad de señal informada en el último envío (dBm). */
  rssi_dbm: number;
  rssi_forzado: number | null;
  sensores: { id_sensor: number; clave: string }[];
}

/**
 * Dispositivo AquaBrain virtual. Proceso independiente del navegador que usa la
 * MISMA API que un equipo real. Reglas de continuidad (ES2 §3.4):
 *  - Sin Internet y con energía: sigue midiendo y persiste lotes en su cola.
 *  - Sin energía: no mide; lo ya persistido sobrevive; lo no persistido se pierde.
 *  - Al volver: reabre la cola, informa el reinicio y sincroniza sin duplicar.
 */
export class DispositivoVirtual {
  private cola!: ColaPersistente<Lote>;
  private eventos!: ColaPersistente<EventoPendiente>;
  private timer: NodeJS.Timeout | null = null;
  private bombeando = false;
  private esperaHasta = 0;
  private intentos = 0;
  private controlador: AbortController | null = null;
  private readonly dir: string;
  energia = false;
  red = true;
  modos: Record<number, ModoSensor> = {};
  enviadosOk = 0;
  duplicados = 0;
  ultimoEnvioOk: string | null = null;
  ultimoError: string | null = null;
  credencialRechazada = false;
  ultimoLoteConfirmado: Lote | null = null;
  /** Señal fija para la demostración (p. ej. -95 = débil); null = valor simulado normal. */
  rssiForzado: number | null = null;
  private sincronizador: NodeJS.Timeout | null = null;
  /** true cuando la API respondió /telemetria/configuracion (versión con D-35: acepta meta.rssi_dbm). */
  apiConSenal = false;

  constructor(
    readonly cfg: ConfigDispositivo,
    private readonly op: OpcionesSim,
  ) {
    this.dir = path.join(op.dataDir, `dispositivo-${cfg.id_dispositivo}`);
    mkdirSync(this.dir, { recursive: true });
  }

  private log(msg: string, extra?: Record<string, unknown>) {
    const linea = JSON.stringify({ ts: new Date().toISOString(), dispositivo: this.cfg.id_dispositivo, msg, ...extra });
    appendFileSync(path.join(this.dir, 'bitacora.log'), linea + '\n');
    console.log(`[${this.cfg.nombre}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
  }

  /** Arranque (también tras un corte eléctrico): reabre la cola persistente desde disco. */
  encender(motivo = 'arranque') {
    if (this.energia) return;
    this.cola = new ColaPersistente<Lote>(path.join(this.dir, 'cola'), this.op.capacidadBytes);
    this.eventos = new ColaPersistente<EventoPendiente>(path.join(this.dir, 'eventos'), 256 * 1024);
    this.energia = true;
    this.intentos = 0;
    this.esperaHasta = 0;
    this.log('encendido', { motivo, lotes_en_cola: this.cola.longitud });
    this.encolarEvento('reinicio', { motivo: `Arranque del dispositivo (${motivo})`, pendientes_en_cola: this.cola.longitud });
    this.programar();
    void this.bombear();
    if (this.op.medicionAutomatica !== false) {
      void this.sincronizarSensores();
      if (this.sincronizador) clearInterval(this.sincronizador);
      this.sincronizador = setInterval(() => void this.sincronizarSensores(), 10 * 60_000).unref();
    }
  }

  /** Corte eléctrico simulado: se detiene todo; lo no persistido se pierde. */
  apagar() {
    if (!this.energia) return;
    this.energia = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.sincronizador) clearInterval(this.sincronizador);
    this.sincronizador = null;
    this.controlador?.abort(); // un envío en curso no llega a confirmarse: el lote sigue en la cola
    this.log('apagado (corte eléctrico simulado): no se generan mediciones', { lotes_en_cola: this.cola.longitud });
  }

  setRed(conectado: boolean) {
    if (this.red === conectado) return;
    this.red = conectado;
    this.log(conectado ? 'red restablecida' : 'red cortada: las lecturas se guardan en la cola local');
    if (conectado && this.energia) {
      this.intentos = 0;
      this.esperaHasta = 0;
      this.encolarEvento('reconexion_local', { motivo: 'Conectividad de red restablecida', pendientes_en_cola: this.cola.longitud });
      void this.bombear();
    }
  }

  /** Intensidad de señal (dBm) que se informa con cada lote (D-35). */
  rssi(): number {
    return this.rssiForzado ?? rssiSimulado(this.cfg.id_dispositivo, Date.now());
  }

  setRssi(dbm: number | null) {
    this.rssiForzado = dbm == null ? null : Math.max(-130, Math.min(0, Math.round(dbm)));
    this.log(dbm == null ? 'señal normal' : `señal fijada en ${this.rssiForzado} dBm`);
  }

  /**
   * D-35: pide a la API los sensores activos del dispositivo. Así un sensor agregado
   * desde Infraestructura empieza a medir sin editar dispositivos.json, y uno dado de
   * baja deja de enviarse (evita lotes rechazados). Si la API no responde se conserva
   * la lista actual.
   */
  async sincronizarSensores(): Promise<boolean> {
    if (!this.energia || !this.red) return false;
    try {
      const r = await fetch(`${this.op.apiUrl}/telemetria/configuracion`, {
        headers: { authorization: `Bearer ${this.cfg.token}`, 'x-device-id': String(this.cfg.id_dispositivo) },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status !== 200) return false;
      this.apiConSenal = true;
      const j = (await r.json()) as { sensores?: { id_sensor: number; clave: string }[] };
      if (!Array.isArray(j.sensores) || j.sensores.length === 0) return false;
      const antes = new Map(this.cfg.sensores.map((s) => [s.id_sensor, s]));
      const nuevos = j.sensores.map((s) => antes.get(s.id_sensor) ?? { id_sensor: s.id_sensor, clave: s.clave, ...(SENSOR_POR_DEFECTO[s.clave] ?? { base: 1, amplitud: 0.1 }) });
      const agregados = nuevos.filter((s) => !antes.has(s.id_sensor)).map((s) => s.clave);
      const quitados = this.cfg.sensores.filter((s) => !nuevos.some((n) => n.id_sensor === s.id_sensor)).map((s) => s.clave);
      this.cfg.sensores = nuevos;
      if (agregados.length || quitados.length) this.log('sensores sincronizados con la API', { agregados, quitados });
      return true;
    } catch {
      return false;
    }
  }

  setIntervalo(s: number) {
    this.cfg.intervalo_s = s;
    if (this.energia) this.programar();
  }

  private programar() {
    if (this.timer) clearTimeout(this.timer);
    if (this.op.medicionAutomatica === false) return;
    const ciclo = () => {
      if (!this.energia) return;
      this.medir();
      this.timer = setTimeout(ciclo, this.cfg.intervalo_s * 1000).unref();
    };
    this.timer = setTimeout(ciclo, 1000).unref();
  }

  /** Toma una lectura de cada sensor y PERSISTE el lote antes de intentar enviarlo. */
  medir() {
    if (!this.energia) return;
    const ahora = Date.now();
    const ts = new Date(Math.floor(ahora / 1000) * 1000).toISOString();
    const lote: Lote = {
      id_lote: randomUUID(),
      id_dispositivo: this.cfg.id_dispositivo,
      lecturas: this.cfg.sensores.map((s) => ({ id_sensor: s.id_sensor, ts, valor: valorSensor(s, ahora, this.modos[s.id_sensor]) })),
      meta: { recuperado: !this.red, firmware: 'sim-1.0' },
    };
    this.cola.encolar(lote.id_lote, lote);
    if (!this.red) this.log('lectura almacenada localmente (sin red)', { id_lote: lote.id_lote, cola: this.cola.longitud });
    void this.bombear();
  }

  private encolarEvento(tipo: EventoDispositivo['tipo'], detalle: EventoDispositivo['detalle']) {
    const ev: EventoPendiente = { id_evento_local: randomUUID(), id_dispositivo: this.cfg.id_dispositivo, tipo, ts: new Date().toISOString(), detalle };
    this.eventos.encolar(ev.id_evento_local, ev);
  }

  private backoff(retryAfterS?: number) {
    this.intentos++;
    const base = Math.min(this.op.backoffBaseMs * 2 ** (this.intentos - 1), this.op.backoffMaxMs);
    const jitter = base * (Math.random() * 0.4 - 0.2); // ±20 % (desincroniza dispositivos)
    const espera = retryAfterS ? retryAfterS * 1000 : Math.round(base + jitter);
    this.esperaHasta = Date.now() + espera;
    setTimeout(() => void this.bombear(), espera + 10).unref();
    return espera;
  }

  private async post(ruta: string, cuerpo: unknown) {
    this.controlador = new AbortController();
    const t = setTimeout(() => this.controlador?.abort(), 8000);
    try {
      const r = await fetch(`${this.op.apiUrl}${ruta}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.token}`, 'x-device-id': String(this.cfg.id_dispositivo) },
        body: JSON.stringify(cuerpo),
        signal: this.controlador.signal,
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: r.status, json, retryAfter: Number(r.headers.get('retry-after')) || undefined };
    } finally {
      clearTimeout(t);
    }
  }

  /** Envía eventos y lotes pendientes en orden FIFO; libera solo con confirmación. */
  async bombear(): Promise<void> {
    if (this.bombeando || !this.energia) return;
    if (!this.red || Date.now() < this.esperaHasta) return;
    this.bombeando = true;
    try {
      // 1) Descartes acumulados → evento datos_descartados (periodo perdido explicado).
      const d = this.cola.descartes();
      if (d) {
        this.encolarEvento('datos_descartados', { desde: d.desde, hasta: d.hasta, lotes: d.lotes, lecturas: d.lecturas, motivo: d.motivo });
        this.cola.limpiarDescartes();
      }
      // 2) Eventos del dispositivo.
      for (let e = this.eventos.primero(); e && this.energia && this.red; e = this.eventos.primero()) {
        const r = await this.post('/telemetria/eventos', e.item);
        if (r.status === 200 || r.status === 201) this.eventos.confirmar(e.archivo);
        else if (r.status === 401 || r.status === 422) {
          this.eventos.rechazar(e.archivo);
          if (r.status === 401) this.credencialRechazada = true;
        } else {
          this.ultimoError = `eventos: HTTP ${r.status}`;
          this.backoff(r.retryAfter);
          return;
        }
      }
      // 3) Lotes de mediciones.
      for (let p = this.cola.primero(); p && this.energia && this.red; p = this.cola.primero()) {
        const lote: Lote = { ...p.item, meta: { ...p.item.meta, pendientes: this.cola.longitud - 1, ...(this.apiConSenal ? { rssi_dbm: this.rssi() } : {}) } };
        const r = await this.post('/telemetria', lote);
        if (r.status === 201 || r.status === 200) {
          this.cola.confirmar(p.archivo);
          this.ultimoLoteConfirmado = lote;
          this.ultimoError = null;
          this.intentos = 0;
          this.credencialRechazada = false;
          this.ultimoEnvioOk = new Date().toISOString();
          if (r.json.duplicado) {
            this.duplicados++;
            this.log('lote duplicado confirmado por el servidor; se libera', { id_lote: lote.id_lote });
          } else this.enviadosOk++;
          continue;
        }
        if (r.status === 401) {
          // No reintenta: mueve el lote a rechazados y enciende el indicador local.
          this.cola.rechazar(p.archivo);
          this.credencialRechazada = true;
          this.ultimoError = 'Credencial rechazada (401)';
          this.log('credencial rechazada: lote movido a rechazados', { id_lote: lote.id_lote });
          continue;
        }
        if (r.status === 422 && r.json.codigo === 'RELOJ_DESFASADO') {
          const antiguo = JSON.stringify(r.json).includes('antigüedad');
          if (antiguo) {
            this.cola.registrarDescarte(p.item, 'lote más antiguo que la tolerancia del servidor (48 h)');
            this.cola.confirmar(p.archivo);
            this.log('lote descartado por antigüedad', { id_lote: lote.id_lote });
            continue;
          }
          // Reloj adelantado: nunca se vacía el buffer; se espera y reintenta.
          this.ultimoError = 'Reloj desfasado (422)';
          this.backoff();
          return;
        }
        if (r.status === 400 || r.status === 422 || r.status === 409) {
          this.cola.rechazar(p.archivo);
          this.ultimoError = `Lote rechazado (${r.status}: ${String(r.json.mensaje ?? '')})`;
          this.log('lote rechazado por validación', { id_lote: lote.id_lote, status: r.status, respuesta: r.json });
          continue;
        }
        // 429, 503, 5xx: reintento con espera exponencial y el mismo id_lote.
        this.ultimoError = `HTTP ${r.status}`;
        const espera = this.backoff(r.retryAfter);
        this.log('envío no confirmado; reintento programado', { status: r.status, espera_ms: espera });
        return;
      }
    } catch (e) {
      if (this.energia) {
        this.ultimoError = `Sin conexión con la API (${(e as Error).name === 'AbortError' ? 'tiempo agotado' : (e as Error).message})`;
        const espera = this.backoff();
        this.log('error de red; el lote permanece en la cola', { espera_ms: espera });
      }
    } finally {
      this.bombeando = false;
      this.controlador = null;
    }
  }

  estado(): EstadoDispositivo {
    const abierta = !!this.cola;
    return {
      id_dispositivo: this.cfg.id_dispositivo,
      nombre: this.cfg.nombre,
      torre: this.cfg.torre,
      energia: this.energia,
      red: this.red,
      intervalo_s: this.cfg.intervalo_s,
      cola_lotes: abierta ? this.cola.longitud : 0,
      cola_bytes: abierta ? this.cola.tamanoBytes : 0,
      capacidad_bytes: this.op.capacidadBytes,
      eventos_pendientes: abierta ? this.eventos.longitud : 0,
      rechazados: abierta ? this.cola.rechazados : 0,
      descartes: abierta ? this.cola.descartes() : null,
      enviados_ok: this.enviadosOk,
      duplicados: this.duplicados,
      ultimo_envio_ok: this.ultimoEnvioOk,
      ultimo_error: this.ultimoError,
      proximo_reintento: this.esperaHasta > Date.now() ? new Date(this.esperaHasta).toISOString() : null,
      credencial_rechazada: this.credencialRechazada,
      modos: this.modos,
      rssi_dbm: this.rssi(),
      rssi_forzado: this.rssiForzado,
      sensores: this.cfg.sensores.map((s) => ({ id_sensor: s.id_sensor, clave: s.clave })),
    };
  }

  /** Reenvía a propósito el último lote confirmado para demostrar la idempotencia. */
  async reenviarLote(lote: Lote) {
    return this.post('/telemetria', lote);
  }

  /** Prueba de credencial inválida: lote de prueba con token aleatorio (no toca la cola real). */
  async probarCredencialInvalida() {
    const lote: Lote = {
      id_lote: randomUUID(),
      id_dispositivo: this.cfg.id_dispositivo,
      lecturas: [{ id_sensor: this.cfg.sensores[0].id_sensor, ts: new Date().toISOString(), valor: 1 }],
    };
    const r = await fetch(`${this.op.apiUrl}/telemetria`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer credencial-invalida-${randomUUID()}` },
      body: JSON.stringify(lote),
    });
    const json = await r.json().catch(() => ({}));
    this.log('prueba de credencial inválida', { status: r.status });
    return { status: r.status, respuesta: json, esperado: 401, correcto: r.status === 401 };
  }
}
