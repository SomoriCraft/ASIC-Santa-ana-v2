-- Prueba: auditoría encadenada, inmutable y con huella por ajuste de conteo. Se revierte al final.
BEGIN;
DO $$
DECLARE reg UUID; alm UUID; srv UUID; prv UUID; p UUID; l UUID; c UUID; n BIGINT; e BIGINT; ok BOOLEAN; k INT;
BEGIN
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash) VALUES ('T31','Regente Auditoria','FARMACEUTICO_REGENTE','t_reg4','x') RETURNING id INTO reg;
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash) VALUES ('T32','Almacenista Auditoria','ALMACENISTA','t_alm4','x') RETURNING id INTO alm;
  INSERT INTO proveedores_origen (nombre,tipo) VALUES ('TEST Prov4','ASIGNACION_MPPS') RETURNING id INTO prv;
  INSERT INTO productos (dci_principio_activo,presentacion,concentracion,categoria,registro_sanitario_inhrr) VALUES ('loratadina','tableta','10 mg','MEDICAMENTO','E.F. 7') RETURNING id INTO p;
  l := fn_registrar_entrada(p,'LT-AUD',CURRENT_DATE+100,50,prv,'F4',alm);
  INSERT INTO auditoria (usuario_id, accion, tabla, detalle) VALUES (reg, 'PRUEBA_1', 'x', '{"a":1}'::jsonb);
  INSERT INTO auditoria (usuario_id, accion, tabla, detalle) VALUES (reg, 'PRUEBA_2', 'x', NULL);
  SELECT total, primer_error INTO n, e FROM fn_verificar_auditoria();
  IF e IS NOT NULL OR n < 2 THEN RAISE EXCEPTION 'FALLO 1: cadena invalida (total %, error %)', n, e; END IF;
  ok := FALSE; BEGIN UPDATE auditoria SET accion = 'ALTERADA' WHERE accion = 'PRUEBA_1'; ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 2: permitio modificar la auditoria'; END IF;
  ok := FALSE; BEGIN DELETE FROM auditoria WHERE accion = 'PRUEBA_2'; ok := TRUE; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 3: permitio borrar de la auditoria'; END IF;
  -- cada ajuste del conteo deja su propia huella
  c := fn_iniciar_conteo(to_char(CURRENT_DATE,'YYYY-MM'),reg);
  PERFORM fn_guardar_conteo(c, jsonb_build_array(jsonb_build_object('lote_id',l,'cantidad_fisica','45','motivo','Faltante detectado en estante')), alm);
  PERFORM fn_cerrar_conteo(c,reg,NULL);
  SELECT count(*) INTO k FROM auditoria WHERE accion='AJUSTE_CONTEO' AND registro_id=l AND (detalle->>'antes')::int=50 AND (detalle->>'despues')::int=45;
  IF k <> 1 THEN RAISE EXCEPTION 'FALLO 4: falta la huella del ajuste (%)', k; END IF;
  SELECT total, primer_error INTO n, e FROM fn_verificar_auditoria();
  IF e IS NOT NULL THEN RAISE EXCEPTION 'FALLO 5: la cadena se rompio (%)', e; END IF;
  RAISE NOTICE 'Auditoria: OK';
END $$;
ROLLBACK;
