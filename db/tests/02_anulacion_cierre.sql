-- Prueba: anulación de despachos y conteo/cierre mensual. Base de PRUEBAS; todo se revierte (ROLLBACK).
BEGIN;
DO $$
DECLARE
  reg UUID; alm UUID; srv UUID; prv UUID; p UUID; l UUID; a1 UUID; a2 UUID; c UUID; n INT; ok BOOLEAN; est TEXT; cant INT; r JSONB;
BEGIN
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash) VALUES ('T11','Regente Cierre','FARMACEUTICO_REGENTE','t_reg2','x') RETURNING id INTO reg;
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash) VALUES ('T12','Almacenista Cierre','ALMACENISTA','t_alm2','x') RETURNING id INTO alm;
  INSERT INTO servicios_cdi_asic (nombre,tipo) VALUES ('TEST Cierre','INTERNO_CDI') RETURNING id INTO srv;
  INSERT INTO proveedores_origen (nombre,tipo) VALUES ('TEST Prov','ASIGNACION_MPPS') RETURNING id INTO prv;
  INSERT INTO productos (dci_principio_activo,presentacion,concentracion,categoria,registro_sanitario_inhrr)
    VALUES ('ibuprofeno','tableta','400 mg','MEDICAMENTO','E.F. 9') RETURNING id INTO p;
  l  := fn_registrar_entrada(p,'LT-CIERRE',CURRENT_DATE+100,100,prv,'F1',alm);
  a1 := fn_despachar(srv,'V1','Receptor','Enfermera',alm,jsonb_build_array(jsonb_build_object('producto_id',p,'cantidad',100)));
  SELECT estado::text INTO est FROM lotes WHERE id=l;
  IF est <> 'AGOTADO' THEN RAISE EXCEPTION 'FALLO 0: el lote debia quedar AGOTADO (%)', est; END IF;

  -- 1. Solo el Regente puede anular
  ok := FALSE; BEGIN PERFORM fn_anular_despacho(a1,'Motivo suficientemente largo',alm); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 1: un almacenista pudo anular'; END IF;
  -- 2. Motivo corto rechazado
  ok := FALSE; BEGIN PERFORM fn_anular_despacho(a1,'corto',reg); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 2: acepto un motivo corto'; END IF;
  -- 3. Anulacion correcta: reintegra y reactiva el lote
  n := fn_anular_despacho(a1,'Error de digitacion del receptor',reg);
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO 3a: movimientos reintegrados=%', n; END IF;
  SELECT estado::text, cantidad_actual INTO est, cant FROM lotes WHERE id=l;
  IF est <> 'ACTIVO' OR cant <> 100 THEN RAISE EXCEPTION 'FALLO 3b: lote % / %', est, cant; END IF;
  -- 4. No se puede anular dos veces
  ok := FALSE; BEGIN PERFORM fn_anular_despacho(a1,'Segundo intento de anulacion',reg); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 4: permitio anular dos veces'; END IF;
  -- 5. El consolidado ASIC no cuenta el despacho anulado
  SELECT COALESCE(SUM(total_despachado),0) INTO n FROM fn_consolidado_asic(CURRENT_DATE,CURRENT_DATE) WHERE destino='TEST Cierre';
  IF n <> 0 THEN RAISE EXCEPTION 'FALLO 5: consolidado cuenta un despacho anulado (%)', n; END IF;

  -- 6. Conteo fisico: segundo despacho y cierre con diferencia
  a2 := fn_despachar(srv,'V2','Receptor','Enfermera',alm,jsonb_build_array(jsonb_build_object('producto_id',p,'cantidad',10)));
  c := fn_iniciar_conteo(to_char(CURRENT_DATE,'YYYY-MM'),reg);
  ok := FALSE; BEGIN PERFORM fn_iniciar_conteo(to_char(CURRENT_DATE,'YYYY-MM'),reg); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 6a: permitio dos conteos'; END IF;
  ok := FALSE; BEGIN PERFORM fn_cerrar_conteo(c,reg,NULL); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 6b: cerro un conteo con lotes sin contar'; END IF;
  PERFORM fn_guardar_conteo(c, jsonb_build_array(jsonb_build_object('lote_id',l,'cantidad_fisica','85','motivo','')), alm);
  ok := FALSE; BEGIN PERFORM fn_cerrar_conteo(c,reg,NULL); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 6c: cerro con diferencia sin motivo'; END IF;
  PERFORM fn_guardar_conteo(c, jsonb_build_array(jsonb_build_object('lote_id',l,'cantidad_fisica','85','motivo','Faltante detectado en estante')), alm);
  ok := FALSE; BEGIN PERFORM fn_cerrar_conteo(c,alm,NULL); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 6d: un almacenista cerro el mes'; END IF;
  r := fn_cerrar_conteo(c,reg,'Cierre de prueba');
  IF (r->>'ajustes')::int <> 1 OR (r->>'faltantes')::int <> 1 THEN RAISE EXCEPTION 'FALLO 6e: resumen %', r; END IF;
  SELECT cantidad_actual INTO cant FROM lotes WHERE id=l;
  IF cant <> 85 THEN RAISE EXCEPTION 'FALLO 6f: lote quedo en %', cant; END IF;
  SELECT count(*) INTO n FROM movimientos_kardex WHERE lote_id=l AND tipo='AJUSTE_NEGATIVO' AND documento_ref LIKE 'CONTEO-%';
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO 6g: falta el ajuste en el kardex'; END IF;
  -- 7. Mes cerrado: ya no se pueden anular despachos de ese mes
  ok := FALSE; BEGIN PERFORM fn_anular_despacho(a2,'Intento sobre un mes ya cerrado',reg); ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 7: anulo un despacho de un mes cerrado'; END IF;
  RAISE NOTICE 'Anulacion y cierre mensual: OK';
END $$;
ROLLBACK;
