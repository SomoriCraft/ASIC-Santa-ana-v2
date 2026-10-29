-- v1.0.4: recuperación de clave, anulación de despachos, conteo físico y cierre mensual
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email VARCHAR(150),
  ADD COLUMN IF NOT EXISTS intentos_fallidos INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recuperacion_configurada BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS seguridad_respuestas (
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pregunta_id SMALLINT NOT NULL CHECK (pregunta_id BETWEEN 1 AND 5),
  respuesta_hash TEXT NOT NULL,
  PRIMARY KEY (usuario_id, pregunta_id));
CREATE TABLE IF NOT EXISTS recuperacion_codigos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL, expira TIMESTAMPTZ NOT NULL,
  intentos INT NOT NULL DEFAULT 0, usado BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS config_sistema (
  clave VARCHAR(60) PRIMARY KEY, valor TEXT NOT NULL, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON seguridad_respuestas TO app_farmacia;
GRANT SELECT, INSERT, UPDATE ON recuperacion_codigos, config_sistema TO app_farmacia;

-- ---------------- Anulación de despachos ----------------
CREATE TABLE IF NOT EXISTS anulaciones_despacho (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acta_id UUID NOT NULL UNIQUE REFERENCES actas_despacho(id),
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) >= 15),
  anulado_por UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT ON anulaciones_despacho TO app_farmacia;

-- ---------------- Conteo físico / cierre mensual ----------------
CREATE TABLE IF NOT EXISTS conteos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo CHAR(7) NOT NULL UNIQUE CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  estado VARCHAR(10) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','CERRADO')),
  iniciado_por UUID NOT NULL REFERENCES usuarios(id), iniciado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_por UUID REFERENCES usuarios(id), cerrado_en TIMESTAMPTZ, observaciones TEXT);
CREATE TABLE IF NOT EXISTS conteo_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conteo_id UUID NOT NULL REFERENCES conteos(id) ON DELETE CASCADE,
  lote_id UUID NOT NULL REFERENCES lotes(id),
  cantidad_sistema INT NOT NULL, cantidad_fisica INT CHECK (cantidad_fisica >= 0), motivo TEXT,
  UNIQUE (conteo_id, lote_id));
GRANT SELECT ON conteos, conteo_items TO app_farmacia;

CREATE OR REPLACE FUNCTION fn_es_regente(p_usuario UUID) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_usuario AND activo AND rol = 'FARMACEUTICO_REGENTE') THEN
    RAISE EXCEPTION 'Solo el Farmacéutico Regente puede realizar esta operación';
  END IF;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_anular_despacho(p_acta UUID, p_motivo TEXT, p_usuario UUID) RETURNS INT AS $$
DECLARE a actas_despacho%ROWTYPE; m RECORD; v_saldo INT; n INT := 0;
BEGIN
  PERFORM fn_es_regente(p_usuario);
  IF length(trim(coalesce(p_motivo,''))) < 15 THEN RAISE EXCEPTION 'El motivo de la anulación debe tener al menos 15 caracteres'; END IF;
  SELECT * INTO a FROM actas_despacho WHERE id = p_acta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acta no encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM anulaciones_despacho WHERE acta_id = p_acta) THEN RAISE EXCEPTION 'Este despacho ya fue anulado'; END IF;
  IF EXISTS (SELECT 1 FROM conteos WHERE estado = 'CERRADO' AND periodo = to_char(a.fecha_hora, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'No se puede anular: el mes del despacho ya fue cerrado con conteo físico';
  END IF;
  FOR m IN SELECT * FROM movimientos_kardex WHERE acta_id = p_acta AND tipo = 'SALIDA' ORDER BY fecha_hora LOOP
    IF (SELECT estado FROM lotes WHERE id = m.lote_id) = 'DESINCORPORADO' THEN
      RAISE EXCEPTION 'Un lote de este despacho fue desincorporado; no se puede reintegrar';
    END IF;
    UPDATE lotes SET cantidad_actual = cantidad_actual + m.cantidad,
        estado = CASE WHEN estado = 'AGOTADO' THEN (CASE WHEN fecha_vencimiento > CURRENT_DATE THEN 'ACTIVO' ELSE 'VENCIDO' END)::estado_lote ELSE estado END,
        actualizado_en = now(), sync_estado = 'PENDIENTE'
      WHERE id = m.lote_id RETURNING cantidad_actual INTO v_saldo;
    INSERT INTO movimientos_kardex (tipo, producto_id, lote_id, cantidad, saldo_lote, saldo_producto, acta_id, servicio_id, documento_ref, usuario_id, observacion)
    VALUES ('AJUSTE_POSITIVO', m.producto_id, m.lote_id, m.cantidad, v_saldo, fn_saldo_producto(m.producto_id), p_acta, m.servicio_id,
            'ANUL-' || a.nro_acta, p_usuario, 'Anulación de despacho: ' || trim(p_motivo));
    n := n + 1;
  END LOOP;
  INSERT INTO anulaciones_despacho (acta_id, motivo, anulado_por) VALUES (p_acta, trim(p_motivo), p_usuario);
  INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle)
  VALUES (p_usuario, 'ANULAR_DESPACHO', 'actas_despacho', p_acta, jsonb_build_object('nro_acta', a.nro_acta, 'motivo', trim(p_motivo), 'movimientos', n));
  RETURN n;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION fn_iniciar_conteo(p_periodo TEXT, p_usuario UUID) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  PERFORM fn_es_regente(p_usuario);
  IF p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' OR p_periodo > to_char(CURRENT_DATE, 'YYYY-MM') THEN RAISE EXCEPTION 'Período inválido'; END IF;
  IF EXISTS (SELECT 1 FROM conteos WHERE estado = 'ABIERTO') THEN RAISE EXCEPTION 'Ya hay un conteo abierto; termínelo o cancélelo'; END IF;
  IF EXISTS (SELECT 1 FROM conteos WHERE periodo = p_periodo) THEN RAISE EXCEPTION 'El período % ya fue contado y cerrado', p_periodo; END IF;
  INSERT INTO conteos (periodo, iniciado_por) VALUES (p_periodo, p_usuario) RETURNING id INTO v;
  INSERT INTO conteo_items (conteo_id, lote_id, cantidad_sistema) SELECT v, id, cantidad_actual FROM lotes WHERE cantidad_actual > 0;
  INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle) VALUES (p_usuario, 'INICIAR_CONTEO', 'conteos', v, jsonb_build_object('periodo', p_periodo));
  RETURN v;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION fn_guardar_conteo(p_conteo UUID, p_items JSONB, p_usuario UUID) RETURNS INT AS $$
