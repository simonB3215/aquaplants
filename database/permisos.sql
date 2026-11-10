-- =====================================================================
-- Roles de mínimo privilegio (ES2 §3.4). Lo aplica el ejecutor de migraciones
-- DESPUÉS de cada ejecución (es idempotente), así cubre también las tablas
-- creadas por migraciones posteriores. Las contraseñas y el atributo LOGIN se
-- asignan desde variables de entorno (DB_APP_PASSWORD, DB_RO_PASSWORD,
-- DB_BACKUP_PASSWORD); sin ellas los roles quedan NOLOGIN.
--   app_rw    : API y worker. SELECT/INSERT/UPDATE; DELETE solo donde el
--               negocio lo requiere; nunca UPDATE/DELETE en auditoría ni evidencia.
--   app_ro    : consultas de históricos / reportes (solo lectura).
--   backup_ro : respaldos (lectura de todo) + INSERT en respaldo_registro.
-- Ninguna aplicación usa el superusuario.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN CREATE ROLE app_ro NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_ro') THEN CREATE ROLE backup_ro NOLOGIN; END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_rw, app_ro, backup_ro;

-- app_rw
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_rw;
GRANT DELETE ON usuario_instalacion TO app_rw;              -- reasignación de torres (CU-08/CU-09)
GRANT DELETE ON registro_pendiente TO app_rw;               -- purga de solicitudes no confirmadas (D-28)
GRANT DELETE ON sesion TO app_rw;                           -- purga de sesiones vencidas (D-31)
GRANT DELETE ON medicion TO app_rw;                         -- retención sin TimescaleDB (D-35)
REVOKE UPDATE, DELETE, TRUNCATE ON log_auditoria FROM app_rw; -- RN-07
REVOKE UPDATE, DELETE, TRUNCATE ON medicion_evidencia FROM app_rw;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migraciones FROM app_rw;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON respaldo_registro FROM app_rw;
GRANT UPDATE (notificado_en) ON respaldo_registro TO app_rw;  -- el worker marca el aviso

-- app_ro
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;

-- backup_ro: pg_read_all_data (PostgreSQL ≥ 14) lee también los esquemas internos de TimescaleDB.
GRANT pg_read_all_data TO backup_ro;
GRANT INSERT ON respaldo_registro TO backup_ro;
GRANT USAGE ON SEQUENCE respaldo_registro_id_respaldo_seq TO backup_ro;
