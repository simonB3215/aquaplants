-- =====================================================================
-- Registro de respaldos (ES2 Tabla 16): «El job registra tamaño y suma
-- SHA-256; si falla, envía un correo al Administrador».
-- El contenedor de respaldo no tiene salida a Internet ni permisos de
-- escritura en el negocio: solo puede INSERTAR aquí (rol backup_ro). El
-- worker detecta los fallos y programa el correo (tipo respaldo_fallido).
-- =====================================================================
CREATE TABLE respaldo_registro (
  id_respaldo    bigserial PRIMARY KEY,
  iniciado_en    timestamptz NOT NULL,
  terminado_en   timestamptz NOT NULL DEFAULT now(),
  estado         text NOT NULL CHECK (estado IN ('ok', 'fallido')),
  archivos       jsonb NOT NULL DEFAULT '[]',   -- [{nombre, bytes, sha256}]
  detalle        text NULL,
  notificado_en  timestamptz NULL
);
CREATE INDEX respaldo_registro_fallido_idx ON respaldo_registro (terminado_en) WHERE estado = 'fallido' AND notificado_en IS NULL;

ALTER TABLE notificacion_correo DROP CONSTRAINT notificacion_correo_tipo_check;
ALTER TABLE notificacion_correo ADD CONSTRAINT notificacion_correo_tipo_check
  CHECK (tipo IN ('cambio_password', 'restablecer_password', 'respaldo_fallido'));
