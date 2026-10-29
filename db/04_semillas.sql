-- Datos iniciales editables. Agregue aquí los Consultorios Populares reales de la ASIC Santa Ana.
INSERT INTO servicios_cdi_asic (nombre, tipo) VALUES
  ('Urgencias','INTERNO_CDI'),
  ('Terapia Intensiva (UCI)','INTERNO_CDI'),
  ('Quirófano','INTERNO_CDI'),
  ('Observación','INTERNO_CDI'),
  ('Apoyo Diagnóstico / Laboratorio','INTERNO_CDI'),
  ('Encamados','INTERNO_CDI'),
  ('Consultorio Popular (EDITAR NOMBRE)','CONSULTORIO_POPULAR')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO proveedores_origen (nombre, tipo) VALUES
  ('Asignación MPPS','ASIGNACION_MPPS'),
  ('Barrio Adentro','BARRIO_ADENTRO'),
  ('Almacén Robotizado','ALMACEN_ROBOTIZADO'),
  ('Gobernación','GOBERNACION'),
  ('Donación ONG (EDITAR)','DONACION_ONG'),
  ('Compra Local (EDITAR)','COMPRA_LOCAL');
