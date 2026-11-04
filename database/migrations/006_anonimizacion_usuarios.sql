-- =====================================================================
-- Anonimización de usuarios desactivados (ES2 Tabla 40, Ley N.° 19.628).
-- Un año después de la desactivación se reemplazan nombre y email; se conserva
-- el identificador para que la auditoría siga siendo trazable. Lo ejecuta el
-- worker una vez al día: SELECT fn_anonimizar_usuarios(interval '1 year').
-- =====================================================================
ALTER TABLE usuario ADD COLUMN anonimizado_en timestamptz NULL;
ALTER TABLE usuario ADD CONSTRAINT usuario_anonimizado_inactivo_ck CHECK (anonimizado_en IS NULL OR NOT activo);

CREATE OR REPLACE FUNCTION fn_anonimizar_usuarios(p_plazo interval) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_id integer;
  v_n  integer := 0;
BEGIN
  FOR v_id IN
    SELECT id_usuario FROM usuario
     WHERE NOT activo AND anonimizado_en IS NULL
       AND desactivado_en IS NOT NULL AND desactivado_en <= now() - p_plazo
     ORDER BY id_usuario
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE usuario
       SET nombre = 'Usuario anonimizado #' || v_id,
           email = 'anonimizado-' || v_id || '@anonimizado.invalid',
           hash_password = '!anonimizado',          -- no es un hash bcrypt: ningún login coincide
           version_token = version_token + 1,
           anonimizado_en = now()
     WHERE id_usuario = v_id;
    -- Datos personales en tablas operativas del propio usuario.
    UPDATE notificacion_correo
       SET destinatario = 'anonimizado', texto = '',
           estado = CASE WHEN estado = 'pendiente' THEN 'fallida' ELSE estado END,
           ultimo_error = CASE WHEN estado = 'pendiente' THEN 'usuario anonimizado' ELSE ultimo_error END
     WHERE id_usuario = v_id;
    UPDATE token_restablecimiento SET ip_solicitud = NULL WHERE id_usuario = v_id;
    DELETE FROM usuario_instalacion WHERE id_usuario = v_id;
    INSERT INTO log_auditoria (id_usuario, accion, entidad, id_entidad, detalle)
    VALUES (NULL, 'anonimizar_usuario', 'usuario', v_id::text, jsonb_build_object('plazo', p_plazo::text));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
