-- =====================================================================
-- 03: Mermas, Libro Folia verificable, reportes y permisos
-- Ejecutar después de 01 y 02.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. LIBRO FOLIA: folio sin saltos + hash encadenado verificable
--    (reemplaza el folio IDENTITY, que puede saltar números tras un rollback,
--     y el hash calculado en fn_despachar, que no se podía recalcular)
-- ---------------------------------------------------------------------
ALTER TABLE dispensacion_controlados ALTER COLUMN folio DROP IDENTITY IF EXISTS;

CREATE OR REPLACE FUNCTION fn_calc_hash_folio(
  p_prev TEXT, p_folio BIGINT, p_mov UUID, p_cant INT,
  p_cedula TEXT, p_recipe TEXT, p_ts TIMESTAMPTZ
) RETURNS TEXT AS $$
  SELECT encode(digest(
    COALESCE(p_prev,'GENESIS') || '|' || p_folio || '|' || p_mov || '|' || p_cant || '|' ||
    p_cedula || '|' || p_recipe || '|' ||
    to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'sha256'), 'hex');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_libro_folio_hash() RETURNS trigger AS $$
DECLARE v_prev_folio BIGINT; v_prev TEXT; v_ts TIMESTAMPTZ; v_cant INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('libro_folia'));   -- serializa el libro
  SELECT d.folio, d.hash_registro INTO v_prev_folio, v_prev
    FROM dispensacion_controlados d ORDER BY d.folio DESC LIMIT 1;
  NEW.folio := COALESCE(v_prev_folio, 0) + 1;
  SELECT k.fecha_hora, k.cantidad INTO v_ts, v_cant FROM movimientos_kardex k WHERE k.id = NEW.movimiento_id;
  NEW.hash_registro := fn_calc_hash_folio(v_prev, NEW.folio, NEW.movimiento_id, v_cant,
                                          NEW.paciente_cedula, NEW.nro_recipe, v_ts);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_libro_folio_hash ON dispensacion_controlados;
CREATE TRIGGER trg_libro_folio_hash BEFORE INSERT ON dispensacion_controlados
  FOR EACH ROW EXECUTE FUNCTION fn_libro_folio_hash();

-- El libro solo admite la firma del Regente; nada más se modifica ni se borra
CREATE OR REPLACE FUNCTION fn_libro_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'firma_regente' - 'fecha_firma' - 'sync_estado')
       = (to_jsonb(OLD) - 'firma_regente' - 'fecha_firma' - 'sync_estado') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'El Libro Folia no admite modificaciones ni eliminaciones';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_libro_guard ON dispensacion_controlados;
CREATE TRIGGER trg_libro_guard BEFORE UPDATE OR DELETE ON dispensacion_controlados
  FOR EACH ROW EXECUTE FUNCTION fn_libro_guard();

-- Verifica correlativo y cadena de hashes (detecta alteraciones directas en la BD)
CREATE OR REPLACE FUNCTION fn_verificar_libro_folia()
RETURNS TABLE (folio BIGINT, estado TEXT) AS $$
DECLARE r RECORD; v_prev TEXT := NULL; v_esp BIGINT := 1; v_ts TIMESTAMPTZ; v_cant INT;
BEGIN
  FOR r IN SELECT * FROM dispensacion_controlados d ORDER BY d.folio LOOP
    folio := r.folio;
    IF r.folio <> v_esp THEN estado := 'SALTO_EN_CORRELATIVO'; RETURN NEXT; END IF;
    SELECT k.fecha_hora, k.cantidad INTO v_ts, v_cant FROM movimientos_kardex k WHERE k.id = r.movimiento_id;
    estado := CASE WHEN fn_calc_hash_folio(v_prev, r.folio, r.movimiento_id, v_cant,
                          r.paciente_cedula, r.nro_recipe, v_ts) = r.hash_registro
                   THEN 'OK' ELSE 'HASH_ALTERADO' END;
    RETURN NEXT;
    v_prev := r.hash_registro; v_esp := r.folio + 1;
  END LOOP;
END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- B. MERMAS / DESINCORPORACIÓN (doble control: operador + Regente)
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_acta_desincorporacion START 1;

