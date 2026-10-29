-- Prueba: esquema de seguridad local (sin correo). Se revierte al final.
BEGIN;
DO $$
DECLARE a UUID; b UUID; ok BOOLEAN;
BEGIN
  PERFORM bloqueado_hasta, intentos_preguntas, es_principal, intentos_fallidos, bloqueado, clave_cambiada_en FROM usuarios LIMIT 1;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'email') THEN RAISE EXCEPTION 'FALLO 1: la columna email debia eliminarse'; END IF;
  IF to_regclass('recuperacion_codigos') IS NOT NULL THEN RAISE EXCEPTION 'FALLO 2: recuperacion_codigos debia eliminarse'; END IF;
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash) VALUES ('T21','Regente Uno','FARMACEUTICO_REGENTE','t_r1','x') RETURNING id INTO a;
  INSERT INTO usuarios (cedula,nombre_completo,rol,username,password_hash) VALUES ('T22','Regente Dos','FARMACEUTICO_REGENTE','t_r2','x') RETURNING id INTO b;
  UPDATE usuarios SET es_principal = TRUE WHERE id = a;
  ok := FALSE; BEGIN UPDATE usuarios SET es_principal = TRUE WHERE id = b; ok := TRUE; EXCEPTION WHEN unique_violation THEN NULL; END;
  IF ok THEN RAISE EXCEPTION 'FALLO 3: permitio dos usuarios principales'; END IF;
  RAISE NOTICE 'Seguridad local: OK';
END $$;
ROLLBACK;
