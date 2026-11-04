-- =====================================================================
-- Evidencia de las mediciones que originaron alertas (ES2 Tabla 40).
-- Las mediciones crudas se eliminan por chunks después de 2 años, pero las
-- que originaron una alerta deben conservarse. En lugar de copiarlas justo
-- antes de borrar el chunk (un proceso que, si falla, deja la alerta sin su
-- evidencia), se copian al GENERAR la alerta, en la misma transacción.
-- La FK de alerta pasa a apuntar a la evidencia: así la retención puede
-- borrar chunks de `medicion` sin violar integridad (D-24).
-- =====================================================================
CREATE TABLE medicion_evidencia (
  id_medicion  bigint NOT NULL,
  ts           timestamptz NOT NULL,
  id_sensor    integer NOT NULL REFERENCES sensor(id_sensor) ON DELETE RESTRICT ON UPDATE RESTRICT,
  valor        double precision NOT NULL,
  id_lote      uuid NOT NULL,
  copiada_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_medicion, ts)
);
CREATE INDEX medicion_evidencia_sensor_ts_idx ON medicion_evidencia (id_sensor, ts DESC);

-- La evidencia es inmutable (como la auditoría).
CREATE OR REPLACE FUNCTION fn_evidencia_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'medicion_evidencia es de solo inserción (Tabla 40)' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER trg_evidencia_inmutable BEFORE UPDATE OR DELETE ON medicion_evidencia
  FOR EACH ROW EXECUTE FUNCTION fn_evidencia_inmutable();
CREATE TRIGGER trg_evidencia_no_truncate BEFORE TRUNCATE ON medicion_evidencia
  FOR EACH STATEMENT EXECUTE FUNCTION fn_evidencia_inmutable();

-- Copia la medición al insertar la alerta. Si la medición no existe no se copia
-- nada y la FK hacia la evidencia rechaza la alerta (23503), igual que antes.
CREATE OR REPLACE FUNCTION fn_alerta_evidencia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO medicion_evidencia (id_medicion, ts, id_sensor, valor, id_lote)
  SELECT m.id_medicion, m.ts, m.id_sensor, m.valor, m.id_lote
    FROM medicion m
   WHERE m.id_medicion = NEW.id_medicion AND m.ts = NEW.ts_medicion
  ON CONFLICT (id_medicion, ts) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_alerta_evidencia BEFORE INSERT OR UPDATE OF id_medicion, ts_medicion ON alerta
  FOR EACH ROW EXECUTE FUNCTION fn_alerta_evidencia();

-- Alertas existentes: copiar su medición.
INSERT INTO medicion_evidencia (id_medicion, ts, id_sensor, valor, id_lote)
SELECT m.id_medicion, m.ts, m.id_sensor, m.valor, m.id_lote
  FROM alerta a JOIN medicion m ON m.id_medicion = a.id_medicion AND m.ts = a.ts_medicion
ON CONFLICT (id_medicion, ts) DO NOTHING;

ALTER TABLE alerta DROP CONSTRAINT alerta_medicion_fk;
ALTER TABLE alerta ADD CONSTRAINT alerta_evidencia_fk FOREIGN KEY (id_medicion, ts_medicion)
  REFERENCES medicion_evidencia(id_medicion, ts) ON DELETE RESTRICT ON UPDATE RESTRICT;
