-- =====================================================================
-- Conversión de `medicion` en hipertabla TimescaleDB (ES2 §4.4 y §4.9).
-- El ejecutor de migraciones aplica este archivo SOLO si la extensión
-- `timescaledb` está disponible en el servidor (imagen timescale/timescaledb
-- del docker-compose). En PostgreSQL sin Timescale se omite y se registra:
-- el esquema y las consultas (date_bin) siguen funcionando.
-- Chunks de 7 días (Tabla 40).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS timescaledb;

DO $$
BEGIN
  PERFORM create_hypertable('medicion', 'ts', chunk_time_interval => interval '7 days', migrate_data => true, if_not_exists => true);
EXCEPTION WHEN others THEN
  -- Las FK hacia hipertablas requieren TimescaleDB >= 2.16. Si la versión instalada
  -- no lo permite se deja la tabla como tabla normal y se informa.
  RAISE WARNING 'No se pudo convertir medicion en hipertabla: %', SQLERRM;
END $$;
