-- =====================================================================
-- CDI Santa Ana - Lógica transaccional (requiere cdi_santa_ana_schema.sql)
-- Cada función es atómica: si algo falla, se revierte TODO (acta, lotes, kardex, libro).
-- =====================================================================

CREATE SEQUENCE IF NOT EXISTS seq_acta_despacho START 1;

-- Saldo total vigente de un producto (lotes activos)
CREATE OR REPLACE FUNCTION fn_saldo_producto(p_producto UUID) RETURNS INTEGER AS $$
  SELECT COALESCE(SUM(cantidad_actual), 0)::INT
  FROM lotes WHERE producto_id = p_producto AND estado = 'ACTIVO';
$$ LANGUAGE sql STABLE;

-- Validación de rol: solo Regente o Almacenista pueden mover inventario
CREATE OR REPLACE FUNCTION fn_validar_operador(p_usuario UUID) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios
                 WHERE id = p_usuario AND activo
                   AND rol IN ('FARMACEUTICO_REGENTE','ALMACENISTA')) THEN
    RAISE EXCEPTION 'Usuario sin permiso para operar inventario';
  END IF;
END; $$ LANGUAGE plpgsql;

-- =====================================================================
-- ENTRADA / RECEPCIÓN
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_registrar_entrada(
  p_producto UUID, p_numero_lote VARCHAR, p_vencimiento DATE, p_cantidad INT,
  p_proveedor UUID, p_documento VARCHAR, p_usuario UUID
) RETURNS UUID AS $$
DECLARE
  v_lote UUID;
  v_saldo_lote INT;
BEGIN
  PERFORM fn_validar_operador(p_usuario);

  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad debe ser mayor a cero'; END IF;
  IF p_vencimiento <= CURRENT_DATE THEN
    RAISE EXCEPTION 'No se puede recibir un lote vencido (%).', p_vencimiento;
  END IF;

  -- Si el lote ya existe (misma entrega parcial), se suma; si no, se crea
  INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, cantidad_inicial,
                     cantidad_actual, proveedor_id, nro_factura_guia, recibido_por)
  VALUES (p_producto, p_numero_lote, p_vencimiento, p_cantidad,
          p_cantidad, p_proveedor, p_documento, p_usuario)
  ON CONFLICT (producto_id, numero_lote, fecha_vencimiento) DO UPDATE
    SET cantidad_inicial = lotes.cantidad_inicial + EXCLUDED.cantidad_inicial,
        cantidad_actual  = lotes.cantidad_actual  + EXCLUDED.cantidad_actual,
        estado = 'ACTIVO',
        actualizado_en = now(), sync_estado = 'PENDIENTE'
  RETURNING id, cantidad_actual INTO v_lote, v_saldo_lote;

  INSERT INTO movimientos_kardex (tipo, producto_id, lote_id, cantidad, saldo_lote,
                                  saldo_producto, proveedor_id, documento_ref, usuario_id)
  VALUES ('ENTRADA', p_producto, v_lote, p_cantidad, v_saldo_lote,
          fn_saldo_producto(p_producto), p_proveedor, p_documento, p_usuario);

  RETURN v_lote;
END; $$ LANGUAGE plpgsql;

