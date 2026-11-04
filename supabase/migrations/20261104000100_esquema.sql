-- Esquema base de SIGI (documento v3.1).
-- Reglas: nada se borra físicamente (ver 20261104000200_seguridad.sql); las bajas son lógicas (activo = false);
-- montos en numeric(18,2); tasas en numeric(14,4); fechas en date.

create extension if not exists btree_gist;

-- Empresas (creación global: solo Administrador).
create table empresas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  inicio_ejercicio_mes int not null check (inicio_ejercicio_mes between 1 and 12),
  moneda_reporte text not null default 'RD$' check (moneda_reporte in ('RD$', 'US$')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);

-- Membresías: una persona puede tener roles distintos en empresas distintas.
-- Administrador: global (empresa_id nulo). Captura y Consulta: por empresa.
create table membresias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id),
  empresa_id uuid references empresas (id),
  rol text not null check (rol in ('Administrador', 'Captura', 'Consulta')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  check ((rol = 'Administrador') = (empresa_id is null)),
  unique nulls not distinct (usuario_id, empresa_id, rol)
);

-- Bitácora: altas y ediciones con valor anterior y nuevo. Solo la escriben triggers.
create table bitacora (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id text not null,
  empresa_id uuid,
  accion text not null check (accion in ('INSERT', 'UPDATE')),
  antes jsonb,
  despues jsonb,
  usuario_id uuid,
  ocurrido_en timestamptz not null default now()
);

-- Catálogos por empresa.
create table centros_costo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  codigo text not null check (codigo ~ '^[0-9]{3}$'),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (empresa_id, codigo)
);

create table cuentas_contables (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  centro_costo_codigo text check (centro_costo_codigo ~ '^[0-9]{3}$'),
  codigo text not null,
  descripcion text not null,
  tipo text not null check (tipo in ('OPEX', 'CAPEX')),
  categoria text not null,
  estado text not null default 'Activa' check (estado in ('Activa', 'Nueva', 'Inactiva')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (empresa_id, codigo)
);

-- Proveedores: maestro único compartido por las empresas.
create table proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  rnc text unique check (rnc ~ '^[0-9]{9}$' or rnc ~ '^[0-9]{11}$'),
  categorias text[] not null default '{}',
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);

-- Cuenta del proveedor por empresa (número de cliente o contrato).
create table cuentas_proveedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  proveedor_id uuid not null references proveedores (id),
  numero text not null,
  descripcion text,
  moneda text not null default 'RD$' check (moneda in ('RD$', 'US$')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (empresa_id, proveedor_id, numero)
);

-- Servicios de telecomunicaciones.
create table servicios_telecom (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  sucursal text not null,
  ciudad text,
  proveedor_id uuid references proveedores (id),
  cuenta_proveedor_id uuid references cuentas_proveedor (id),
  tipo text not null check (tipo in ('Internet', 'Telefonía', 'Metro Ethernet', 'Internet Móvil')),
  detalle text not null,
  velocidad text,
  moneda text not null default 'RD$' check (moneda in ('RD$', 'US$')),
  monto numeric(18, 2) not null check (monto >= 0),
  tasa numeric(14, 4) not null default 1 check (tasa > 0),
  circuito text,
  cuenta_contable text,
  estatus text not null default 'Activo',
  vence date,
  comentarios text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);

-- Líneas de flotas móviles.
create table lineas_flota (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  numero text not null,
  sim text,
  area text not null,
  departamento text not null,
  usuario text,
  datos boolean not null default true,
  cantidad text,
  costo_mensual numeric(18, 2) not null check (costo_mensual >= 0),
  estado text not null default 'Sin alerta' check (estado in ('Sin alerta', 'Sin uso 90 días', 'Cambiazo elegible', 'Suspendida', 'Cancelada')),
  proveedor_id uuid references proveedores (id),
  cuenta_proveedor_id uuid references cuentas_proveedor (id),
  fecha_alta date not null default current_date,
  fecha_cambiazo date,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);

-- Software y suscripciones.
create table productos_software (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  nombre text not null,
  tipo text not null check (tipo in ('SaaS', 'PaaS', 'IaaS', 'Licencia', 'Certificado')),
  proveedor_id uuid references proveedores (id),
  cuenta_proveedor_id uuid references cuentas_proveedor (id),
  unidad text not null,
  contratadas int not null check (contratadas > 0),
  asignadas int not null default 0 check (asignadas >= 0),
  precio_unitario numeric(18, 2) not null check (precio_unitario > 0),
  moneda text not null default 'US$' check (moneda in ('RD$', 'US$')),
  periodicidad text not null check (periodicidad in ('Mensual', 'Anual', 'Por consumo')),
  inicio date not null,
  vence date,
  renovacion text not null check (renovacion in ('Automática', 'Manual', 'Por consumo')),
  preaviso_dias int not null default 0 check (preaviso_dias >= 0),
  cuenta_contable text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  check (asignadas <= contratadas),
  check (vence is null or vence > inicio)
);

