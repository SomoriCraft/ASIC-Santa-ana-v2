-- Prueba de humo: recorre el flujo completo y falla (RAISE EXCEPTION) si algo no se cumple.
-- Úsela solo en una base de PRUEBAS. Todo se revierte al final (ROLLBACK).
BEGIN;
DO $$
DECLARE
  reg UUID; alm UUID; ins UUID; srv UUID; prv UUID; p_lib UUID; p_ctl UUID;
  l_b UUID; l_a UUID; acta UUID; n INT; n0 BIGINT; ok BOOLEAN; ctl JSONB;
BEGIN
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash)
    VALUES ('T1','Regente Prueba','FARMACEUTICO_REGENTE','t_reg','x') RETURNING id INTO reg;
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash)
    VALUES ('T2','Almacenista Prueba','ALMACENISTA','t_alm','x') RETURNING id INTO alm;
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash)
    VALUES ('T3','Inspector Prueba','INSPECTOR_ASIC','t_ins','x') RETURNING id INTO ins;
  INSERT INTO servicios_cdi_asic (nombre,tipo) VALUES ('TEST Urgencias','INTERNO_CDI') RETURNING id INTO srv;
  INSERT INTO proveedores_origen (nombre,tipo) VALUES ('TEST MPPS','ASIGNACION_MPPS') RETURNING id INTO prv;
  INSERT INTO productos (dci_principio_activo,presentacion,concentracion,categoria,registro_sanitario_inhrr)
    VALUES ('paracetamol','tableta','500 mg','MEDICAMENTO','E.F. 1') RETURNING id INTO p_lib;
  INSERT INTO productos (dci_principio_activo,presentacion,concentracion,categoria,registro_sanitario_inhrr,tipo_control)
    VALUES ('diazepam','ampolla','10 mg','MEDICAMENTO','E.F. 2','CONTROLADO_PSICOTROPICO') RETURNING id INTO p_ctl;

  -- 1. Un medicamento sin registro sanitario debe rechazarse
  ok := FALSE;
  BEGIN
    INSERT INTO productos (dci_principio_activo,presentacion,categoria) VALUES ('x','y','MEDICAMENTO');
    ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 1: acepto un medicamento sin registro sanitario'; END IF;

  -- 2. Entradas y rechazo de lote vencido
  l_b := fn_registrar_entrada(p_lib,'LOTE-B',CURRENT_DATE+200,50,prv,'FAC-1',alm);
  l_a := fn_registrar_entrada(p_lib,'LOTE-A',CURRENT_DATE+60,30,prv,'FAC-2',alm);
  ok := FALSE;
  BEGIN PERFORM fn_registrar_entrada(p_lib,'VENC',CURRENT_DATE-1,5,prv,'F',alm); ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 2: acepto una entrada vencida'; END IF;

  -- 3. FEFO: primero el lote que vence antes
  SELECT tomar INTO n FROM fn_asignar_fefo(p_lib,40) WHERE numero_lote='LOTE-A';
  IF n IS DISTINCT FROM 30 THEN RAISE EXCEPTION 'FALLO 3a: FEFO no tomo 30 de LOTE-A (%)', n; END IF;
  SELECT tomar INTO n FROM fn_asignar_fefo(p_lib,40) WHERE numero_lote='LOTE-B';
  IF n IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'FALLO 3b: FEFO no tomo 10 de LOTE-B (%)', n; END IF;

  -- 4. Despacho atomico: descuenta lotes, agota LOTE-A, escribe kardex
  acta := fn_despachar(srv,'V999','Receptor Prueba','Enfermera',alm,
            jsonb_build_array(jsonb_build_object('producto_id',p_lib,'cantidad',40)));
  SELECT cantidad_actual INTO n FROM lotes WHERE id=l_a;
  IF n <> 0 THEN RAISE EXCEPTION 'FALLO 4a: LOTE-A deberia quedar en 0 (%)', n; END IF;
  IF (SELECT estado::text FROM lotes WHERE id=l_a) <> 'AGOTADO' THEN RAISE EXCEPTION 'FALLO 4b: LOTE-A deberia estar AGOTADO'; END IF;
  IF fn_saldo_producto(p_lib) <> 40 THEN RAISE EXCEPTION 'FALLO 4c: saldo deberia ser 40'; END IF;
  IF (SELECT count(*) FROM movimientos_kardex WHERE acta_id=acta) <> 2 THEN RAISE EXCEPTION 'FALLO 4d: kardex deberia tener 2 salidas'; END IF;

  -- 5. Stock insuficiente y rol sin permiso se rechazan
  ok := FALSE;
  BEGIN PERFORM fn_despachar(srv,'V9','R','C',alm,jsonb_build_array(jsonb_build_object('producto_id',p_lib,'cantidad',1000))); ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 5a: despacho con stock insuficiente'; END IF;
  ok := FALSE;
  BEGIN PERFORM fn_despachar(srv,'V9','R','C',ins,jsonb_build_array(jsonb_build_object('producto_id',p_lib,'cantidad',1))); ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 5b: el inspector pudo despachar'; END IF;

  -- 6. Controlados: exigen datos del recipe; quedan en el Libro Folia con folio correlativo
  PERFORM fn_registrar_entrada(p_ctl,'D1',CURRENT_DATE+90,10,prv,'FAC-3',alm);
  ok := FALSE;
  BEGIN PERFORM fn_despachar(srv,'V9','R','C',alm,jsonb_build_array(jsonb_build_object('producto_id',p_ctl,'cantidad',1))); ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 6a: controlado despachado sin datos de recipe'; END IF;
  SELECT COALESCE(max(folio),0) INTO n0 FROM dispensacion_controlados;
  ctl := jsonb_build_object('producto_id',p_ctl,'cantidad',2,'paciente_cedula','V123','paciente_nombre','Paciente Prueba',
                            'medico_nombre','Dra. Prueba','medico_matricula_mpps','MPPS-1','nro_recipe','R-1');
  PERFORM fn_despachar(srv,'V999','Receptor Prueba','Enfermera',alm,jsonb_build_array(ctl));
  PERFORM fn_despachar(srv,'V999','Receptor Prueba','Enfermera',alm,jsonb_build_array(ctl));
  IF (SELECT max(folio) FROM dispensacion_controlados) <> n0 + 2 THEN RAISE EXCEPTION 'FALLO 6b: folios no correlativos'; END IF;
  IF (SELECT count(*) FROM fn_verificar_libro_folia() WHERE estado <> 'OK') > 0 THEN RAISE EXCEPTION 'FALLO 6c: la cadena del libro no verifica'; END IF;
  PERFORM fn_firmar_libro(n0 + 1, reg);

  -- 7. Libro Folia y Kardex son inmutables
  ok := FALSE;
  BEGIN UPDATE dispensacion_controlados SET paciente_nombre='ALTERADO' WHERE folio=n0+1; ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 7a: se pudo modificar el Libro Folia'; END IF;
  ok := FALSE;
  BEGIN UPDATE movimientos_kardex SET cantidad = cantidad + 1 WHERE acta_id=acta; ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 7b: se pudo modificar el Kardex'; END IF;

  -- 8. Mermas: doble control y validaciones
  ok := FALSE;
  BEGIN PERFORM fn_registrar_merma(l_b,5,'ROTURA','Frasco roto durante el traslado',reg,reg); ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 8a: merma con la misma persona registrando y autorizando'; END IF;
  ok := FALSE;
  BEGIN PERFORM fn_registrar_merma(l_b,5,'VENCIMIENTO','Lote que aun no esta vencido',alm,reg); ok := TRUE;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 8b: merma por vencimiento de un lote vigente'; END IF;
  PERFORM fn_registrar_merma(l_b,5,'ROTURA','Frasco roto durante el traslado',alm,reg);
  SELECT cantidad_actual INTO n FROM lotes WHERE id=l_b;
  IF n <> 35 THEN RAISE EXCEPTION 'FALLO 8c: LOTE-B deberia quedar en 35 (%)', n; END IF;
  IF fn_saldo_producto(p_lib) <> 35 THEN RAISE EXCEPTION 'FALLO 8d: saldo final deberia ser 35'; END IF;

  -- 9. Reportes responden
  IF (SELECT count(*) FROM fn_kardex_sanitario(p_lib,CURRENT_DATE-1,CURRENT_DATE+1)) < 5 THEN RAISE EXCEPTION 'FALLO 9a: kardex incompleto'; END IF;
  IF (SELECT count(*) FROM fn_consolidado_asic(CURRENT_DATE-1,CURRENT_DATE+1)) < 1 THEN RAISE EXCEPTION 'FALLO 9b: consolidado vacio'; END IF;

  RAISE NOTICE 'TODAS LAS PRUEBAS PASARON';
END $$;
ROLLBACK;
