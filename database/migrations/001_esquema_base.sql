-- =====================================================================
-- AquaPlants / AquaBrain — Esquema físico (PostgreSQL 16)
-- Fuente: Informe ES2, capítulo 4 (Tablas 31, 32, 37, 38 y 39).
-- Las entidades no se borran: baja lógica (RN-08). FK con RESTRICT salvo
-- la tabla de asociación usuario_instalacion (CASCADE).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- Roles / usuarios
CREATE TABLE rol (
  id_rol        smallserial PRIMARY KEY,
  nombre        text NOT NULL UNIQUE CHECK (nombre IN ('encargado','supervisor','administrador')),
  descripcion   text NOT NULL DEFAULT ''
);

CREATE TABLE usuario (
  id_usuario             serial PRIMARY KEY,
  nombre                 text NOT NULL CHECK (length(trim(nombre)) > 0),
  email                  text NOT NULL,
  hash_password          text NOT NULL,
  id_rol                 smallint NOT NULL REFERENCES rol(id_rol) ON DELETE RESTRICT ON UPDATE CASCADE,
  activo                 boolean NOT NULL DEFAULT true,
  debe_cambiar_password  boolean NOT NULL DEFAULT true,
  intentos_fallidos      integer NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  bloqueado_hasta        timestamptz NULL,
  version_token          integer NOT NULL DEFAULT 1,
  creado_en              timestamptz NOT NULL DEFAULT now(),
  desactivado_en         timestamptz NULL
);
CREATE UNIQUE INDEX usuario_email_uq ON usuario (lower(email));

-- ---------------------------------------------------------------- Instalaciones (torres)
CREATE TABLE instalacion (
  id_instalacion  serial PRIMARY KEY,
  nombre          text NOT NULL CHECK (length(trim(nombre)) > 0),
  tipo            text NOT NULL CHECK (tipo IN ('aeroponica','hidroponica')),
  ubicacion       text NOT NULL DEFAULT '',
  estado          text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','baja')),
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instalacion_nombre_uq ON instalacion (lower(nombre));

CREATE TABLE usuario_instalacion (
  id_usuario        integer NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE ON UPDATE CASCADE,
  id_instalacion    integer NOT NULL REFERENCES instalacion(id_instalacion) ON DELETE CASCADE ON UPDATE CASCADE,
  fecha_asignacion  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_usuario, id_instalacion)
);
CREATE INDEX usuario_instalacion_inst_idx ON usuario_instalacion (id_instalacion);

-- ---------------------------------------------------------------- Catálogos
CREATE TABLE tipo_variable (
  id_tipo_variable  smallserial PRIMARY KEY,
  nombre            text NOT NULL UNIQUE,
  clave             text NOT NULL UNIQUE,            -- identificador estable (ph, ce, temperatura…)
  unidad_medida     text NOT NULL,
  min_fisico        double precision NOT NULL,
  max_fisico        double precision NOT NULL,
  max_delta_minuto  double precision NULL,           -- plausibilidad (sección 6.1)
  CHECK (min_fisico < max_fisico)
);

