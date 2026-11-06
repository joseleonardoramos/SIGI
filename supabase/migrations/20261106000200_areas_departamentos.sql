-- Maestro de áreas y departamentos por empresa. Flotas, personal y reposición dejan de usar texto libre
-- y apuntan al maestro (en pantalla: listas desplegables). El texto anterior queda en la bitácora.

create table areas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (id, empresa_id)
);
create unique index areas_nombre_unico on areas (empresa_id, lower(nombre));

create table departamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  area_id uuid not null,
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  foreign key (area_id, empresa_id) references areas (id, empresa_id),
  unique (id, empresa_id),
  unique (id, area_id)
);
create unique index departamentos_nombre_unico on departamentos (area_id, lower(nombre));
create index on departamentos (empresa_id);

-- Catálogo como centros de costo y cuentas: lo leen todos los de la empresa; lo mantiene el Administrador.
do $$
declare
  t text;
begin
  foreach t in array array['areas', 'departamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger a_control before insert or update on public.%I for each row execute function public.trg_control()', t);
    execute format('create trigger z_bitacora after insert or update on public.%I for each row execute function public.trg_bitacora()', t);
    execute format('create trigger sin_borrado before delete on public.%I for each row execute function public.trg_sin_borrado()', t);
    execute format('create trigger sin_vaciar before truncate on public.%I for each statement execute function public.trg_sin_borrado()', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.puede_leer(empresa_id))', t || '_leer', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.es_admin())', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.es_admin()) with check (public.es_admin())', t || '_editar', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Llenar el maestro con lo que ya existe y enlazar los registros.
-- ---------------------------------------------------------------------------
insert into areas (empresa_id, nombre)
select distinct on (empresa_id, lower(nombre)) empresa_id, nombre
from (
  select empresa_id, btrim(area) as nombre from lineas_flota where coalesce(btrim(area), '') <> ''
  union all
  select empresa_id, btrim(area) from personas where coalesce(btrim(area), '') <> ''
) x
order by empresa_id, lower(nombre), nombre;

insert into departamentos (empresa_id, area_id, nombre)
select distinct on (l.empresa_id, a.id, lower(btrim(l.departamento))) l.empresa_id, a.id, btrim(l.departamento)
from lineas_flota l
join areas a on a.empresa_id = l.empresa_id and lower(a.nombre) = lower(btrim(l.area))
where coalesce(btrim(l.departamento), '') <> ''
order by l.empresa_id, a.id, lower(btrim(l.departamento)), btrim(l.departamento);

-- Departamentos de reposición que no estaban en flotas: quedan en el área «Sin área» para revisarlos.
insert into areas (empresa_id, nombre)
select distinct r.empresa_id, 'Sin área'
from reposiciones r
where coalesce(btrim(r.departamento), '') <> ''
  and not exists (select 1 from departamentos d where d.empresa_id = r.empresa_id and lower(d.nombre) = lower(btrim(r.departamento)))
on conflict do nothing;
insert into departamentos (empresa_id, area_id, nombre)
select distinct on (r.empresa_id, lower(btrim(r.departamento))) r.empresa_id, a.id, btrim(r.departamento)
from reposiciones r
join areas a on a.empresa_id = r.empresa_id and a.nombre = 'Sin área'
where coalesce(btrim(r.departamento), '') <> ''
  and not exists (select 1 from departamentos d where d.empresa_id = r.empresa_id and lower(d.nombre) = lower(btrim(r.departamento)))
order by r.empresa_id, lower(btrim(r.departamento)), btrim(r.departamento);

-- Líneas de flota: área y departamento obligatorios, y el departamento debe ser del área.
alter table lineas_flota add column area_id uuid, add column departamento_id uuid;
update lineas_flota l set area_id = a.id
from areas a where a.empresa_id = l.empresa_id and lower(a.nombre) = lower(btrim(l.area));
update lineas_flota l set departamento_id = d.id
from departamentos d where d.area_id = l.area_id and lower(d.nombre) = lower(btrim(l.departamento));
alter table lineas_flota
  alter column area_id set not null,
  alter column departamento_id set not null,
  add foreign key (area_id, empresa_id) references areas (id, empresa_id),
  add foreign key (departamento_id, area_id) references departamentos (id, area_id),
  drop column area,
  drop column departamento;