-- =====================================================================
-- DESPACHO (acta + FEFO + kardex + libro folia si es controlado)
--
-- p_items = JSON array, ejemplo:
-- [
--  {"producto_id":"<uuid>","cantidad":20},
--  {"producto_id":"<uuid controlado>","cantidad":2,
--   "paciente_cedula":"V12345678","paciente_nombre":"Juan Pérez",
--   "medico_nombre":"Dra. Ana Ruiz","medico_matricula_mpps":"MPPS-12345",
--   "colegio_medicos_nro":"CM-678","nro_recipe":"R-000123"}
-- ]
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_despachar(
  p_servicio UUID, p_recibe_cedula VARCHAR, p_recibe_nombre VARCHAR,
  p_recibe_cargo VARCHAR, p_usuario UUID, p_items JSONB,
  p_observaciones TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_acta UUID;
  v_nro  VARCHAR;
  it     JSONB;
  v_prod productos%ROWTYPE;
  v_cant INT;
  a      RECORD;
  v_saldo_lote INT;
  v_mov  UUID;
  v_prev_hash TEXT;
BEGIN
  PERFORM fn_validar_operador(p_usuario);

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El despacho debe incluir al menos un ítem';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM servicios_cdi_asic WHERE id = p_servicio AND activo) THEN
    RAISE EXCEPTION 'Servicio/destino inválido o inactivo';
  END IF;

  v_nro := 'ACT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_acta_despacho')::text, 6, '0');

  INSERT INTO actas_despacho (nro_acta, servicio_id, recibe_cedula, recibe_nombre,
                              recibe_cargo, entrega_usuario, observaciones)
  VALUES (v_nro, p_servicio, p_recibe_cedula, p_recibe_nombre,
          p_recibe_cargo, p_usuario, p_observaciones)
  RETURNING id INTO v_acta;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cant := (it->>'cantidad')::INT;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida en ítem %', it;
    END IF;

    SELECT * INTO v_prod FROM productos
    WHERE id = (it->>'producto_id')::UUID AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente o inactivo: %', it->>'producto_id'; END IF;

    -- Controlados: datos del récipe obligatorios
    IF v_prod.tipo_control IN ('CONTROLADO_PSICOTROPICO','ESTUPEFACIENTE') THEN
      IF COALESCE(it->>'paciente_cedula','') = ''
         OR COALESCE(it->>'paciente_nombre','') = ''
         OR COALESCE(it->>'medico_nombre','') = ''
         OR COALESCE(it->>'medico_matricula_mpps','') = ''
         OR COALESCE(it->>'nro_recipe','') = '' THEN
        RAISE EXCEPTION 'Controlado "%": falta cédula paciente, médico, matrícula MPPS o nro. de récipe',
                        v_prod.dci_principio_activo;
      END IF;
      -- Serializa el libro para mantener la cadena de hashes consistente
      PERFORM pg_advisory_xact_lock(hashtext('libro_folia'));
    END IF;

    -- Asignación FEFO (puede repartir entre varios lotes; falla si no hay stock)
    FOR a IN SELECT * FROM fn_asignar_fefo(v_prod.id, v_cant) LOOP
      UPDATE lotes
         SET cantidad_actual = cantidad_actual - a.tomar,
             estado = CASE WHEN cantidad_actual - a.tomar = 0 THEN 'AGOTADO'::estado_lote ELSE estado END,
             actualizado_en = now(), sync_estado = 'PENDIENTE'
       WHERE id = a.lote_id
       RETURNING cantidad_actual INTO v_saldo_lote;

      INSERT INTO movimientos_kardex (tipo, producto_id, lote_id, cantidad, saldo_lote,
                                      saldo_producto, acta_id, servicio_id, documento_ref, usuario_id)
      VALUES ('SALIDA', v_prod.id, a.lote_id, a.tomar, v_saldo_lote,
              fn_saldo_producto(v_prod.id), v_acta, p_servicio, v_nro, p_usuario)
      RETURNING id INTO v_mov;

      IF v_prod.tipo_control IN ('CONTROLADO_PSICOTROPICO','ESTUPEFACIENTE') THEN
        SELECT hash_registro INTO v_prev_hash
        FROM dispensacion_controlados ORDER BY folio DESC LIMIT 1;

        INSERT INTO dispensacion_controlados
          (movimiento_id, paciente_cedula, paciente_nombre, medico_nombre,
           medico_matricula_mpps, colegio_medicos_nro, nro_recipe, farmaceutico_id, hash_registro)
        VALUES (v_mov, it->>'paciente_cedula', it->>'paciente_nombre', it->>'medico_nombre',
                it->>'medico_matricula_mpps', it->>'colegio_medicos_nro', it->>'nro_recipe', p_usuario,
                encode(digest(
                  COALESCE(v_prev_hash,'GENESIS') || v_mov::text || a.tomar::text ||
                  (it->>'paciente_cedula') || (it->>'nro_recipe') || now()::text,
                  'sha256'), 'hex'));
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle)
  VALUES (p_usuario, 'DESPACHO', 'actas_despacho', v_acta,
          jsonb_build_object('nro_acta', v_nro, 'servicio', p_servicio, 'items', p_items));

  RETURN v_acta;
END; $$ LANGUAGE plpgsql;

-- Firma del Regente sobre un registro del Libro Folia
CREATE OR REPLACE FUNCTION fn_firmar_libro(p_folio BIGINT, p_regente UUID) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_regente AND activo AND rol = 'FARMACEUTICO_REGENTE') THEN
    RAISE EXCEPTION 'Solo el Farmacéutico Regente puede firmar el libro';
  END IF;
  UPDATE dispensacion_controlados
     SET firma_regente = p_regente, fecha_firma = now(), sync_estado = 'PENDIENTE'
   WHERE folio = p_folio AND firma_regente IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio inexistente o ya firmado'; END IF;
END; $$ LANGUAGE plpgsql;

-- Ejemplo de uso:
-- SELECT fn_despachar('<servicio_uuid>','V12345678','María Gómez','Enfermera Jefe',
--        '<usuario_uuid>', '[{"producto_id":"<uuid>","cantidad":20}]'::jsonb);
