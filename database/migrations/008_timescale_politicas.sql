-- =====================================================================
-- Políticas TimescaleDB de la Tabla 40 (ES2 §4.9). Se aplica SOLO si la
-- extensión timescaledb está disponible (igual que 002_timescale.sql).
--  · Compresión de chunks con más de 7 días (segmentados por sensor).
--  · Retención de mediciones crudas: 2 años. Las mediciones que originaron
--    alertas ya están copiadas en medicion_evidencia (migración 005).
--  · Agregado continuo horario (promedio, mínimo, máximo) con retención de 5 años.
-- Los trabajos los ejecuta el planificador de TimescaleDB, por chunks completos.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'medicion') THEN
    RAISE WARNING 'medicion no es hipertabla: no se activan las políticas de la Tabla 40';
    RETURN;
  END IF;

  ALTER TABLE medicion SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'id_sensor',
    timescaledb.compress_orderby = 'ts DESC, id_medicion'
  );
  PERFORM add_compression_policy('medicion', compress_after => interval '7 days', if_not_exists => true);
  PERFORM add_retention_policy('medicion', drop_after => interval '2 years', if_not_exists => true);

  -- WITH NO DATA permite crear el agregado dentro de la transacción de la migración;
  -- la política lo materializa (los 3 últimos días se recalculan para absorber lotes
  -- atrasados: el buffer del dispositivo cubre ~40 h).
  CREATE MATERIALIZED VIEW medicion_hora
    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
    SELECT id_sensor,
           time_bucket(interval '1 hour', ts) AS hora,
           avg(valor) AS promedio,
           min(valor) AS minimo,
           max(valor) AS maximo,
           count(*)   AS n
      FROM medicion
     GROUP BY id_sensor, time_bucket(interval '1 hour', ts)
    WITH NO DATA;
  PERFORM add_continuous_aggregate_policy('medicion_hora',
    start_offset => interval '3 days', end_offset => interval '1 hour', schedule_interval => interval '1 hour',
    if_not_exists => true);
  PERFORM add_retention_policy('medicion_hora', drop_after => interval '5 years', if_not_exists => true);
END $$;
