import type { Consulta } from '../ports/index.js';

export interface Actor {
  id_usuario: number | null;
  ip?: string | null;
}

/** Registro inmutable de acciones (RF-13, RN-07). Se usa dentro de la misma transacción. */
export async function auditar(
  tx: Consulta,
  actor: Actor,
  accion: string,
  entidad: string,
  idEntidad: string | number | null,
  detalle?: Record<string, unknown> | null,
): Promise<void> {
  await tx.query(
    `INSERT INTO log_auditoria (id_usuario, accion, entidad, id_entidad, detalle, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.id_usuario, accion, entidad, idEntidad === null ? null : String(idEntidad), detalle ? JSON.stringify(detalle) : null, actor.ip ?? null],
  );
}

export async function registrarEvento(
  tx: Consulta,
  idDispositivo: number,
  tipo: string,
  descripcion: string,
  detalle?: Record<string, unknown> | null,
  origen: 'servidor' | 'dispositivo' = 'servidor',
  extra?: { id_evento_local?: string; ts?: string; id_detalle_mongo?: string },
): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO evento (id_dispositivo, tipo, descripcion, detalle, origen, id_evento_local, ts, id_detalle_mongo)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8)
     ON CONFLICT (id_dispositivo, id_evento_local) WHERE id_evento_local IS NOT NULL DO NOTHING`,
    [
      idDispositivo,
      tipo,
      descripcion,
      detalle ? JSON.stringify(detalle) : null,
      origen,
      extra?.id_evento_local ?? null,
      extra?.ts ?? null,
      extra?.id_detalle_mongo ?? null,
    ],
  );
  return (r.rowCount ?? 0) > 0;
}
