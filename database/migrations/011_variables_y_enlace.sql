-- =====================================================================
-- 011 — Variables de cultivo mencionadas por la empresa y calidad del enlace (D-35)
-- =====================================================================
-- El documento del desafío nombra «nutrientes, caudal, consumo hídrico y fotoperiodo».
-- Los nutrientes ya se miden como conductividad eléctrica (ce). Se agregan:
--   caudal           caudal de la bomba de riego (L/min)
--   consumo_hidrico  agua consumida por la torre en las últimas 24 h (L/día)
--   fotoperiodo      horas de luz programadas/medidas por día (h/día)
-- Los rangos son referencias iniciales para el prototipo: deben validarse con la
-- contraparte (sección 7 del documento del desafío).
-- Solo en bases que ya tienen catálogo (instalaciones existentes). En una base nueva
-- el seed carga todas las variables en orden.
INSERT INTO tipo_variable (nombre, clave, unidad_medida, min_fisico, max_fisico, max_delta_minuto)
SELECT v.* FROM (VALUES
  ('Caudal de riego', 'caudal', 'L/min', 0::float8, 30::float8, 10::float8),
  ('Consumo hídrico', 'consumo_hidrico', 'L/día', 0, 500, 100),
  ('Fotoperiodo', 'fotoperiodo', 'h/día', 0, 24, 24)
) AS v(nombre, clave, unidad, vmin, vmax, delta)
WHERE EXISTS (SELECT 1 FROM tipo_variable)
ON CONFLICT (clave) DO NOTHING;

-- Rangos de referencia para las especies de la demostración (si existen).
INSERT INTO rango_referencia (id_especie, id_tipo_variable, valor_min, valor_max)
SELECT e.id_especie, tv.id_tipo_variable, r.vmin, r.vmax
  FROM (VALUES
    ('lechuga',  'caudal', 2, 6), ('lechuga',  'consumo_hidrico', 15, 40), ('lechuga',  'fotoperiodo', 12, 16),
    ('albahaca', 'caudal', 2, 6), ('albahaca', 'consumo_hidrico', 15, 45), ('albahaca', 'fotoperiodo', 14, 16),
    ('frutilla', 'caudal', 2, 6), ('frutilla', 'consumo_hidrico', 20, 50), ('frutilla', 'fotoperiodo', 12, 16)
  ) AS r(especie, clave, vmin, vmax)
  JOIN especie e ON lower(e.nombre) = r.especie
  JOIN tipo_variable tv ON tv.clave = r.clave
ON CONFLICT (id_especie, id_tipo_variable) DO NOTHING;

-- Calidad del enlace: intensidad de señal (RSSI, dBm) que el AquaBrain informa en
-- cada lote (meta.rssi_dbm). Se guarda solo el último valor y cuándo se recibió.
ALTER TABLE dispositivo
  ADD COLUMN rssi_dbm smallint NULL CHECK (rssi_dbm BETWEEN -130 AND 0),
  ADD COLUMN rssi_en  timestamptz NULL;