CREATE TABLE especie (
  id_especie   serial PRIMARY KEY,
  nombre       text NOT NULL,
  descripcion  text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX especie_nombre_uq ON especie (lower(nombre));

CREATE TABLE rango_referencia (
  id_rango          serial PRIMARY KEY,
  id_especie        integer NOT NULL REFERENCES especie(id_especie) ON DELETE RESTRICT ON UPDATE RESTRICT,
  id_tipo_variable  smallint NOT NULL REFERENCES tipo_variable(id_tipo_variable) ON DELETE RESTRICT ON UPDATE RESTRICT,
  valor_min         double precision NOT NULL,
  valor_max         double precision NOT NULL,
  CHECK (valor_min < valor_max),
  UNIQUE (id_especie, id_tipo_variable)
);

-- ---------------------------------------------------------------- Cultivos
CREATE TABLE cultivo (
  id_cultivo      serial PRIMARY KEY,
  id_instalacion  integer NOT NULL REFERENCES instalacion(id_instalacion) ON DELETE RESTRICT ON UPDATE RESTRICT,
  id_especie      integer NOT NULL REFERENCES especie(id_especie) ON DELETE RESTRICT ON UPDATE RESTRICT,
  fecha_inicio    date NOT NULL,
  fecha_fin       date NULL,
  estado          text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','finalizado')),
  creado_por      integer NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CHECK ((estado = 'en_curso') = (fecha_fin IS NULL))
);
CREATE UNIQUE INDEX cultivo_en_curso_uq ON cultivo (id_instalacion) WHERE estado = 'en_curso';

-- ---------------------------------------------------------------- Dispositivos y sensores
CREATE TABLE dispositivo (
  id_dispositivo         serial PRIMARY KEY,
  id_instalacion         integer NOT NULL REFERENCES instalacion(id_instalacion) ON DELETE RESTRICT ON UPDATE RESTRICT,
  nombre                 text NOT NULL CHECK (length(trim(nombre)) > 0),
  credencial_hash        text NOT NULL UNIQUE,      -- SHA-256 hex del token de 256 bits (RN-06)
  estado                 text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','baja','sin_senal')),
  intervalo_muestreo_s   integer NOT NULL DEFAULT 60 CHECK (intervalo_muestreo_s BETWEEN 5 AND 3600),
  ultima_comunicacion    timestamptz NULL,
  ultima_lectura_ts      timestamptz NULL,
  pendientes_reportados  integer NULL,
  pendientes_reportados_en timestamptz NULL,
  motivo_baja            text NULL,
  creado_en              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispositivo_instalacion_idx ON dispositivo (id_instalacion);

CREATE TABLE sensor (
  id_sensor         serial PRIMARY KEY,
  id_dispositivo    integer NOT NULL REFERENCES dispositivo(id_dispositivo) ON DELETE RESTRICT ON UPDATE RESTRICT,
  id_tipo_variable  smallint NOT NULL REFERENCES tipo_variable(id_tipo_variable) ON DELETE RESTRICT ON UPDATE RESTRICT,
  estado            text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','baja')),
  creado_en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sensor_dispositivo_idx ON sensor (id_dispositivo);

-- ---------------------------------------------------------------- Ingesta
-- Registro de lotes aceptados: idempotencia en la fuente de verdad (PostgreSQL)
-- y referencia para la reconciliación con MongoDB (sección 3.2).
CREATE TABLE lote_ingesta (
  id_lote          uuid PRIMARY KEY,
  id_dispositivo   integer NOT NULL REFERENCES dispositivo(id_dispositivo) ON DELETE RESTRICT,
  recibido_en      timestamptz NOT NULL DEFAULT now(),
  lecturas         integer NOT NULL CHECK (lecturas > 0),
  ts_min           timestamptz NOT NULL,
  ts_max           timestamptz NOT NULL,
  recuperado       boolean NOT NULL DEFAULT false,   -- generado durante desconexión y enviado después
  duplicados_recibidos integer NOT NULL DEFAULT 0,
  -- 'seed' identifica datos sintéticos de prueba cargados por el script de seeds (nunca del simulador ni de un equipo)
  origen           text NOT NULL DEFAULT 'dispositivo' CHECK (origen IN ('dispositivo','seed'))
);
CREATE INDEX lote_ingesta_disp_idx ON lote_ingesta (id_dispositivo, recibido_en DESC);

CREATE TABLE medicion (
  id_medicion  bigserial NOT NULL,
  ts           timestamptz NOT NULL,
  id_sensor    integer NOT NULL REFERENCES sensor(id_sensor) ON DELETE RESTRICT ON UPDATE RESTRICT,
  valor        double precision NOT NULL,
  id_lote      uuid NOT NULL,
  PRIMARY KEY (id_medicion, ts),
  CONSTRAINT medicion_sensor_ts_uq UNIQUE (id_sensor, ts)
);
CREATE INDEX medicion_sensor_ts_idx ON medicion (id_sensor, ts DESC) INCLUDE (valor);
CREATE INDEX medicion_ts_brin ON medicion USING brin (ts);

-- ---------------------------------------------------------------- Umbrales y alertas
CREATE TABLE umbral (
  id_umbral   serial PRIMARY KEY,
  id_sensor   integer NOT NULL REFERENCES sensor(id_sensor) ON DELETE RESTRICT ON UPDATE RESTRICT,
  valor_min   double precision NOT NULL,
  valor_max   double precision NOT NULL,
  severidad   text NOT NULL CHECK (severidad IN ('advertencia','critica')),
  activo      boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 1,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (valor_min < valor_max)
);
-- Un solo umbral ACTIVO por (sensor, severidad). Se usa índice parcial para
-- permitir conservar umbrales desactivados históricos (decisión documentada).
CREATE UNIQUE INDEX umbral_activo_uq ON umbral (id_sensor, severidad) WHERE activo;

CREATE TABLE alerta (
  id_alerta         bigserial PRIMARY KEY,
  id_sensor         integer NOT NULL REFERENCES sensor(id_sensor) ON DELETE RESTRICT ON UPDATE RESTRICT,
  id_umbral         integer NOT NULL REFERENCES umbral(id_umbral) ON DELETE RESTRICT ON UPDATE RESTRICT,
  id_medicion       bigint NOT NULL,
  ts_medicion       timestamptz NOT NULL,
  valor             double precision NOT NULL,
  valor_min         double precision NOT NULL,
  valor_max         double precision NOT NULL,
  severidad         text NOT NULL CHECK (severidad IN ('advertencia','critica')),
  ultimo_valor      double precision NOT NULL,
  ts_ultima         timestamptz NOT NULL,
  ocurrencias       integer NOT NULL DEFAULT 1 CHECK (ocurrencias >= 1),
  estado            text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','resuelta')),
  fecha_generacion  timestamptz NOT NULL DEFAULT now(),
  fecha_resolucion  timestamptz NULL,
  resuelta_por      integer NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  comentario        text NULL,
  notificacion_estado text NOT NULL DEFAULT 'no_aplica'
    CHECK (notificacion_estado IN ('no_aplica','pendiente','enviada','fallida','no_configurada')),
  notificacion_intentos integer NOT NULL DEFAULT 0,
  CONSTRAINT alerta_medicion_fk FOREIGN KEY (id_medicion, ts_medicion) REFERENCES medicion(id_medicion, ts) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT alerta_medicion_uq UNIQUE (id_medicion, ts_medicion),
  CHECK ((estado = 'activa' AND resuelta_por IS NULL AND fecha_resolucion IS NULL)
      OR (estado = 'resuelta' AND resuelta_por IS NOT NULL AND fecha_resolucion IS NOT NULL))
);
CREATE UNIQUE INDEX alerta_activa_uq ON alerta (id_sensor, id_umbral) WHERE estado = 'activa';
CREATE INDEX alerta_activas_fecha_idx ON alerta (fecha_generacion DESC) WHERE estado = 'activa';
CREATE INDEX alerta_sensor_idx ON alerta (id_sensor, fecha_generacion DESC);

-- ---------------------------------------------------------------- Outbox del motor de alertas
CREATE TABLE outbox_evaluacion (
  id             bigserial PRIMARY KEY,
  id_lote        uuid NOT NULL REFERENCES lote_ingesta(id_lote) ON DELETE RESTRICT,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  procesado_en   timestamptz NULL,
  intentos       integer NOT NULL DEFAULT 0,
  ultimo_error   text NULL,
  cuarentena     boolean NOT NULL DEFAULT false
);
CREATE INDEX outbox_pendiente_idx ON outbox_evaluacion (creado_en) WHERE procesado_en IS NULL AND NOT cuarentena;

-- ---------------------------------------------------------------- Eventos operativos
CREATE TABLE evento (
  id_evento         bigserial PRIMARY KEY,
  id_dispositivo    integer NOT NULL REFERENCES dispositivo(id_dispositivo) ON DELETE RESTRICT ON UPDATE RESTRICT,
  tipo              text NOT NULL CHECK (tipo IN (
                      'alta','baja','credencial_regenerada','sin_senal','reconexion','intento_rechazado',
                      'reloj_desfasado','datos_descartados','reinicio','reconexion_local','sensor_ajeno',
                      'plausibilidad','cuarentena','notificacion_fallida','lote_rechazado')),
  descripcion       text NOT NULL,
  origen            text NOT NULL DEFAULT 'servidor' CHECK (origen IN ('servidor','dispositivo')),
  detalle           jsonb NULL,
  id_detalle_mongo  text NULL,
  id_evento_local   uuid NULL,
  ts                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evento_disp_ts_idx ON evento (id_dispositivo, ts DESC);
CREATE INDEX evento_ts_idx ON evento (ts DESC);
CREATE UNIQUE INDEX evento_local_uq ON evento (id_dispositivo, id_evento_local) WHERE id_evento_local IS NOT NULL;

-- ---------------------------------------------------------------- Auditoría (solo inserción, RN-07)
CREATE TABLE log_auditoria (
  id_log      bigserial PRIMARY KEY,
  id_usuario  integer NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  accion      text NOT NULL,
  entidad     text NOT NULL,
  id_entidad  text NULL,
  detalle     jsonb NULL,
  ip          text NULL,
  ts          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX log_auditoria_ts_idx ON log_auditoria (ts DESC);
CREATE INDEX log_auditoria_usuario_idx ON log_auditoria (id_usuario, ts DESC);

-- ---------------------------------------------------------------- Triggers
CREATE OR REPLACE FUNCTION fn_auditoria_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'log_auditoria es de solo inserción (RN-07)' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER trg_auditoria_inmutable BEFORE UPDATE OR DELETE ON log_auditoria
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_inmutable();
CREATE TRIGGER trg_auditoria_no_truncate BEFORE TRUNCATE ON log_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION fn_auditoria_inmutable();

CREATE OR REPLACE FUNCTION fn_medicion_sensor_activo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sensor WHERE id_sensor = NEW.id_sensor AND estado = 'activo') THEN
    RAISE EXCEPTION 'Sensor % inexistente o de baja (RN-01)', NEW.id_sensor USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_medicion_sensor_activo BEFORE INSERT ON medicion
  FOR EACH ROW EXECUTE FUNCTION fn_medicion_sensor_activo();

-- ---------------------------------------------------------------- Roles de mínimo privilegio (sección 3.4)
-- Se crean solo si no existen; las contraseñas se asignan en el despliegue.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN CREATE ROLE app_ro NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_ro') THEN CREATE ROLE backup_ro NOLOGIN; END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON log_auditoria FROM app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro, backup_ro;
