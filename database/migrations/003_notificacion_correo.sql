-- =====================================================================
-- Avisos por correo de seguridad de la cuenta (p. ej. cambio de contraseña).
-- La API solo registra el aviso en la misma transacción que el cambio
-- (la API no tiene salida a Internet); el worker lo envía por SMTP.
-- Nunca se guarda ni se envía la contraseña.
-- =====================================================================
CREATE TABLE notificacion_correo (
  id_notificacion  bigserial PRIMARY KEY,
  id_usuario       integer NOT NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  tipo             text NOT NULL CHECK (tipo IN ('cambio_password')),
  destinatario     text NOT NULL,
  asunto           text NOT NULL,
  texto            text NOT NULL,
  estado           text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviada', 'fallida', 'no_configurada')),
  intentos         integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error     text NULL,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  enviado_en       timestamptz NULL
);
CREATE INDEX notificacion_correo_pendiente_idx ON notificacion_correo (creado_en) WHERE estado = 'pendiente';
