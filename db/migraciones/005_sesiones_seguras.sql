-- v1.0.9: las sesiones (tokens) emitidas antes de un cambio de clave dejan de valer
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clave_cambiada_en TIMESTAMPTZ;
