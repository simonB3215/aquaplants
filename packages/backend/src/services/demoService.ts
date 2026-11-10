import type { Config } from '../config.js';
import { ErrorApp } from '../errores.js';
import type { IBaseDatos } from '../ports/index.js';

export const ESCENARIOS_DEMO = {
  A: 'Operación normal: el simulador envía mediciones reales a la API',
  B: 'Valor fuera de umbral que crea una alerta',
  C: 'Corte de Internet: el simulador guarda lotes en su cola local persistente',
  D: 'Reconexión: sincroniza los lotes pendientes sin duplicados',
  E: 'Corte eléctrico: el dispositivo deja de medir (se pierde lo no persistido)',
  F: 'Retorno de energía: reinicio, reapertura de la cola y reenvío de lo persistido',
  G: 'Un Encargado intenta crear un usuario (operación de Administrador) y recibe 403',
} as const;
export type CodigoEscenario = keyof typeof ESCENARIOS_DEMO;

/**
 * Modo demostración académico (solo con DEMO_MODE=true, nunca en producción).
 * Los escenarios A–F se ejecutan en el simulador real a través de su API de
 * control; el G hace una petición HTTP real contra esta misma API.
 */
export class DemoService {
  constructor(
    private readonly cfg: Config,
    private readonly db?: IBaseDatos,
  ) {}

  private async sim(ruta: string, init?: RequestInit) {
    try {
      const r = await fetch(new URL(ruta, this.cfg.SIM_CONTROL_URL), {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.SIM_CONTROL_TOKEN ?? ''}` },
        signal: AbortSignal.timeout(4000),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new ErrorApp(502, 'SIMULADOR_ERROR', (cuerpo as { mensaje?: string }).mensaje ?? `El simulador respondió ${r.status}`);
      return cuerpo;
    } catch (e) {
      if (e instanceof ErrorApp) throw e;
      throw new ErrorApp(503, 'SIMULADOR_NO_DISPONIBLE', 'El simulador AquaBrain no está en ejecución o no responde (npm run sim)');
    }
  }

  async estado() {
    let simulador: unknown = null;
    let disponible = true;
    try {
      simulador = await this.sim('/estado');
    } catch {
      disponible = false;
    }
    return { escenarios: ESCENARIOS_DEMO, simulador_disponible: disponible, simulador };
  }

  async ejecutar(codigo: CodigoEscenario, idDispositivo?: number) {
    if (codigo === 'G') return this.escenarioG();
    // B: si el sensor ya tiene una alerta crítica activa, la nueva violación solo suma
    // ocurrencias (sin alerta ni correo nuevos, para no duplicar avisos). Se informa.
    const previa = codigo === 'B' ? await this.alertaCriticaActiva(idDispositivo) : null;
    const r = (await this.sim('/escenario', { method: 'POST', body: JSON.stringify({ codigo, id_dispositivo: idDispositivo }) })) as Record<string, unknown>;
    if (codigo !== 'B') return r;
    return {
      ...r,
      correo: previa
        ? `No se enviará correo: el sensor ya tiene la alerta crítica #${previa} activa y esta violación solo suma una ocurrencia. Resuélvala en Alertas y vuelva a ejecutar B, o elija otro dispositivo.`
        : 'Se creará una alerta crítica nueva y se enviará el correo en 1–2 minutos.',
      alerta_activa_previa: previa,
    };
  }

  /** Alerta crítica activa del sensor de pH (el que usa el escenario B) del dispositivo. */
  private async alertaCriticaActiva(idDispositivo?: number): Promise<number | null> {
    if (!this.db || !idDispositivo) return null;
    const r = await this.db.query<{ id_alerta: string }>(
      `SELECT a.id_alerta FROM alerta a
         JOIN sensor s ON s.id_sensor = a.id_sensor
         JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable
        WHERE s.id_dispositivo = $1 AND tv.clave = 'ph' AND a.estado = 'activa' AND a.severidad = 'critica'
        ORDER BY a.id_alerta DESC LIMIT 1`,
      [idDispositivo],
    );
    return r.rows[0] ? Number(r.rows[0].id_alerta) : null;
  }

  private async escenarioG() {
    const email = this.cfg.DEMO_ENCARGADO_EMAIL;
    const password = this.cfg.DEMO_ENCARGADO_PASSWORD;
    if (!email || !password) throw new ErrorApp(422, 'DEMO_SIN_CREDENCIALES', 'Configure DEMO_ENCARGADO_EMAIL y DEMO_ENCARGADO_PASSWORD');
    const base = `http://127.0.0.1:${this.cfg.PORT}/api/v1`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!login.ok) throw new ErrorApp(422, 'DEMO_LOGIN', `No se pudo iniciar sesión como Encargado de demostración (${login.status})`);
    const { token } = (await login.json()) as { token: string };
    const intento = await fetch(`${base}/usuarios`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: 'Usuario no autorizado', email: 'intruso@example.cl', rol: 'administrador' }),
    });
    const cuerpo = await intento.json().catch(() => null);
    await fetch(`${base}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    return {
      codigo: 'G',
      descripcion: ESCENARIOS_DEMO.G,
      solicitud: 'POST /api/v1/usuarios (con el token del Encargado de demostración)',
      status: intento.status,
      respuesta: cuerpo,
      resultado_esperado: 403,
      correcto: intento.status === 403,
    };
  }
}
