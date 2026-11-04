import type { Lectura } from '@aquaplants/shared';
import type {
  Consulta,
  IAlertaRepo,
  IBaseDatos,
  IMedicionRepo,
  IOutbox,
  MedicionInsertada,
  UmbralVigente,
} from '../../ports/index.js';

export class PgMedicionRepo implements IMedicionRepo {
  async insertarLote(tx: Consulta, idLote: string, lecturas: Lectura[]): Promise<MedicionInsertada[]> {
    // Inserción por arreglo (unnest): una sola sentencia, parametrizada.
    const r = await tx.query<MedicionInsertada>(
      `INSERT INTO medicion (ts, id_sensor, valor, id_lote)
       SELECT x.ts, x.id_sensor, x.valor, $4::uuid
         FROM unnest($1::timestamptz[], $2::int[], $3::float8[]) AS x(ts, id_sensor, valor)
       ON CONFLICT (id_sensor, ts) DO NOTHING
       RETURNING id_medicion, ts, id_sensor, valor`,
      [lecturas.map((l) => l.ts), lecturas.map((l) => l.id_sensor), lecturas.map((l) => l.valor), idLote],
    );
    return r.rows;
  }

  async porLote(tx: Consulta, idLote: string): Promise<MedicionInsertada[]> {
    const r = await tx.query<MedicionInsertada>(
      `SELECT id_medicion, ts, id_sensor, valor FROM medicion WHERE id_lote = $1 ORDER BY ts, id_sensor`,
      [idLote],
    );
    return r.rows;
  }
}

export class PgAlertaRepo implements IAlertaRepo {
  async umbralesActivos(tx: Consulta, idsSensor: number[]): Promise<UmbralVigente[]> {
    if (idsSensor.length === 0) return [];
    const r = await tx.query<UmbralVigente>(
      `SELECT id_umbral, id_sensor, severidad, valor_min, valor_max
         FROM umbral WHERE activo AND id_sensor = ANY($1::int[])`,
      [idsSensor],
    );
    return r.rows;
  }

  async registrarViolacion(
    tx: Consulta,
    m: MedicionInsertada,
    u: UmbralVigente,
    notificar: boolean,
  ): Promise<{ id_alerta: number; nueva: boolean }> {
    // Índice único parcial (id_sensor, id_umbral) WHERE estado='activa' + ON CONFLICT:
    // efecto exactamente una vez sobre las alertas (sección 3.1).
    const r = await tx.query<{ id_alerta: number; nueva: boolean }>(
      `INSERT INTO alerta (id_sensor, id_umbral, id_medicion, ts_medicion, valor, valor_min, valor_max,
                           severidad, ultimo_valor, ts_ultima, notificacion_estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, $4, $9)
       ON CONFLICT (id_sensor, id_umbral) WHERE estado = 'activa'
       DO UPDATE SET ultimo_valor = EXCLUDED.ultimo_valor,
                     ts_ultima   = GREATEST(alerta.ts_ultima, EXCLUDED.ts_ultima),
                     ocurrencias = alerta.ocurrencias + 1
       RETURNING id_alerta, (xmax = 0) AS nueva`,
      [m.id_sensor, u.id_umbral, m.id_medicion, m.ts, m.valor, u.valor_min, u.valor_max, u.severidad, notificar ? 'pendiente' : 'no_aplica'],
    );
    return r.rows[0];
  }
}

export class PgOutbox implements IOutbox {
  constructor(private readonly db: IBaseDatos) {}

  async encolar(tx: Consulta, idLote: string): Promise<void> {
    await tx.query(`INSERT INTO outbox_evaluacion (id_lote) VALUES ($1)`, [idLote]);
  }

  async tomar(tx: Consulta, limite: number) {
    const r = await tx.query<{ id: number; id_lote: string; intentos: number }>(
      `SELECT id, id_lote, intentos FROM outbox_evaluacion
        WHERE procesado_en IS NULL AND NOT cuarentena
        ORDER BY creado_en
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limite],
    );
    return r.rows;
  }

  async marcarProcesado(tx: Consulta, id: number): Promise<void> {
    await tx.query(`UPDATE outbox_evaluacion SET procesado_en = now() WHERE id = $1`, [id]);
  }

  async registrarFallo(id: number, error: string, maxIntentos: number): Promise<{ cuarentena: boolean }> {
    const r = await this.db.query<{ cuarentena: boolean }>(
      `UPDATE outbox_evaluacion
          SET intentos = intentos + 1, ultimo_error = left($2, 500), cuarentena = (intentos + 1 >= $3)
        WHERE id = $1 RETURNING cuarentena`,
      [id, error, maxIntentos],
    );
    return { cuarentena: r.rows[0]?.cuarentena ?? false };
  }
}