DECLARE it JSONB; n INT := 0;
BEGIN
  PERFORM fn_validar_operador(p_usuario);
  IF NOT EXISTS (SELECT 1 FROM conteos WHERE id = p_conteo AND estado = 'ABIERTO') THEN RAISE EXCEPTION 'El conteo no está abierto'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    UPDATE conteo_items SET cantidad_fisica = NULLIF(it->>'cantidad_fisica', '')::INT, motivo = NULLIF(trim(coalesce(it->>'motivo','')), '')
      WHERE conteo_id = p_conteo AND lote_id = (it->>'lote_id')::UUID;
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

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
    v_ajustes := v_ajustes + 1; IF d > 0 THEN v_pos := v_pos + 1; ELSE v_neg := v_neg + 1; END IF;
  END LOOP;
  UPDATE conteos SET estado = 'CERRADO', cerrado_por = p_usuario, cerrado_en = now(), observaciones = NULLIF(trim(coalesce(p_obs,'')), '') WHERE id = p_conteo;
  INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle)
  VALUES (p_usuario, 'CERRAR_MES', 'conteos', p_conteo, jsonb_build_object('periodo', c.periodo, 'ajustes', v_ajustes, 'sobrantes', v_pos, 'faltantes', v_neg));
  RETURN jsonb_build_object('periodo', c.periodo, 'ajustes', v_ajustes, 'sobrantes', v_pos, 'faltantes', v_neg);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION fn_cancelar_conteo(p_conteo UUID, p_usuario UUID) RETURNS void AS $$
BEGIN
  PERFORM fn_es_regente(p_usuario);
  DELETE FROM conteos WHERE id = p_conteo AND estado = 'ABIERTO';
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay un conteo abierto con ese identificador'; END IF;
  INSERT INTO auditoria (usuario_id, accion, tabla, registro_id) VALUES (p_usuario, 'CANCELAR_CONTEO', 'conteos', p_conteo);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION fn_es_regente(uuid), fn_anular_despacho(uuid,text,uuid), fn_iniciar_conteo(text,uuid), fn_guardar_conteo(uuid,jsonb,uuid),
  fn_cerrar_conteo(uuid,uuid,text), fn_cancelar_conteo(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_anular_despacho(uuid,text,uuid), fn_iniciar_conteo(text,uuid), fn_guardar_conteo(uuid,jsonb,uuid),
  fn_cerrar_conteo(uuid,uuid,text), fn_cancelar_conteo(uuid,uuid) TO app_farmacia;

-- El consolidado ASIC no debe contar despachos anulados
CREATE OR REPLACE FUNCTION fn_consolidado_asic(p_desde DATE, p_hasta DATE)
RETURNS TABLE (destino VARCHAR, tipo_destino tipo_servicio, dci VARCHAR, presentacion VARCHAR, concentracion VARCHAR, total_despachado INT) AS $$
  SELECT s.nombre, s.tipo, p.dci_principio_activo, p.presentacion, p.concentracion, SUM(k.cantidad)::int
  FROM movimientos_kardex k
  JOIN servicios_cdi_asic s ON s.id = k.servicio_id
  JOIN productos p ON p.id = k.producto_id
  WHERE k.tipo = 'SALIDA' AND k.fecha_hora >= p_desde AND k.fecha_hora < p_hasta + 1
    AND NOT EXISTS (SELECT 1 FROM anulaciones_despacho an WHERE an.acta_id = k.acta_id)
  GROUP BY s.nombre, s.tipo, p.dci_principio_activo, p.presentacion, p.concentracion
  ORDER BY s.nombre, p.dci_principio_activo;
$$ LANGUAGE sql STABLE;