-- Presupuesto: versiones por empresa y ejercicio; partidas con monto absoluto por versión.
create table presupuestos_versiones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  ejercicio text not null check (ejercicio ~ '^[0-9]{4}(-[0-9]{4})?$'),
  numero int not null check (numero > 0),
  escenario text not null default 'Base',
  estado text not null default 'Borrador' check (estado in ('Borrador', 'Vigente', 'Cerrado')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (empresa_id, ejercicio, numero)
);

create table partidas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  version_id uuid not null references presupuestos_versiones (id),
  codigo text not null,
  nombre text not null,
  categoria text not null,
  centro_costo_codigo text,
  cuenta_contable text,
  distribucion text not null check (distribucion ~ '^(Uniforme|Trimestral|Puntual · (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic))$'),
  monto numeric(18, 2) not null check (monto >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (version_id, codigo)
);

-- Gastos: compromiso, factura y pago, con evidencias.
create table gastos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  codigo text not null,
  origen text not null check (origen in ('Software', 'Telecom', 'Flotas', 'Partida')),
  referencia text,
  descripcion text not null,
  proveedor_id uuid references proveedores (id),
  cuenta_proveedor_id uuid references cuentas_proveedor (id),
  partida_id uuid references partidas (id),
  cuenta_contable text,
  moneda text not null default 'RD$' check (moneda in ('RD$', 'US$')),
  tasa numeric(14, 4) not null default 1 check (tasa > 0),
  renueva_hasta date,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (empresa_id, codigo)
);

create table gasto_pasos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  gasto_id uuid not null references gastos (id),
  tipo text not null check (tipo in ('Compromiso', 'Factura', 'Pago', 'Evidencia')),
  documento text,
  ncf text check (ncf ~ '^B[0-9]{10}$' or ncf ~ '^E[0-9]{12}$'),
  fecha date not null,
  monto numeric(18, 2) not null default 0 check (monto >= 0),
  metodo_pago text,
  referencia_bancaria text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);

-- Evidencias: el archivo vive en Storage privado; aquí solo su ruta y datos.
create table evidencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  paso_id uuid not null references gasto_pasos (id),
  ruta_storage text not null unique,
  nombre text not null,
  tipo_mime text not null,
  tamano_bytes bigint not null check (tamano_bytes > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);

-- Marca informativa "Aprobado por Dirección": solo la escribe el Administrador. No bloquea registros.
-- Cada cambio es una fila nueva; la vigente es la más reciente por entidad.
create table marcas_direccion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  entidad text not null,
  entidad_id text not null,
  marcado boolean not null,
  marcado_por uuid not null default auth.uid(),
  marcado_en timestamptz not null default now()
);

-- Personal y ausencias.
create table personas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  nombre text not null,
  cargo text,
  area text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);

create table ausencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  persona_id uuid not null references personas (id),
  tipo text not null check (tipo in ('Vacaciones', 'Permiso', 'Incapacidad', 'Viaje', 'Otro')),
  desde date not null,
  hasta date not null,
  cobertura text,
  nota text,
  cancelada boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  check (hasta >= desde),
  -- Una persona no puede tener dos ausencias vigentes que se traslapen.
  exclude using gist (persona_id with =, daterange(desde, hasta, '[]') with &&) where (not cancelada)
);

-- Índices para las búsquedas por empresa (RLS filtra por empresa_id en cada consulta).
create index on membresias (usuario_id) where activo;
create index on centros_costo (empresa_id);
create index on cuentas_contables (empresa_id);
create index on cuentas_proveedor (empresa_id);
create index on servicios_telecom (empresa_id);
create index on lineas_flota (empresa_id);
create index on productos_software (empresa_id);
create index on presupuestos_versiones (empresa_id);
create index on partidas (empresa_id, version_id);
create index on gastos (empresa_id);
create index on gasto_pasos (empresa_id, gasto_id);
create index on evidencias (empresa_id, paso_id);
create index on marcas_direccion (empresa_id, entidad, entidad_id, marcado_en desc);
create index on personas (empresa_id);
create index on ausencias (empresa_id, desde, hasta);
create index on bitacora (tabla, registro_id);