CREATE OR REPLACE FUNCTION fn_registrar_merma(
  p_lote UUID, p_cantidad INT, p_motivo motivo_merma, p_descripcion TEXT,
  p_registra UUID, p_autoriza UUID, p_evidencia TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_lote lotes%ROWTYPE; v_nro VARCHAR; v_mov UUID; v_id UUID; v_saldo INT;
BEGIN
  PERFORM fn_validar_operador(p_registra);
  IF p_registra = p_autoriza THEN
    RAISE EXCEPTION 'Quien registra y quien autoriza deben ser personas distintas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_autoriza AND activo AND rol = 'FARMACEUTICO_REGENTE') THEN
    RAISE EXCEPTION 'La desincorporación debe ser autorizada por el Farmacéutico Regente';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF length(trim(COALESCE(p_descripcion,''))) < 10 THEN
    RAISE EXCEPTION 'Describa lo ocurrido (mínimo 10 caracteres)';
  END IF;

  SELECT * INTO v_lote FROM lotes WHERE id = p_lote FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente'; END IF;
  IF v_lote.cantidad_actual < p_cantidad THEN
    RAISE EXCEPTION 'El lote solo tiene % unidades', v_lote.cantidad_actual;
  END IF;
  IF p_motivo = 'VENCIMIENTO' AND v_lote.fecha_vencimiento > CURRENT_DATE THEN
    RAISE EXCEPTION 'El lote aún no está vencido (vence %)', v_lote.fecha_vencimiento;
  END IF;

  UPDATE lotes
     SET cantidad_actual = cantidad_actual - p_cantidad,
         estado = CASE WHEN cantidad_actual - p_cantidad = 0 THEN 'DESINCORPORADO'::estado_lote ELSE estado END,
         actualizado_en = now(), sync_estado = 'PENDIENTE'
   WHERE id = p_lote
   RETURNING cantidad_actual INTO v_saldo;

  v_nro := 'DES-' || to_char(now(),'YYYY') || '-' || lpad(nextval('seq_acta_desincorporacion')::text, 6, '0');

  INSERT INTO movimientos_kardex (tipo, producto_id, lote_id, cantidad, saldo_lote, saldo_producto,
                                  documento_ref, usuario_id, observacion)
  VALUES ('MERMA', v_lote.producto_id, p_lote, p_cantidad, v_saldo,
          fn_saldo_producto(v_lote.producto_id), v_nro, p_registra, p_motivo::text || ': ' || p_descripcion)
  RETURNING id INTO v_mov;

  INSERT INTO mermas (nro_acta, movimiento_id, lote_id, cantidad, motivo, descripcion,
                      evidencia_url, registrado_por, autorizado_por)
  VALUES (v_nro, v_mov, p_lote, p_cantidad, p_motivo, p_descripcion, p_evidencia, p_registra, p_autoriza)
  RETURNING id INTO v_id;

  INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle)
  VALUES (p_registra, 'MERMA', 'mermas', v_id,
          jsonb_build_object('acta', v_nro, 'lote', p_lote, 'cantidad', p_cantidad,
                             'motivo', p_motivo, 'autoriza', p_autoriza));
  RETURN v_id;
END; $$ LANGUAGE plpgsql;

-- Marca como VENCIDO los lotes con fecha cumplida (el API lo ejecuta cada hora)
CREATE OR REPLACE FUNCTION fn_marcar_vencidos() RETURNS INT AS $$
DECLARE n INT;
BEGIN
  UPDATE lotes SET estado = 'VENCIDO', actualizado_en = now(), sync_estado = 'PENDIENTE'
   WHERE estado = 'ACTIVO' AND fecha_vencimiento <= CURRENT_DATE AND cantidad_actual > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- C. REPORTES (Kardex Sanitario, Libro Folia, consolidado ASIC)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_kardex_sanitario(p_producto UUID, p_desde DATE, p_hasta DATE)
RETURNS TABLE (fecha_hora TIMESTAMPTZ, tipo tipo_movimiento, numero_lote VARCHAR, fecha_vencimiento DATE,
               entrada INT, salida INT, saldo_producto INT, documento_ref VARCHAR,
               origen_destino TEXT, responsable VARCHAR) AS $$
  SELECT k.fecha_hora, k.tipo, l.numero_lote, l.fecha_vencimiento,
         CASE WHEN k.tipo IN ('ENTRADA','AJUSTE_POSITIVO') THEN k.cantidad ELSE 0 END,
         CASE WHEN k.tipo IN ('SALIDA','MERMA','AJUSTE_NEGATIVO') THEN k.cantidad ELSE 0 END,
         k.saldo_producto, k.documento_ref,
         COALESCE(s.nombre, po.nombre, '')::text, u.nombre_completo
  FROM movimientos_kardex k
  JOIN lotes l ON l.id = k.lote_id
  JOIN usuarios u ON u.id = k.usuario_id
  LEFT JOIN servicios_cdi_asic s ON s.id = k.servicio_id
  LEFT JOIN proveedores_origen po ON po.id = k.proveedor_id
  WHERE k.producto_id = p_producto
    AND k.fecha_hora >= p_desde AND k.fecha_hora < p_hasta + 1
  ORDER BY k.fecha_hora, k.id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW v_libro_folia AS
