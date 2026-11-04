import type { IBaseDatos } from '../ports/index.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../errores.js';
import { auditar } from './auditoria.js';
import { exigirAccesoTorre, torreDeSensor, type UsuarioCtx } from './acceso.js';

export interface UmbralFila {
  id_umbral: number;
  id_sensor: number;
  severidad: 'advertencia' | 'critica';
  valor_min: number;
  valor_max: number;
  activo: boolean;
  version: number;
  actualizado_en: string;
}

/**
 * CU-07 Configurar umbrales. Escritura solo Administrador (verificado en la ruta);
 * Encargado y Supervisor: solo lectura (Tabla 48). El motor de alertas lee los
 * umbrales vigentes en cada evaluación, por lo que el cambio aplica a la siguiente
 * medición (equivale a invalidar la caché del ES2).
 */
export class UmbralService {
  constructor(private readonly db: IBaseDatos) {}

  async listar(u: UsuarioCtx, idSensor: number, incluirInactivos = false): Promise<UmbralFila[]> {
    await exigirAccesoTorre(this.db, u, await torreDeSensor(this.db, idSensor));
    const r = await this.db.query<UmbralFila>(
      `SELECT id_umbral, id_sensor, severidad, valor_min, valor_max, activo, version, actualizado_en
         FROM umbral WHERE id_sensor = $1 AND (activo OR $2) ORDER BY activo DESC, severidad, id_umbral DESC`,
      [idSensor, incluirInactivos],
    );
    return r.rows;
  }

  private async validarRango(tx: { query: IBaseDatos['query'] }, idSensor: number, min: number, max: number) {
    const r = await tx.query<{ min_fisico: number; max_fisico: number; nombre: string; estado: string }>(
      `SELECT tv.min_fisico, tv.max_fisico, tv.nombre, s.estado FROM sensor s JOIN tipo_variable tv ON tv.id_tipo_variable = s.id_tipo_variable WHERE s.id_sensor = $1`,
      [idSensor],
    );
    const s = r.rows[0];
    if (!s) throw new NoEncontradoError('Sensor no encontrado');
    if (s.estado !== 'activo') throw new ReglaNegocioError('El sensor está dado de baja');
    if (min < s.min_fisico || max > s.max_fisico) {
      throw new ReglaNegocioError(`Valores fuera del rango físico de ${s.nombre} (${s.min_fisico}–${s.max_fisico})`, [
        { campo: min < s.min_fisico ? 'valor_min' : 'valor_max', mensaje: `Rango físico ${s.min_fisico}–${s.max_fisico}` },
      ]);
    }
  }

  async definir(u: UsuarioCtx, idSensor: number, d: { severidad: 'advertencia' | 'critica'; valor_min: number; valor_max: number; version?: number }) {
    return this.db.transaccion(async (tx) => {
      await this.validarRango(tx, idSensor, d.valor_min, d.valor_max);
      const actual = await tx.query<UmbralFila>(
        `SELECT * FROM umbral WHERE id_sensor = $1 AND severidad = $2 AND activo FOR UPDATE`,
        [idSensor, d.severidad],
      );
      const prev = actual.rows[0];
      if (prev) {
        if (d.version === undefined) {
          throw new ConflictoError('Ya existe un umbral activo con esa severidad: edítelo en lugar de crear otro', 'UMBRAL_EXISTENTE');
        }
        return this.actualizar(tx, u, prev, d.valor_min, d.valor_max, d.version);
      }
      const r = await tx.query<UmbralFila>(
        `INSERT INTO umbral (id_sensor, valor_min, valor_max, severidad) VALUES ($1, $2, $3, $4) RETURNING *`,
        [idSensor, d.valor_min, d.valor_max, d.severidad],
      );
      await auditar(tx, u, 'crear_umbral', 'umbral', r.rows[0].id_umbral, { anterior: null, nuevo: d, id_sensor: idSensor });
      return r.rows[0];
    });
  }

  async editar(u: UsuarioCtx, idUmbral: number, d: { valor_min: number; valor_max: number; version: number }) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<UmbralFila>(`SELECT * FROM umbral WHERE id_umbral = $1 FOR UPDATE`, [idUmbral]);
      const prev = r.rows[0];
      if (!prev) throw new NoEncontradoError('Umbral no encontrado');
      if (!prev.activo) throw new ConflictoError('El umbral está desactivado');
      await this.validarRango(tx, prev.id_sensor, d.valor_min, d.valor_max);
      return this.actualizar(tx, u, prev, d.valor_min, d.valor_max, d.version);
    });
  }

  private async actualizar(tx: { query: IBaseDatos['query'] }, u: UsuarioCtx, prev: UmbralFila, min: number, max: number, version: number) {
    if (prev.version !== version) throw new ConflictoError('El umbral fue modificado por otro usuario; recargue y vuelva a intentar', 'VERSION_DESACTUALIZADA');
    const r = await tx.query<UmbralFila>(
      `UPDATE umbral SET valor_min = $2, valor_max = $3, version = version + 1, actualizado_en = now()
        WHERE id_umbral = $1 AND version = $4 RETURNING *`,
      [prev.id_umbral, min, max, version],
    );
    if (!r.rows[0]) throw new ConflictoError('El umbral fue modificado por otro usuario', 'VERSION_DESACTUALIZADA');
    await auditar(tx as never, u, 'editar_umbral', 'umbral', prev.id_umbral, {
      anterior: { valor_min: prev.valor_min, valor_max: prev.valor_max, version: prev.version },
      nuevo: { valor_min: min, valor_max: max, version: r.rows[0].version },
    });
    return r.rows[0];
  }

  async desactivar(u: UsuarioCtx, idUmbral: number) {
    return this.db.transaccion(async (tx) => {
      const r = await tx.query<UmbralFila>(`UPDATE umbral SET activo = false, actualizado_en = now(), version = version + 1 WHERE id_umbral = $1 AND activo RETURNING *`, [
        idUmbral,
      ]);
      if (!r.rows[0]) throw new NoEncontradoError('Umbral no encontrado o ya inactivo');
      await auditar(tx, u, 'desactivar_umbral', 'umbral', idUmbral, { anterior: { activo: true }, nuevo: { activo: false } });
      return r.rows[0];
    });
  }
}
