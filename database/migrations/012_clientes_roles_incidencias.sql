-- =====================================================================
-- 012 — Estructura por clientes (Anexo C, D-37)
--   · Cliente: cada torre pertenece a un cliente; Supervisor y Encargado
--     pertenecen a un cliente (RN-11).
--   · Roles nuevos: tecnico y administrador_principal (Tabla 70).
--   · Técnico ↔ clientes que atiende (tecnico_cliente).
--   · Incidencias de equipos para el Técnico (RN-13): hoy «sin señal».
--   · GPS opcional por dispositivo (latitud/longitud, ingreso manual).
-- Los datos existentes pasan a un «Cliente inicial».
--
-- Compatibilidad con el código anterior (mientras se despliega la API nueva):
--   · instalacion.id_cliente e invitacion.id_cliente tienen DEFAULT 1 (el
--     cliente inicial), así los INSERT antiguos sin cliente siguen funcionando.
--   · usuario.id_cliente NO tiene default: un usuario creado por el código
--     anterior queda sin cliente y, con la API nueva, no ve ninguna torre
--     (falla cerrada) hasta que un Administrador le asigne cliente.
-- =====================================================================

-- ---------------------------------------------------------------- Roles
ALTER TABLE rol DROP CONSTRAINT IF EXISTS rol_nombre_check;
ALTER TABLE rol ADD CONSTRAINT rol_nombre_check
  CHECK (nombre IN ('encargado', 'supervisor', 'administrador', 'tecnico', 'administrador_principal'));
-- Solo en bases que ya tienen roles (producción). En una base nueva el seed los crea todos.
INSERT INTO rol (nombre, descripcion)
SELECT v.nombre, v.descripcion FROM (VALUES
  ('tecnico', 'Técnico de AquaPlants: atiende las incidencias de equipos de sus clientes'),
  ('administrador_principal', 'Administrador principal: gestiona Administradores y todo lo de un Administrador')
) AS v(nombre, descripcion)
WHERE EXISTS (SELECT 1 FROM rol)
ON CONFLICT (nombre) DO NOTHING;
UPDATE rol SET descripcion = 'Supervisor del cliente: revisa sus torres, resuelve alertas críticas y gestiona sus Encargados'
 WHERE nombre = 'supervisor';

-- ---------------------------------------------------------------- Clientes
CREATE TABLE cliente (
  id_cliente  serial PRIMARY KEY,
  nombre      text NOT NULL CHECK (length(trim(nombre)) > 0),
  estado      text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja')),
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cliente_nombre_uq ON cliente (lower(nombre));
-- Siempre id 1: la tabla se acaba de crear en esta misma transacción.
INSERT INTO cliente (id_cliente, nombre) VALUES (1, 'Cliente inicial');
SELECT setval(pg_get_serial_sequence('cliente', 'id_cliente'), 1, true);

-- Torres: un cliente por torre; el nombre es único dentro del cliente.
ALTER TABLE instalacion
  ADD COLUMN id_cliente integer NOT NULL DEFAULT 1 REFERENCES cliente(id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX instalacion_cliente_idx ON instalacion (id_cliente);
DROP INDEX IF EXISTS instalacion_nombre_uq;
CREATE UNIQUE INDEX instalacion_nombre_uq ON instalacion (id_cliente, lower(nombre));

-- Usuarios: Supervisor y Encargado pertenecen a un cliente; el resto no.
ALTER TABLE usuario
  ADD COLUMN id_cliente integer NULL REFERENCES cliente(id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX usuario_cliente_idx ON usuario (id_cliente);
UPDATE usuario SET id_cliente = 1
 WHERE id_rol IN (SELECT id_rol FROM rol WHERE nombre IN ('supervisor', 'encargado'));

-- Invitaciones: limitadas al cliente de quien las crea.
ALTER TABLE invitacion
  ADD COLUMN id_cliente integer NOT NULL DEFAULT 1 REFERENCES cliente(id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Técnico ↔ clientes que atiende.
CREATE TABLE tecnico_cliente (
  id_usuario  integer NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  id_cliente  integer NOT NULL REFERENCES cliente(id_cliente) ON DELETE RESTRICT,
  asignado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_usuario, id_cliente)
);
CREATE INDEX tecnico_cliente_cliente_idx ON tecnico_cliente (id_cliente);

-- ---------------------------------------------------------------- GPS por dispositivo (opcional)
ALTER TABLE dispositivo
  ADD COLUMN latitud  double precision NULL CHECK (latitud BETWEEN -90 AND 90),
  ADD COLUMN longitud double precision NULL CHECK (longitud BETWEEN -180 AND 180),
  ADD CONSTRAINT dispositivo_gps_ck CHECK ((latitud IS NULL) = (longitud IS NULL));

-- ---------------------------------------------------------------- Incidencias de equipos (RN-13)
-- Una incidencia abierta por dispositivo. Se abre cuando el dispositivo pasa a
-- «sin señal»; si vuelve a comunicarse se anota, pero la cierra el Técnico (o un
-- Administrador) con un comentario. No reemplaza las alertas de cultivo.
CREATE TABLE incidencia (
  id_incidencia        bigserial PRIMARY KEY,
  id_dispositivo       integer NOT NULL REFERENCES dispositivo(id_dispositivo) ON DELETE RESTRICT,
  tipo                 text NOT NULL DEFAULT 'sin_senal' CHECK (tipo IN ('sin_senal')),
  estado               text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'en_atencion', 'cerrada')),
  abierta_en           timestamptz NOT NULL DEFAULT now(),
  ocurrencias          integer NOT NULL DEFAULT 1 CHECK (ocurrencias >= 1),
  senal_recuperada_en  timestamptz NULL,
  atendida_por         integer NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  atendida_en          timestamptz NULL,
  cerrada_por          integer NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  cerrada_en           timestamptz NULL,
  comentario_cierre    text NULL CHECK (comentario_cierre IS NULL OR length(comentario_cierre) <= 500),
  CONSTRAINT incidencia_atencion_ck CHECK ((atendida_por IS NULL) = (atendida_en IS NULL)),
  CONSTRAINT incidencia_cierre_ck CHECK (
    (estado = 'cerrada' AND cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL AND comentario_cierre IS NOT NULL)
    OR (estado <> 'cerrada' AND cerrada_por IS NULL AND cerrada_en IS NULL))
);
CREATE UNIQUE INDEX incidencia_abierta_uq ON incidencia (id_dispositivo) WHERE estado <> 'cerrada';
CREATE INDEX incidencia_estado_idx ON incidencia (estado, abierta_en DESC);

-- Dispositivos que hoy están sin señal: su incidencia queda abierta.
INSERT INTO incidencia (id_dispositivo, abierta_en)
SELECT d.id_dispositivo, COALESCE(d.ultima_comunicacion, now())
  FROM dispositivo d WHERE d.estado = 'sin_senal'
ON CONFLICT DO NOTHING;
