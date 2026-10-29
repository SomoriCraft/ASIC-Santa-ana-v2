-- v1.0.7: seguridad 100 % local (sin correo): bloqueo temporal, intentos de preguntas y usuario principal
DROP TABLE IF EXISTS recuperacion_codigos;
DELETE FROM config_sistema WHERE clave = 'smtp';
ALTER TABLE usuarios DROP COLUMN IF EXISTS email;
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intentos_preguntas INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS es_principal BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_principal ON usuarios (es_principal) WHERE es_principal;
-- El usuario principal es el primer Farmacéutico Regente registrado
UPDATE usuarios SET es_principal = TRUE
 WHERE id = (SELECT id FROM usuarios WHERE rol = 'FARMACEUTICO_REGENTE' ORDER BY creado_en LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM usuarios WHERE es_principal);
-- Los usuarios que quedaron con el contador del esquema anterior empiezan limpios
UPDATE usuarios SET intentos_fallidos = 0, bloqueado = FALSE WHERE bloqueado OR intentos_fallidos > 0;
