-- =====================================================================
-- SISTEMA DE CONTROL DE INVENTARIO Y FARMACIA HOSPITALARIA
-- CDI Santa Ana - PostgreSQL 15+
-- Diseño offline-first: PK UUID + columnas de sincronización
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- TIPOS ENUM ----------
CREATE TYPE categoria_producto AS ENUM ('MEDICAMENTO','MATERIAL_MEDICO_QUIRURGICO','SOLUCION','REACTIVO');
CREATE TYPE tipo_control       AS ENUM ('LIBRE','RECETA','CONTROLADO_PSICOTROPICO','ESTUPEFACIENTE');
CREATE TYPE temp_almacen       AS ENUM ('AMBIENTE','CADENA_FRIO_2_8C');
CREATE TYPE tipo_origen        AS ENUM ('ASIGNACION_MPPS','BARRIO_ADENTRO','ALMACEN_ROBOTIZADO','GOBERNACION','DONACION_ONG','COMPRA_LOCAL');
CREATE TYPE tipo_servicio      AS ENUM ('INTERNO_CDI','CONSULTORIO_POPULAR');
CREATE TYPE rol_usuario        AS ENUM ('FARMACEUTICO_REGENTE','ALMACENISTA','INSPECTOR_ASIC');
CREATE TYPE tipo_movimiento    AS ENUM ('ENTRADA','SALIDA','MERMA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO');
CREATE TYPE motivo_merma       AS ENUM ('ROTURA','VENCIMIENTO','CONTAMINACION','CADENA_FRIO_ROTA','OTRO');
CREATE TYPE estado_lote        AS ENUM ('ACTIVO','CUARENTENA','AGOTADO','VENCIDO','DESINCORPORADO');

-- Columnas comunes de sincronización (se repiten en cada tabla)
-- sync_estado: PENDIENTE | SINCRONIZADO ; nodo_origen: identifica el servidor LAN

-- ---------- USUARIOS ----------
CREATE TABLE usuarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cedula         VARCHAR(12) NOT NULL UNIQUE,
  nombre_completo VARCHAR(150) NOT NULL,
  cargo          VARCHAR(80),
  matricula_mpps VARCHAR(30),
  rol            rol_usuario NOT NULL,
  username       VARCHAR(50) NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,                 -- argon2/bcrypt, nunca texto plano
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_estado    VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  nodo_origen    VARCHAR(30) NOT NULL DEFAULT 'CDI-SANTA-ANA'
);

-- ---------- SERVICIOS / DESTINOS ----------
CREATE TABLE servicios_cdi_asic (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      VARCHAR(100) NOT NULL UNIQUE,     -- Urgencias, UCI, Quirófano, Consultorio Popular X...
  tipo        tipo_servicio NOT NULL,
  responsable VARCHAR(150),
  ubicacion   VARCHAR(200),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
);

-- ---------- PROVEEDORES / ORIGEN ----------
CREATE TABLE proveedores_origen (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre    VARCHAR(150) NOT NULL,
  tipo      tipo_origen NOT NULL,
  rif       VARCHAR(15),
  contacto  VARCHAR(150),
  activo    BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
);

-- ---------- PRODUCTOS (MAESTRO) ----------
CREATE SEQUENCE seq_codigo_interno START 1;

CREATE TABLE productos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_barras     VARCHAR(50) UNIQUE,         -- NULL si no tiene
  codigo_interno    VARCHAR(20) NOT NULL UNIQUE
                    DEFAULT ('INT-' || lpad(nextval('seq_codigo_interno')::text, 6, '0')),
  dci_principio_activo VARCHAR(200) NOT NULL,   -- Denominación Común Internacional
  nombre_comercial  VARCHAR(200),
  presentacion      VARCHAR(100) NOT NULL,      -- tableta, ampolla, frasco...
  concentracion     VARCHAR(60),
  categoria         categoria_producto NOT NULL,
  registro_sanitario_inhrr VARCHAR(40),         -- E.F., P.B., etc.
  tipo_control      tipo_control NOT NULL DEFAULT 'LIBRE',
  temperatura       temp_almacen NOT NULL DEFAULT 'AMBIENTE',
  stock_minimo      INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  stock_maximo      INTEGER NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_estado       VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  CONSTRAINT ck_stock_rango CHECK (stock_maximo >= stock_minimo),
  -- Medicamentos requieren Registro Sanitario INHRR
  CONSTRAINT ck_reg_sanitario CHECK (
    categoria <> 'MEDICAMENTO' OR registro_sanitario_inhrr IS NOT NULL
  )
);
CREATE INDEX idx_prod_dci ON productos (lower(dci_principio_activo));  -- equivalencia terapéutica
CREATE INDEX idx_prod_dci_conc ON productos (lower(dci_principio_activo), concentracion);

