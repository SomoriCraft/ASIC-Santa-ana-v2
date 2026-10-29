-- v1.0.3: gestión de usuarios, importación y auditoría consultable
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_clave BOOLEAN NOT NULL DEFAULT FALSE;
GRANT INSERT, UPDATE ON usuarios TO app_farmacia;
