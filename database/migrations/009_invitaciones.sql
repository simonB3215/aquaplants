-- =====================================================================
-- Registro mediante enlace de invitación por torre (D-28, amplía CU-09).
-- El Administrador genera UN enlace para una o más torres; quien lo usa
-- crea su propia cuenta, confirma su email y queda como Encargado de esas
-- torres. Rol FIJO (encargado): un enlace nunca otorga Supervisor ni
-- Administrador. Vence, tiene cupo y puede anularse.
-- Solo se guardan los resúmenes SHA-256 de los tokens (enlace y confirmación).
-- =====================================================================
CREATE TABLE invitacion (
  id_invitacion  serial PRIMARY KEY,
  hash_token     text NOT NULL UNIQUE,
  descripcion    text NOT NULL DEFAULT '' CHECK (length(descripcion) <= 120),
  creada_por     integer NOT NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  creada_en      timestamptz NOT NULL DEFAULT now(),
  vence_en       timestamptz NOT NULL,
  max_usos       integer NOT NULL CHECK (max_usos BETWEEN 1 AND 500),
  usos           integer NOT NULL DEFAULT 0,
  anulada_en     timestamptz NULL,
  CONSTRAINT invitacion_vence_ck CHECK (vence_en > creada_en),
  CONSTRAINT invitacion_cupo_ck CHECK (usos BETWEEN 0 AND max_usos)
);

CREATE TABLE invitacion_instalacion (
  id_invitacion   integer NOT NULL REFERENCES invitacion(id_invitacion) ON DELETE CASCADE,
  id_instalacion  integer NOT NULL REFERENCES instalacion(id_instalacion) ON DELETE RESTRICT,
  PRIMARY KEY (id_invitacion, id_instalacion)
);

-- Solicitud de cuenta a la espera de que la persona confirme su email.
-- Al confirmarse se crea el usuario y se borra el hash de la contraseña de aquí;
-- las no confirmadas se eliminan al día siguiente de vencer (minimización, Ley 19.628).
CREATE TABLE registro_pendiente (
  id_registro    bigserial PRIMARY KEY,
  id_invitacion  integer NOT NULL REFERENCES invitacion(id_invitacion) ON DELETE RESTRICT,
  nombre         text NOT NULL CHECK (length(trim(nombre)) > 0),
  email          text NOT NULL,
  hash_password  text NULL,
  hash_token     text NOT NULL UNIQUE,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  expira_en      timestamptz NOT NULL,
  confirmado_en  timestamptz NULL,
  id_usuario     integer NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  ip_solicitud   text NULL,
  CONSTRAINT registro_confirmado_ck CHECK ((confirmado_en IS NULL) = (id_usuario IS NULL))
);
CREATE INDEX registro_pendiente_email_idx ON registro_pendiente (lower(email), creado_en DESC);
CREATE INDEX registro_pendiente_vencido_idx ON registro_pendiente (expira_en) WHERE confirmado_en IS NULL;

-- Los correos de registro se envían antes de que exista el usuario.
ALTER TABLE notificacion_correo ALTER COLUMN id_usuario DROP NOT NULL;
ALTER TABLE notificacion_correo ADD COLUMN id_registro bigint NULL REFERENCES registro_pendiente(id_registro) ON DELETE SET NULL;
ALTER TABLE notificacion_correo DROP CONSTRAINT notificacion_correo_tipo_check;
ALTER TABLE notificacion_correo ADD CONSTRAINT notificacion_correo_tipo_check
  CHECK (tipo IN ('cambio_password', 'restablecer_password', 'respaldo_fallido', 'confirmar_registro', 'cuenta_existente'));