-- ---------- LOTES ----------
CREATE TABLE lotes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id       UUID NOT NULL REFERENCES productos(id),
  numero_lote       VARCHAR(60) NOT NULL,       -- lote del fabricante
  fecha_vencimiento DATE NOT NULL,
  cantidad_inicial  INTEGER NOT NULL CHECK (cantidad_inicial > 0),
  cantidad_actual   INTEGER NOT NULL CHECK (cantidad_actual >= 0),   -- nunca negativo
  proveedor_id      UUID REFERENCES proveedores_origen(id),
  nro_factura_guia  VARCHAR(60),
  fecha_entrada     DATE NOT NULL DEFAULT CURRENT_DATE,
  estado            estado_lote NOT NULL DEFAULT 'ACTIVO',
  recibido_por      UUID NOT NULL REFERENCES usuarios(id),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_estado       VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  UNIQUE (producto_id, numero_lote, fecha_vencimiento),
  CONSTRAINT ck_cant CHECK (cantidad_actual <= cantidad_inicial)
);
CREATE INDEX idx_lotes_fefo ON lotes (producto_id, fecha_vencimiento)
  WHERE estado = 'ACTIVO' AND cantidad_actual > 0;

-- ---------- ACTAS DE DESPACHO (cabecera, doble firma) ----------
CREATE TABLE actas_despacho (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nro_acta        VARCHAR(20) NOT NULL UNIQUE,
  servicio_id     UUID NOT NULL REFERENCES servicios_cdi_asic(id),
  recibe_cedula   VARCHAR(12) NOT NULL,
  recibe_nombre   VARCHAR(150) NOT NULL,
  recibe_cargo    VARCHAR(80) NOT NULL,
  entrega_usuario UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT now(),
  firma_entrega   TEXT,                          -- hash/imagen de firma
  firma_recibe    TEXT,
  observaciones   TEXT,
  sync_estado     VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
);

-- ---------- KARDEX (inmutable, solo INSERT) ----------
CREATE TABLE movimientos_kardex (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_hora    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo          tipo_movimiento NOT NULL,
  producto_id   UUID NOT NULL REFERENCES productos(id),
  lote_id       UUID NOT NULL REFERENCES lotes(id),
  cantidad      INTEGER NOT NULL CHECK (cantidad > 0),
  saldo_lote    INTEGER NOT NULL CHECK (saldo_lote >= 0),
  saldo_producto INTEGER NOT NULL CHECK (saldo_producto >= 0),
  acta_id       UUID REFERENCES actas_despacho(id),
  servicio_id   UUID REFERENCES servicios_cdi_asic(id),
  proveedor_id  UUID REFERENCES proveedores_origen(id),
  documento_ref VARCHAR(60),                     -- factura, guía, acta
  usuario_id    UUID NOT NULL REFERENCES usuarios(id),
  observacion   TEXT,
  sync_estado   VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  nodo_origen   VARCHAR(30) NOT NULL DEFAULT 'CDI-SANTA-ANA'
);
CREATE INDEX idx_kardex_prod_fecha ON movimientos_kardex (producto_id, fecha_hora);

CREATE OR REPLACE FUNCTION fn_kardex_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El Kardex es inmutable: corrija mediante un movimiento de ajuste.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kardex_no_update BEFORE UPDATE OR DELETE ON movimientos_kardex
  FOR EACH ROW EXECUTE FUNCTION fn_kardex_inmutable();

-- ---------- LIBRO FOLIA DIGITAL (controlados) ----------
CREATE TABLE dispensacion_controlados (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio              BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,   -- correlativo sin saltos
  movimiento_id      UUID NOT NULL UNIQUE REFERENCES movimientos_kardex(id),
  paciente_cedula    VARCHAR(12) NOT NULL,
  paciente_nombre    VARCHAR(150) NOT NULL,
  medico_nombre      VARCHAR(150) NOT NULL,
  medico_matricula_mpps VARCHAR(30) NOT NULL,
  colegio_medicos_nro VARCHAR(30),
  nro_recipe         VARCHAR(40) NOT NULL,
  farmaceutico_id    UUID NOT NULL REFERENCES usuarios(id),
  firma_regente      UUID REFERENCES usuarios(id),    -- firma del Regente
  fecha_firma        TIMESTAMPTZ,
  hash_registro      TEXT,                            -- encadenado para detectar alteraciones
  sync_estado        VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
);

