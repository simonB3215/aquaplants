-- =====================================================================
-- «¿Olvidaste tu contraseña?»: enlace de un solo uso enviado por correo.
-- Solo se guarda el resumen SHA-256 del token (nunca el token), con
-- caducidad y marca de uso. El texto del correo (que lleva el enlace) se
-- borra de notificacion_correo cuando el worker termina de procesarlo.
-- =====================================================================
CREATE TABLE token_restablecimiento (
  id_token       bigserial PRIMARY KEY,
  id_usuario     integer NOT NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  hash_token     text NOT NULL UNIQUE,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  expira_en      timestamptz NOT NULL,
  usado_en       timestamptz NULL,
  ip_solicitud   text NULL
);
CREATE INDEX token_restablecimiento_usuario_idx ON token_restablecimiento (id_usuario, creado_en DESC);

ALTER TABLE notificacion_correo DROP CONSTRAINT notificacion_correo_tipo_check;
ALTER TABLE notificacion_correo ADD CONSTRAINT notificacion_correo_tipo_check CHECK (tipo IN ('cambio_password', 'restablecer_password'));
