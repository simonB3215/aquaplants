-- =====================================================================
-- 013 — Catálogo de especies editable (CRUD para la demostración final)
--   · Hasta ahora las especies y sus rangos de referencia eran fijos (seed).
--   · Se agrega el estado para la baja lógica: una especie de baja no se
--     ofrece para cultivos nuevos, pero los cultivos que ya la usan la
--     conservan (histórico, RN-07). No se borra ninguna fila.
-- Compatible con el código anterior: la columna tiene DEFAULT 'activo'.
-- =====================================================================
ALTER TABLE especie
  ADD COLUMN estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja'));