-- ---------- MERMAS Y DESINCORPORACIÓN ----------
CREATE TABLE mermas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nro_acta        VARCHAR(20) NOT NULL UNIQUE,
  movimiento_id   UUID NOT NULL UNIQUE REFERENCES movimientos_kardex(id),
  lote_id         UUID NOT NULL REFERENCES lotes(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  motivo          motivo_merma NOT NULL,
  descripcion     TEXT NOT NULL,
  evidencia_url   TEXT,
  registrado_por  UUID NOT NULL REFERENCES usuarios(id),
  autorizado_por  UUID NOT NULL REFERENCES usuarios(id),   -- Regente
  fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_estado     VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  CONSTRAINT ck_dos_personas CHECK (registrado_por <> autorizado_por)
);

-- ---------- AUDITORÍA ----------
CREATE TABLE auditoria (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id  UUID REFERENCES usuarios(id),
  accion      VARCHAR(60) NOT NULL,
  tabla       VARCHAR(60),
  registro_id UUID,
  detalle     JSONB,
  ip          INET,
  fecha_hora  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- ALGORITMO FEFO
-- Devuelve las asignaciones de lote (puede ser más de un lote) para
-- cubrir la cantidad solicitada, priorizando el que vence primero.
-- Excluye vencidos, en cuarentena y agotados.
-- Debe ejecutarse dentro de una transacción (FOR UPDATE bloquea filas).
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_asignar_fefo(p_producto UUID, p_cantidad INTEGER)
RETURNS TABLE (lote_id UUID, numero_lote VARCHAR, fecha_vencimiento DATE, tomar INTEGER) AS $$
DECLARE
  v_restante INTEGER := p_cantidad;
  r RECORD;
  v_tomar INTEGER;
BEGIN
  FOR r IN
    SELECT l.id, l.numero_lote, l.fecha_vencimiento, l.cantidad_actual
    FROM lotes l
    WHERE l.producto_id = p_producto
      AND l.estado = 'ACTIVO'
      AND l.cantidad_actual > 0
      AND l.fecha_vencimiento > CURRENT_DATE
    ORDER BY l.fecha_vencimiento ASC, l.fecha_entrada ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_tomar := LEAST(r.cantidad_actual, v_restante);
    v_restante := v_restante - v_tomar;
    lote_id := r.id; numero_lote := r.numero_lote;
    fecha_vencimiento := r.fecha_vencimiento; tomar := v_tomar;
    RETURN NEXT;
  END LOOP;

  IF v_restante > 0 THEN
    RAISE EXCEPTION 'Stock insuficiente: faltan % unidades (producto %)', v_restante, p_producto;
  END IF;
END; $$ LANGUAGE plpgsql;

-- Equivalencia terapéutica: alternativas con mismo principio activo y concentración
CREATE OR REPLACE VIEW v_equivalentes AS
SELECT p.id AS producto_id, e.id AS equivalente_id, e.nombre_comercial, e.presentacion,
       COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.estado='ACTIVO' AND l.fecha_vencimiento > CURRENT_DATE),0) AS stock
FROM productos p
JOIN productos e ON lower(e.dci_principio_activo) = lower(p.dci_principio_activo)
                AND e.concentracion IS NOT DISTINCT FROM p.concentracion
                AND e.id <> p.id AND e.activo
LEFT JOIN lotes l ON l.producto_id = e.id
GROUP BY p.id, e.id;

-- Vista para alertas del dashboard (30/60/90 días y stock crítico)
CREATE OR REPLACE VIEW v_alertas_vencimiento AS
SELECT l.id, p.dci_principio_activo, p.nombre_comercial, l.numero_lote, l.fecha_vencimiento,
       l.cantidad_actual,
       CASE WHEN l.fecha_vencimiento <= CURRENT_DATE + 30 THEN 30
            WHEN l.fecha_vencimiento <= CURRENT_DATE + 60 THEN 60
            ELSE 90 END AS ventana_dias
FROM lotes l JOIN productos p ON p.id = l.producto_id
WHERE l.estado='ACTIVO' AND l.cantidad_actual > 0
  AND l.fecha_vencimiento <= CURRENT_DATE + 90;

CREATE OR REPLACE VIEW v_stock_critico AS
SELECT p.id, p.dci_principio_activo, p.stock_minimo,
       COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.estado='ACTIVO'),0) AS stock_actual
FROM productos p LEFT JOIN lotes l ON l.producto_id = p.id
WHERE p.activo
GROUP BY p.id
HAVING COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.estado='ACTIVO'),0) <= p.stock_minimo;
