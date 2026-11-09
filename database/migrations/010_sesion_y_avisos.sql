-- =====================================================================
-- 010 — Sesión que sobrevive al refrescar (D-31) y preferencia de avisos (D-32)
-- =====================================================================

-- D-31: sesión persistente. El navegador guarda un token aleatorio en una cookie
-- httpOnly (JavaScript no la lee); aquí solo se guarda su SHA-256. La sesión vale
-- mientras no venza (8 h, igual que el JWT), no se cierre y la versión de
-- credenciales del usuario no cambie (cambio/restablecimiento de contraseña,
-- cambio de rol o desactivación la invalidan sola).
CREATE TABLE sesion (
  id_sesion      bigserial PRIMARY KEY,
  id_usuario     integer NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  hash_token     text NOT NULL UNIQUE,
  version_token  integer NOT NULL,
  creada_en      timestamptz NOT NULL DEFAULT now(),
  expira_en      timestamptz NOT NULL,
  revocada_en    timestamptz,
  CHECK (expira_en > creada_en)
);
CREATE INDEX sesion_usuario_idx ON sesion (id_usuario);
CREATE INDEX sesion_expira_idx ON sesion (expira_en);

-- D-32: preferencia de correos de alerta crítica.
--   todas    : cada alerta crítica de sus torres, al momento (comportamiento anterior).
--   urgentes : solo las alertas críticas que siguen activas después de ALERTA_URGENTE_MIN.
--   ninguna  : no recibe correos de alerta (solo Administrador; los de seguridad de la
--              cuenta se envían siempre).
ALTER TABLE usuario
  ADD COLUMN aviso_alertas text NOT NULL DEFAULT 'todas'
    CHECK (aviso_alertas IN ('todas', 'urgentes', 'ninguna'));
-- El Administrador no recibía correos de alerta: se conserva ese comportamiento.
UPDATE usuario SET aviso_alertas = 'ninguna'
 WHERE id_rol = (SELECT id_rol FROM rol WHERE nombre = 'administrador');

-- Aviso «urgente» (alerta crítica todavía activa tras ALERTA_URGENTE_MIN).
ALTER TABLE alerta
  ADD COLUMN aviso_urgente_en timestamptz,
  ADD COLUMN aviso_urgente_intentos smallint NOT NULL DEFAULT 0 CHECK (aviso_urgente_intentos BETWEEN 0 AND 3);

-- Una alerta crítica puede no tener a quién avisar al momento (todos eligieron «urgentes»).
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_notificacion_estado_check;
ALTER TABLE alerta ADD CONSTRAINT alerta_notificacion_estado_check
  CHECK (notificacion_estado IN ('no_aplica', 'pendiente', 'enviada', 'fallida', 'no_configurada', 'sin_destinatarios'));
