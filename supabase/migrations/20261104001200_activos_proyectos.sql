-- Extensiones (fase 8): activos de infraestructura, plan de reposición (PRE-14) y proyectos (PRE-15).
-- Mismas reglas que el resto de la operación: RLS por empresa, bitácora y nada se borra.

create table activos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  categoria text not null check (categoria in ('Servidor', 'Red', 'Almacenamiento', 'Seguridad', 'UPS', 'Equipo de usuario', 'Otro')),
  nombre text not null,
  marca_modelo text,
  serial text,
  sucursal text,
  responsable text,
  proveedor_id uuid references proveedores (id),
  fecha_compra date,
  costo numeric(18, 2) check (costo >= 0),
  moneda text not null default 'RD$' check (moneda in ('RD$', 'US$')),
  garantia_hasta date,
  estado text not null default 'En uso' check (estado in ('En uso', 'En reparación', 'Para reponer', 'Retirado')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (id, empresa_id)
);
-- Un serial no se repite dentro de la empresa (PRE-14: validar seriales duplicados).
create unique index activos_serial_unico on activos (empresa_id, lower(serial)) where activo and serial is not null;

create table reposiciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  tipo text not null check (tipo in ('Reemplazo', 'Compra nueva', 'Mantenimiento')),
  activo_id uuid, -- el activo actual; obligatorio salvo en compras nuevas
  descripcion text not null, -- la propuesta
  cantidad int not null default 1 check (cantidad > 0),
  costo numeric(18, 2) check (costo >= 0),
  moneda text not null default 'RD$' check (moneda in ('RD$', 'US$')),
  departamento text,
  fecha_prevista date,
  estado text not null default 'Propuesta' check (estado in ('Propuesta', 'Presupuestada', 'Ejecutada', 'Descartada')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  foreign key (activo_id, empresa_id) references activos (id, empresa_id),
  check (tipo = 'Compra nueva' or activo_id is not null)
);

create table proyectos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  nombre text not null,
  tipo text not null check (tipo in ('Apertura', 'Remodelación', 'Inversión')),
  sucursal text,
  inicio date,
  fin date,
  estado text not null default 'Planificado' check (estado in ('Planificado', 'En ejecución', 'Terminado', 'Cancelado')),
  inversion_inicial numeric(18, 2) not null default 0 check (inversion_inicial >= 0), -- CAPEX
  opex_mensual numeric(18, 2) not null default 0 check (opex_mensual >= 0), -- servicios recurrentes después
  moneda text not null default 'RD$' check (moneda in ('RD$', 'US$')),
  nota text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  check (fin is null or inicio is null or fin >= inicio)
);

create index on activos (empresa_id);
create index on reposiciones (empresa_id);
create index on proyectos (empresa_id);

-- Mismo esquema de seguridad que la operación (20261104000200_seguridad.sql).
do $$
declare
  t text;
begin
  foreach t in array array['activos', 'reposiciones', 'proyectos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger a_control before insert or update on public.%I for each row execute function public.trg_control()', t);
    execute format('create trigger z_bitacora after insert or update on public.%I for each row execute function public.trg_bitacora()', t);
    execute format('create trigger sin_borrado before delete on public.%I for each row execute function public.trg_sin_borrado()', t);
    execute format('create trigger sin_vaciar before truncate on public.%I for each statement execute function public.trg_sin_borrado()', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.puede_leer(empresa_id))', t || '_leer', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.puede_escribir(empresa_id))', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.puede_escribir(empresa_id)) with check (public.puede_escribir(empresa_id))', t || '_editar', t);
  end loop;
end;
$$;

-- Panel: dos alertas nuevas al final (create or replace solo admite columnas nuevas al final).
create or replace view panel_empresa with (security_invoker = true) as
select
  e.id as empresa_id,
  e.nombre,
  e.moneda_reporte,
  coalesce(p.presupuesto, 0) as presupuesto,
  coalesce(p.comprometido, 0) as comprometido,
  coalesce(p.ejecutado, 0) as ejecutado,
  coalesce(p.pagado, 0) as pagado,
  coalesce(p.disponible, 0) as disponible,
  coalesce(p.ahorro, 0) as ahorro,
  coalesce(p.exceso, 0) as exceso,
  coalesce(sp.fuera, 0) as sin_partida,
  coalesce(t.rd, 0) as telecom_rd,
  coalesce(t.us, 0) as telecom_us,
  coalesce(fl.costo, 0) as flotas_mensual,
  coalesce(fl.lineas, 0) as flotas_lineas,
  coalesce(sw.vencen, 0) as software_vencen_60,
  coalesce(au.fuera, 0) as personal_fuera_hoy,
  coalesce(ac.garantias, 0) as garantias_vencen_60, -- garantías que vencen en los próximos 60 días
  coalesce(rp.pendientes, 0) as reposiciones_pendientes
from empresas e
left join lateral (
  select sum(s.presupuesto) as presupuesto, sum(s.comprometido) as comprometido, sum(s.ejecutado) as ejecutado,
         sum(s.pagado) as pagado, sum(s.disponible) as disponible,
         sum(greatest(s.disponible, 0)) as ahorro, sum(greatest(-s.disponible, 0)) as exceso
  from saldo_partidas s
  join presupuestos_versiones v on v.id = s.version_id
  where s.empresa_id = e.id and v.estado = 'Vigente' and v.activo
) p on true
left join lateral (
  select round(sum(greatest(r.comprometido, r.facturado) * g.tasa), 2) as fuera
  from gastos g join resumen_gastos r on r.gasto_id = g.id
  where g.empresa_id = e.id and g.partida_id is null
) sp on true
left join lateral (
  select sum(x.monto) filter (where x.moneda = 'RD$') as rd, sum(x.monto) filter (where x.moneda = 'US$') as us
  from servicios_telecom x where x.empresa_id = e.id and x.activo
) t on true
left join lateral (
  select sum(l.costo_mensual) as costo, count(*) as lineas
  from lineas_flota l where l.empresa_id = e.id and l.activo and l.estado <> 'Cancelada'
) fl on true
left join lateral (
  select count(*) as vencen
  from productos_software s where s.empresa_id = e.id and s.activo and s.vence <= current_date + 60
) sw on true
left join lateral (
  select count(*) as fuera
  from ausencias a where a.empresa_id = e.id and a.activo and not a.cancelada and current_date between a.desde and a.hasta
) au on true
left join lateral (
  select count(*) as garantias
  from activos x where x.empresa_id = e.id and x.activo and x.estado <> 'Retirado'
    and x.garantia_hasta between current_date and current_date + 60
) ac on true
left join lateral (
  select count(*) as pendientes
  from reposiciones r where r.empresa_id = e.id and r.activo and r.estado in ('Propuesta', 'Presupuestada')
) rp on true
where e.activo;