SELECT d.folio, k.fecha_hora, p.dci_principio_activo, p.nombre_comercial, p.concentracion,
       l.numero_lote, k.cantidad, d.paciente_cedula, d.paciente_nombre, d.medico_nombre,
       d.medico_matricula_mpps, d.colegio_medicos_nro, d.nro_recipe,
       u.nombre_completo AS farmaceutico, r.nombre_completo AS firmado_por, d.fecha_firma
FROM dispensacion_controlados d
JOIN movimientos_kardex k ON k.id = d.movimiento_id
JOIN lotes l ON l.id = k.lote_id
JOIN productos p ON p.id = k.producto_id
JOIN usuarios u ON u.id = d.farmaceutico_id
LEFT JOIN usuarios r ON r.id = d.firma_regente;

CREATE OR REPLACE FUNCTION fn_consolidado_asic(p_desde DATE, p_hasta DATE)
RETURNS TABLE (destino VARCHAR, tipo_destino tipo_servicio, dci VARCHAR, presentacion VARCHAR,
               concentracion VARCHAR, total_despachado INT) AS $$
  SELECT s.nombre, s.tipo, p.dci_principio_activo, p.presentacion, p.concentracion, SUM(k.cantidad)::int
  FROM movimientos_kardex k
  JOIN servicios_cdi_asic s ON s.id = k.servicio_id
  JOIN productos p ON p.id = k.producto_id
  WHERE k.tipo = 'SALIDA' AND k.fecha_hora >= p_desde AND k.fecha_hora < p_hasta + 1
  GROUP BY s.nombre, s.tipo, p.dci_principio_activo, p.presentacion, p.concentracion
  ORDER BY s.nombre, p.dci_principio_activo;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- D. SEGURIDAD: la aplicación solo escribe a través de funciones
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_farmacia') THEN
    CREATE ROLE app_farmacia LOGIN PASSWORD 'CAMBIAR_ESTA_CLAVE';   -- ¡cámbiela!
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_farmacia;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_farmacia;
GRANT INSERT, UPDATE ON productos, proveedores_origen, servicios_cdi_asic TO app_farmacia;
GRANT USAGE ON SEQUENCE seq_codigo_interno TO app_farmacia;

ALTER FUNCTION fn_asignar_fefo(uuid, integer)                     SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION fn_registrar_entrada(uuid, varchar, date, integer, uuid, varchar, uuid)
                                                                  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION fn_despachar(uuid, varchar, varchar, varchar, uuid, jsonb, text)
                                                                  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION fn_firmar_libro(bigint, uuid)                      SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION fn_registrar_merma(uuid, integer, motivo_merma, text, uuid, uuid, text)
                                                                  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION fn_marcar_vencidos()                               SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION fn_asignar_fefo(uuid, integer),
  fn_registrar_entrada(uuid, varchar, date, integer, uuid, varchar, uuid),
  fn_despachar(uuid, varchar, varchar, varchar, uuid, jsonb, text),
  fn_firmar_libro(bigint, uuid),
  fn_registrar_merma(uuid, integer, motivo_merma, text, uuid, uuid, text),
  fn_marcar_vencidos() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION fn_asignar_fefo(uuid, integer),
  fn_registrar_entrada(uuid, varchar, date, integer, uuid, varchar, uuid),
  fn_despachar(uuid, varchar, varchar, varchar, uuid, jsonb, text),
  fn_firmar_libro(bigint, uuid),
  fn_registrar_merma(uuid, integer, motivo_merma, text, uuid, uuid, text),
  fn_marcar_vencidos(),
  fn_verificar_libro_folia(),
  fn_kardex_sanitario(uuid, date, date),
  fn_consolidado_asic(date, date) TO app_farmacia;

-- auditoría: la app solo puede insertar (lo hacen las funciones; la API la usa para login/altas)
GRANT INSERT ON auditoria TO app_farmacia;