-- Personal: área opcional.
alter table personas add column area_id uuid;
update personas p set area_id = a.id
from areas a where a.empresa_id = p.empresa_id and lower(a.nombre) = lower(btrim(p.area));
alter table personas
  add foreign key (area_id, empresa_id) references areas (id, empresa_id),
  drop column area;

-- Reposición: departamento opcional (el área sale del departamento).
alter table reposiciones add column departamento_id uuid;
update reposiciones r set departamento_id = (
  select d.id from departamentos d
  where d.empresa_id = r.empresa_id and lower(d.nombre) = lower(btrim(r.departamento))
  order by d.id limit 1)
where coalesce(btrim(r.departamento), '') <> '';
alter table reposiciones
  add foreign key (departamento_id, empresa_id) references departamentos (id, empresa_id),
  drop column departamento;

-- ---------------------------------------------------------------------------
-- Importación CSV: flotas valida contra el maestro; nuevo catálogo «departamentos» para cargarlo.
-- ---------------------------------------------------------------------------
alter table importaciones drop constraint importaciones_catalogo_check;
alter table importaciones add constraint importaciones_catalogo_check
  check (catalogo in ('proveedores', 'cuentas_proveedor', 'cuentas_contables', 'departamentos', 'servicios_telecom', 'lineas_flota', 'partidas'));

create or replace function public.csv_plantilla(p_catalogo text)
returns table (columna text, obligatoria boolean)
language sql immutable set search_path = ''
as $$
  select c.columna, c.obligatoria
  from (values
    ('proveedores', 1, 'Nombre', true), ('proveedores', 2, 'RNC', false), ('proveedores', 3, 'Categorías', false),

    ('cuentas_proveedor', 1, 'Proveedor', true), ('cuentas_proveedor', 2, 'Número', true),
    ('cuentas_proveedor', 3, 'Descripción', false), ('cuentas_proveedor', 4, 'Moneda', false),

    ('cuentas_contables', 1, 'Código', true), ('cuentas_contables', 2, 'Descripción', true),
    ('cuentas_contables', 3, 'Tipo', true), ('cuentas_contables', 4, 'Categoría', true),
    ('cuentas_contables', 5, 'Centro de costo', false), ('cuentas_contables', 6, 'Estado', false),

    ('departamentos', 1, 'Área', true), ('departamentos', 2, 'Departamento', true),

    ('servicios_telecom', 1, 'Sucursal', true), ('servicios_telecom', 2, 'Ubicación', false),
    ('servicios_telecom', 3, 'Proveedor', true), ('servicios_telecom', 4, 'Cuenta Proveedor', false),
    ('servicios_telecom', 5, 'Cuenta Contable', false), ('servicios_telecom', 6, 'No. Circuito', false),
    ('servicios_telecom', 7, 'Estatus', false), ('servicios_telecom', 8, 'Detalle', true),
    ('servicios_telecom', 9, 'Tipo', true), ('servicios_telecom', 10, 'Velocidad', false),
    ('servicios_telecom', 11, 'Moneda', false), ('servicios_telecom', 12, 'Monto', true),
    ('servicios_telecom', 13, 'Comentarios', false),

    ('lineas_flota', 1, 'Cuenta Proveedor', true), ('lineas_flota', 2, 'Número', true),
    ('lineas_flota', 3, 'Fecha creación', false), ('lineas_flota', 4, 'Tarjeta SIM', false),
    ('lineas_flota', 5, 'Status', false), ('lineas_flota', 6, 'Nombre', false),
    ('lineas_flota', 7, 'Área', true), ('lineas_flota', 8, 'Departamento', true),
    ('lineas_flota', 9, 'Datos (SI/NO)', false), ('lineas_flota', 10, 'Cantidad', false),
    ('lineas_flota', 11, 'Precio', true), ('lineas_flota', 12, 'Fecha Cambiazo', false),

    ('partidas', 1, 'Código', true), ('partidas', 2, 'Nombre', true), ('partidas', 3, 'Categoría', true),
    ('partidas', 4, 'Centro de costo', false), ('partidas', 5, 'Cuenta contable', false),
    ('partidas', 6, 'Distribución', true), ('partidas', 7, 'Monto', true)
  ) as c(catalogo, orden, columna, obligatoria)
  where c.catalogo = p_catalogo
  order by c.orden;
