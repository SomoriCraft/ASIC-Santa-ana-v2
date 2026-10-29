-- v1.0.8: auditoría encadenada e inmutable + huella por cada ajuste del conteo mensual
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS hash_previo TEXT, ADD COLUMN IF NOT EXISTS hash_registro TEXT;

CREATE OR REPLACE FUNCTION fn_hash_auditoria(p_prev TEXT, p_id BIGINT, p_uid UUID, p_accion TEXT, p_tabla TEXT, p_rid UUID, p_det JSONB, p_fh TIMESTAMPTZ)
RETURNS TEXT AS $$
  SELECT encode(sha256(convert_to(coalesce(p_prev,'') || '|' || p_id::text || '|' || coalesce(p_uid::text,'') || '|' || p_accion || '|' || coalesce(p_tabla,'') || '|' ||
         coalesce(p_rid::text,'') || '|' || coalesce(p_det::text,'') || '|' || extract(epoch FROM p_fh)::text, 'UTF8')), 'hex');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION tg_auditoria_hash() RETURNS trigger AS $$
DECLARE v_prev TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(748201);
  SELECT hash_registro INTO v_prev FROM auditoria WHERE hash_registro IS NOT NULL ORDER BY id DESC LIMIT 1;
  NEW.hash_previo := v_prev;
  NEW.hash_registro := fn_hash_auditoria(v_prev, NEW.id, NEW.usuario_id, NEW.accion, NEW.tabla, NEW.registro_id, NEW.detalle, NEW.fecha_hora);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tg_auditoria_inmutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'El registro de auditoría es de solo lectura (no se puede modificar ni borrar)'; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_auditoria_hash ON auditoria;
CREATE TRIGGER tr_auditoria_hash BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION tg_auditoria_hash();
DROP TRIGGER IF EXISTS tr_auditoria_inmutable ON auditoria;
CREATE TRIGGER tr_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria FOR EACH ROW EXECUTE FUNCTION tg_auditoria_inmutable();
DROP TRIGGER IF EXISTS tr_auditoria_truncate ON auditoria;
CREATE TRIGGER tr_auditoria_truncate BEFORE TRUNCATE ON auditoria FOR EACH STATEMENT EXECUTE FUNCTION tg_auditoria_inmutable();

CREATE OR REPLACE FUNCTION fn_verificar_auditoria() RETURNS TABLE (total BIGINT, primer_error BIGINT) AS $$
DECLARE r RECORD; prev TEXT := NULL; n BIGINT := 0; err BIGINT := NULL; iniciado BOOLEAN := FALSE;
BEGIN
  FOR r IN SELECT * FROM auditoria WHERE hash_registro IS NOT NULL ORDER BY id LOOP
    n := n + 1;
    IF iniciado AND r.hash_previo IS DISTINCT FROM prev THEN err := r.id; EXIT; END IF;
    IF fn_hash_auditoria(r.hash_previo, r.id, r.usuario_id, r.accion, r.tabla, r.registro_id, r.detalle, r.fecha_hora) <> r.hash_registro THEN err := r.id; EXIT; END IF;
    prev := r.hash_registro; iniciado := TRUE;
  END LOOP;
  RETURN QUERY SELECT n, err;
END; $$ LANGUAGE plpgsql STABLE;
GRANT EXECUTE ON FUNCTION fn_verificar_auditoria() TO app_farmacia;

CREATE OR REPLACE FUNCTION fn_cerrar_conteo(p_conteo UUID, p_usuario UUID, p_obs TEXT) RETURNS JSONB AS $$
DECLARE c conteos%ROWTYPE; i RECORD; l lotes%ROWTYPE; d INT; nuevo INT; v_ajustes INT := 0; v_pos INT := 0; v_neg INT := 0;
BEGIN
  PERFORM fn_es_regente(p_usuario);
  SELECT * INTO c FROM conteos WHERE id = p_conteo FOR UPDATE;
  IF NOT FOUND OR c.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El conteo no está abierto'; END IF;
  IF EXISTS (SELECT 1 FROM conteo_items WHERE conteo_id = p_conteo AND cantidad_fisica IS NULL) THEN
    RAISE EXCEPTION 'Faltan lotes por contar (% sin cantidad física)', (SELECT count(*) FROM conteo_items WHERE conteo_id = p_conteo AND cantidad_fisica IS NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM conteo_items WHERE conteo_id = p_conteo AND cantidad_fisica <> cantidad_sistema AND length(coalesce(motivo,'')) < 10) THEN
    RAISE EXCEPTION 'Toda diferencia requiere un motivo de al menos 10 caracteres';
  END IF;
  FOR i IN SELECT * FROM conteo_items WHERE conteo_id = p_conteo AND cantidad_fisica <> cantidad_sistema LOOP
    SELECT * INTO l FROM lotes WHERE id = i.lote_id FOR UPDATE;
    IF l.cantidad_actual <> i.cantidad_sistema THEN RAISE EXCEPTION 'El lote % cambió durante el conteo; cancele y reinicie el conteo', l.numero_lote; END IF;
    d := i.cantidad_fisica - l.cantidad_actual; nuevo := i.cantidad_fisica;
    UPDATE lotes SET cantidad_actual = nuevo, cantidad_inicial = GREATEST(cantidad_inicial, nuevo),
        estado = CASE WHEN nuevo = 0 THEN 'AGOTADO'::estado_lote
                      WHEN estado = 'AGOTADO' THEN (CASE WHEN fecha_vencimiento > CURRENT_DATE THEN 'ACTIVO' ELSE 'VENCIDO' END)::estado_lote ELSE estado END,
        actualizado_en = now(), sync_estado = 'PENDIENTE' WHERE id = l.id;
    INSERT INTO movimientos_kardex (tipo, producto_id, lote_id, cantidad, saldo_lote, saldo_producto, documento_ref, usuario_id, observacion)
    VALUES ((CASE WHEN d > 0 THEN 'AJUSTE_POSITIVO' ELSE 'AJUSTE_NEGATIVO' END)::tipo_movimiento, l.producto_id, l.id, abs(d), nuevo, fn_saldo_producto(l.producto_id),
            'CONTEO-' || c.periodo, p_usuario, 'Ajuste por conteo físico: ' || i.motivo);
    INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle)
    VALUES (p_usuario, 'AJUSTE_CONTEO', 'lotes', l.id, jsonb_build_object('periodo', c.periodo, 'lote', l.numero_lote, 'producto_id', l.producto_id,
            'antes', i.cantidad_sistema, 'despues', nuevo, 'diferencia', d, 'motivo', i.motivo));
    v_ajustes := v_ajustes + 1; IF d > 0 THEN v_pos := v_pos + 1; ELSE v_neg := v_neg + 1; END IF;
  END LOOP;
  UPDATE conteos SET estado = 'CERRADO', cerrado_por = p_usuario, cerrado_en = now(), observaciones = NULLIF(trim(coalesce(p_obs,'')), '') WHERE id = p_conteo;
  INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle)
  VALUES (p_usuario, 'CERRAR_MES', 'conteos', p_conteo, jsonb_build_object('periodo', c.periodo, 'ajustes', v_ajustes, 'sobrantes', v_pos, 'faltantes', v_neg));
  RETURN jsonb_build_object('periodo', c.periodo, 'ajustes', v_ajustes, 'sobrantes', v_pos, 'faltantes', v_neg);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