$$;

-- La muestra de la vista previa ya no lleva identificadores internos de área y departamento.
create or replace function public.csv_muestra(p_catalogo text) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v jsonb;
begin
  execute format(
    'select coalesce(jsonb_agg(x.m), ''[]'') from (
       select to_jsonb(t) - array[''id'', ''empresa_id'', ''version_id'', ''proveedor_id'', ''cuenta_proveedor_id'', ''area_id'', ''departamento_id'',
                                  ''activo'', ''creado_en'', ''creado_por'', ''baja_en'', ''baja_por'', ''baja_motivo''] as m
       from public.%I t
       where t.creado_en = now() and t.creado_por is not distinct from auth.uid()
       order by t.ctid
       limit 10) x', p_catalogo)
  into v;
  return v;
end;
$$;

-- Áreas y departamentos: crea el área si no existe; el departamento no puede repetirse en su área.
create function public.csv_importar_departamentos(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb;
  i int;
  m text[];
  v_err jsonb := '[]';
  v_area uuid;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    m := public.csv_obligatorios(f, 'departamentos');
    if cardinality(m) = 0 then
      begin
        v_area := (select a.id from public.areas a where a.empresa_id = p_empresa and lower(a.nombre) = lower(f ->> 'area') and a.activo);
        if v_area is null then
          insert into public.areas (empresa_id, nombre) values (p_empresa, f ->> 'area') returning id into v_area;
        end if;
        insert into public.departamentos (empresa_id, area_id, nombre) values (p_empresa, v_area, f ->> 'departamento');
      exception when others then
        m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
      end;
    end if;
    if cardinality(m) > 0 then
      v_err := v_err || jsonb_build_array(jsonb_build_object('fila', i + 1, 'mensaje', array_to_string(m, '; ')));
    end if;
  end loop;
  return v_err;
end;
$$;

create or replace function public.csv_importar_flotas(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb;
  i int;
  m text[];
  v_err jsonb := '[]';
  v_n int;
  v_cta uuid;
  v_prov uuid;
  v_area uuid;
  v_depto uuid;
  v_estado text;
  v_datos boolean;
  v_alta date;
  v_cambiazo date;
  v_precio numeric;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    m := public.csv_obligatorios(f, 'lineas_flota');

    select count(*), min(c.id::text)::uuid, min(c.proveedor_id::text)::uuid into v_n, v_cta, v_prov
    from public.cuentas_proveedor c
    where c.empresa_id = p_empresa and c.numero = f ->> 'cuenta_proveedor' and c.activo;
    if f ->> 'cuenta_proveedor' is not null and v_n = 0 then
      m := array_append(m, 'La cuenta de proveedor «' || (f ->> 'cuenta_proveedor') || '» no existe en esta empresa');
    elsif v_n > 1 then
      m := array_append(m, 'La cuenta «' || (f ->> 'cuenta_proveedor') || '» existe en varios proveedores');
    end if;

    -- Área y departamento deben existir en el maestro (Catálogos → Áreas y departamentos).
    v_area := (select a.id from public.areas a where a.empresa_id = p_empresa and lower(a.nombre) = lower(f ->> 'area') and a.activo);
    v_depto := (select d.id from public.departamentos d where d.area_id = v_area and lower(d.nombre) = lower(f ->> 'departamento') and d.activo);
    if f ->> 'area' is not null and v_area is null then
      m := array_append(m, 'El área «' || (f ->> 'area') || '» no existe en el maestro de áreas');
    elsif f ->> 'departamento' is not null and v_depto is null then
      m := array_append(m, 'El departamento «' || (f ->> 'departamento') || '» no existe en el área «' || (f ->> 'area') || '»');
    end if;

    -- Incluye las líneas insertadas en filas anteriores del mismo archivo.
    if exists (select 1 from public.lineas_flota l
               where l.empresa_id = p_empresa and l.numero = f ->> 'numero' and l.activo and l.estado <> 'Cancelada') then
      m := array_append(m, 'La línea «' || (f ->> 'numero') || '» ya está registrada');
    end if;

    v_estado := case public.csv_clave(f ->> 'status')
      when '' then 'Sin alerta' when 'activa' then 'Sin alerta' when 'activo' then 'Sin alerta' when 'sin_alerta' then 'Sin alerta'
      when 'sin_uso_90_dias' then 'Sin uso 90 días' when 'cambiazo_elegible' then 'Cambiazo elegible'
      when 'suspendida' then 'Suspendida' when 'suspendido' then 'Suspendida'
      when 'cancelada' then 'Cancelada' when 'cancelado' then 'Cancelada'
    end;
    if v_estado is null then
      m := array_append(m, 'Status no reconocido: ' || (f ->> 'status') || ' (use Activa, Sin uso 90 días, Cambiazo elegible, Suspendida o Cancelada)');
    end if;

    v_datos := case public.csv_clave(f ->> 'datos_si_no')
      when '' then true when 'si' then true when 's' then true when '1' then true
      when 'no' then false when 'n' then false when '0' then false
    end;
    if v_datos is null then
      m := array_append(m, 'Datos debe ser SI o NO');
    end if;

    v_alta := public.csv_fecha(f ->> 'fecha_creacion');
    if f ->> 'fecha_creacion' is not null and v_alta is null then
      m := array_append(m, 'Fecha creación inválida (use AAAA-MM-DD o DD/MM/AAAA)');
    end if;
    v_cambiazo := public.csv_fecha(f ->> 'fecha_cambiazo');
    if f ->> 'fecha_cambiazo' is not null and v_cambiazo is null then
      m := array_append(m, 'Fecha Cambiazo inválida (use AAAA-MM-DD o DD/MM/AAAA)');
    end if;

    v_precio := public.csv_numero(f ->> 'precio');
    if f ->> 'precio' is not null and (v_precio is null or v_precio < 0) then
      m := array_append(m, 'Precio inválido: ' || (f ->> 'precio'));
    end if;

    if cardinality(m) = 0 then
      begin
        insert into public.lineas_flota (empresa_id, numero, sim, area_id, departamento_id, usuario, datos, cantidad, costo_mensual,
                                         estado, proveedor_id, cuenta_proveedor_id, fecha_alta, fecha_cambiazo)
        values (p_empresa, f ->> 'numero', f ->> 'tarjeta_sim', v_area, v_depto, f ->> 'nombre', v_datos,
                f ->> 'cantidad', v_precio, v_estado, v_prov, v_cta, coalesce(v_alta, current_date), v_cambiazo);
      exception when others then
        m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
      end;
    end if;
    if cardinality(m) > 0 then
      v_err := v_err || jsonb_build_array(jsonb_build_object('fila', i + 1, 'mensaje', array_to_string(m, '; ')));
    end if;
  end loop;
  return v_err;
end;
$$;

create or replace function public.importar_csv(
  p_catalogo text,
  p_empresa uuid,
  p_archivo text,
  p_hash text,
  p_filas jsonb,
  p_confirmar boolean default false,
  p_version uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_filas jsonb;
  v_n int;
  v_err jsonb := '[]';
  v_muestra jsonb := '[]';
  v_faltan text;
  v_previa timestamptz;
  v_estado text;
begin
  if p_catalogo not in ('proveedores', 'cuentas_proveedor', 'cuentas_contables', 'departamentos', 'servicios_telecom', 'lineas_flota', 'partidas') then
    raise exception 'Catálogo desconocido: %.', p_catalogo;
  end if;
  if p_catalogo = 'proveedores' then
    p_empresa := null; -- maestro global
  elsif p_empresa is null then
    raise exception 'Seleccione la empresa.';
  end if;
  if p_catalogo <> 'partidas' then
    p_version := null;
  end if;

  if p_catalogo in ('proveedores', 'cuentas_proveedor', 'cuentas_contables', 'departamentos') then
    if not public.es_admin() then
      raise exception 'Solo el Administrador importa proveedores, cuentas, áreas y departamentos.';
    end if;
  elsif not public.puede_escribir(p_empresa) then
    raise exception 'Sin permiso para importar en esta empresa.';
  end if;

  if p_catalogo = 'partidas' then
    select v.estado into v_estado from public.presupuestos_versiones v
    where v.id = p_version and v.empresa_id = p_empresa and v.activo;
    if not found then
      raise exception 'Seleccione una versión de presupuesto de esta empresa.';
    end if;
    if v_estado = 'Cerrado' then
      raise exception 'La versión de presupuesto está cerrada.';
    end if;
  end if;

  v_n := jsonb_array_length(coalesce(p_filas, '[]'));
  if v_n = 0 then
    raise exception 'El archivo no tiene filas.';
  end if;
  if v_n > 5000 then
    raise exception 'El archivo tiene % filas; el máximo es 5000. Divídalo en partes.', v_n;
  end if;

  select i.creado_en into v_previa from public.importaciones i
  where i.catalogo = p_catalogo and i.empresa_id is not distinct from p_empresa
    and i.version_id is not distinct from p_version and i.hash = p_hash;
  if found then
    return jsonb_build_object('filas', v_n, 'importado', false, 'errores', jsonb_build_array(jsonb_build_object(
      'fila', 0, 'mensaje', 'Este archivo ya se importó el ' || to_char(v_previa at time zone 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI') || '.')));
  end if;

  -- Claves normalizadas y celdas vacías como nulo.
  select coalesce(jsonb_agg(n.obj order by n.ord), '[]') into v_filas
  from (
    select a.ord, (select jsonb_object_agg(public.csv_clave(e.k), nullif(btrim(e.v), '')) from jsonb_each_text(a.f) as e(k, v)) as obj
    from jsonb_array_elements(p_filas) with ordinality as a(f, ord)
  ) n;

  select string_agg('«' || c.columna || '»', ', ') into v_faltan
  from public.csv_plantilla(p_catalogo) c
  where c.obligatoria and not (v_filas -> 0 ? public.csv_clave(c.columna));
  if v_faltan is not null then
    return jsonb_build_object('filas', v_n, 'importado', false, 'errores', jsonb_build_array(jsonb_build_object(
      'fila', 1, 'mensaje', 'Faltan columnas en el encabezado: ' || v_faltan || '. Descargue la plantilla.')));
  end if;

  begin
    v_err := case p_catalogo
      when 'proveedores' then public.csv_importar_proveedores(v_filas)
      when 'cuentas_proveedor' then public.csv_importar_cuentas_proveedor(p_empresa, v_filas)
      when 'cuentas_contables' then public.csv_importar_cuentas(p_empresa, v_filas)
      when 'departamentos' then public.csv_importar_departamentos(p_empresa, v_filas)
      when 'servicios_telecom' then public.csv_importar_telecom(p_empresa, v_filas)
      when 'lineas_flota' then public.csv_importar_flotas(p_empresa, v_filas)
      when 'partidas' then public.csv_importar_partidas(p_empresa, p_version, v_filas)
    end;
    v_muestra := public.csv_muestra(p_catalogo); -- la variable sobrevive al deshacer
    if jsonb_array_length(v_err) > 0 or not p_confirmar then
      raise exception using errcode = 'SG001'; -- deshace todo: vista previa o archivo con errores
    end if;
    insert into public.importaciones (empresa_id, catalogo, version_id, archivo, hash, filas, contenido)
    values (p_empresa, p_catalogo, p_version, p_archivo, p_hash, v_n, p_filas);
  exception when sqlstate 'SG001' then
    null;
  end;

  return jsonb_build_object('filas', v_n, 'errores', v_err, 'importado', p_confirmar and jsonb_array_length(v_err) = 0,
                            'muestra', v_muestra);
end;
$$;

revoke execute on function public.csv_importar_departamentos(uuid, jsonb) from public, anon, authenticated;
