-- Importación CSV (fase 4).
-- El navegador lee el archivo y envía las filas; aquí se validan fila por fila y se insertan en una sola
-- transacción. La vista previa inserta y deshace todo; confirmar solo guarda si no hay ningún error.

-- Registro de cada importación confirmada (solo agregar). El hash evita importar el mismo archivo dos veces.
create table importaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas (id),
  catalogo text not null check (catalogo in ('proveedores', 'cuentas_proveedor', 'cuentas_contables', 'servicios_telecom', 'lineas_flota', 'partidas')),
  version_id uuid references presupuestos_versiones (id),
  archivo text not null,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  filas int not null check (filas > 0),
  contenido jsonb not null,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  unique nulls not distinct (catalogo, empresa_id, version_id, hash)
);
alter table importaciones enable row level security;
create trigger solo_agregar before update or delete on importaciones for each row execute function public.trg_solo_agregar();
create trigger sin_vaciar before truncate on importaciones for each statement execute function public.trg_solo_agregar();
create policy importaciones_leer on importaciones for select to authenticated using (public.es_admin() or public.puede_escribir(empresa_id));
revoke all on importaciones from anon;
revoke insert, update, delete, truncate on importaciones from authenticated;

-- «Claro» y «CLARO» son el mismo proveedor: la importación lo busca sin distinguir mayúsculas.
create unique index proveedores_nombre_unico on proveedores (lower(nombre));

-- ---------------------------------------------------------------------------
-- Plantillas: la única definición de columnas. El navegador descarga el encabezado desde aquí.
-- ---------------------------------------------------------------------------
create function public.csv_plantilla(p_catalogo text)
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

-- ---------------------------------------------------------------------------
-- Conversión de valores del archivo.
-- ---------------------------------------------------------------------------

-- Nombre de columna normalizado: «No. Circuito» → no_circuito, «Área» → area.
create function public.csv_clave(p text) returns text
language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(lower(translate(btrim(coalesce(p, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', '_', 'g'), '_');
$$;

-- Número con punto decimal; acepta RD$, US$, $ y comas de miles («RD$ 1,500.00» → 1500.00).
create function public.csv_numero(p text) returns numeric
language plpgsql immutable set search_path = ''
as $$
declare
  t text := regexp_replace(coalesce(p, ''), '(RD|US)?\$|\s|,', '', 'gi');
begin
  if t ~ '^-?[0-9]+(\.[0-9]+)?$' then
    return t::numeric;
  end if;
  return null;
end;
$$;

-- Fecha AAAA-MM-DD o DD/MM/AAAA; nulo si no es válida (por ejemplo 31/02/2026).
create function public.csv_fecha(p text) returns date
language plpgsql immutable set search_path = ''
as $$
begin
  if p ~ '^\d{4}-\d{2}-\d{2}$' then
    return p::date;
  end if;
  if p ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    return to_date(p, 'DD/MM/YYYY');
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create function public.csv_moneda(p text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when coalesce(upper(btrim(p)), '') in ('', 'RD$', 'RD', 'DOP') then 'RD$'
    when upper(btrim(p)) in ('US$', 'USD', 'US') then 'US$'
  end;
$$;

-- Mensajes de las columnas obligatorias vacías de una fila.
create function public.csv_obligatorios(f jsonb, p_catalogo text) returns text[]
language sql stable set search_path = ''
as $$
  select coalesce(array_agg('Falta «' || c.columna || '»'), '{}')
  from public.csv_plantilla(p_catalogo) c
  where c.obligatoria and f ->> public.csv_clave(c.columna) is null;
$$;

-- Error de la base convertido en mensaje para el usuario.
create function public.csv_mensaje(p_estado text, p_mensaje text) returns text
language sql immutable set search_path = ''
as $$
  select case p_estado
    when '23505' then 'Ya existe un registro igual (en el archivo o en SIGI)'
    when '23514' then 'Valor no permitido (' || p_mensaje || ')'
    else p_mensaje
  end;
$$;

-- ---------------------------------------------------------------------------
-- Importadores por catálogo: validan e insertan cada fila; devuelven los errores [{fila, mensaje}].
-- La fila 1 del archivo es el encabezado, así que el primer registro es la fila 2.
-- ---------------------------------------------------------------------------
create function public.csv_importar_proveedores(p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb;
  i int;
  m text[];
  v_err jsonb := '[]';
  v_rnc text;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    m := public.csv_obligatorios(f, 'proveedores');
    v_rnc := nullif(regexp_replace(coalesce(f ->> 'rnc', ''), '[^0-9]', '', 'g'), '');
    if v_rnc is not null and length(v_rnc) not in (9, 11) then
      m := array_append(m, 'RNC debe tener 9 u 11 dígitos');
    end if;
    if cardinality(m) = 0 then
      begin
        insert into public.proveedores (nombre, rnc, categorias)
        values (f ->> 'nombre', v_rnc,
                coalesce((select array_agg(btrim(c)) from unnest(string_to_array(f ->> 'categorias', ';')) c where btrim(c) <> ''), '{}'));
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

create function public.csv_importar_cuentas_proveedor(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb;
  i int;
  m text[];
  v_err jsonb := '[]';
  v_prov uuid;
  v_moneda text;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    m := public.csv_obligatorios(f, 'cuentas_proveedor');
    v_prov := (select p.id from public.proveedores p where lower(p.nombre) = lower(f ->> 'proveedor') and p.activo);
    if f ->> 'proveedor' is not null and v_prov is null then
      m := array_append(m, 'El proveedor «' || (f ->> 'proveedor') || '» no existe en el maestro');
    end if;
    v_moneda := public.csv_moneda(f ->> 'moneda');
    if v_moneda is null then
      m := array_append(m, 'Moneda debe ser RD$ o US$');
    end if;
    if cardinality(m) = 0 then
      begin
        insert into public.cuentas_proveedor (empresa_id, proveedor_id, numero, descripcion, moneda)
        values (p_empresa, v_prov, f ->> 'numero', f ->> 'descripcion', v_moneda);
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

create function public.csv_importar_cuentas(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb;
  i int;
  m text[];
  v_err jsonb := '[]';
  v_tipo text;
  v_estado text;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    m := public.csv_obligatorios(f, 'cuentas_contables');
    v_tipo := upper(f ->> 'tipo');
    v_estado := coalesce(initcap(f ->> 'estado'), 'Activa');
    if f ->> 'tipo' is not null and v_tipo not in ('OPEX', 'CAPEX') then
      m := array_append(m, 'Tipo debe ser OPEX o CAPEX');
    end if;
    if v_estado not in ('Activa', 'Nueva', 'Inactiva') then
      m := array_append(m, 'Estado debe ser Activa, Nueva o Inactiva');
    end if;
    if f ->> 'centro_de_costo' !~ '^[0-9]{3}$' then
      m := array_append(m, 'Centro de costo debe tener 3 dígitos');
    end if;
    if cardinality(m) = 0 then
      begin
        insert into public.cuentas_contables (empresa_id, centro_costo_codigo, codigo, descripcion, tipo, categoria, estado)
        values (p_empresa, f ->> 'centro_de_costo', f ->> 'codigo', f ->> 'descripcion', v_tipo, f ->> 'categoria', v_estado);
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

create function public.csv_importar_telecom(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb;
  i int;
  m text[];
  v_err jsonb := '[]';
  v_tipo text;
  v_prov uuid;
  v_cta uuid;
  v_monto numeric;
  v_moneda text;
  v_tasa numeric;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    m := public.csv_obligatorios(f, 'servicios_telecom');

    v_tipo := (select t from unnest(array['Internet', 'Telefonía', 'Metro Ethernet', 'Internet Móvil']) t
               where public.csv_clave(t) = public.csv_clave(f ->> 'tipo'));
    if f ->> 'tipo' is not null and v_tipo is null then
      m := array_append(m, 'Tipo debe ser Internet, Telefonía, Metro Ethernet o Internet Móvil');
    end if;

    v_prov := (select p.id from public.proveedores p where lower(p.nombre) = lower(f ->> 'proveedor') and p.activo);
    if f ->> 'proveedor' is not null and v_prov is null then
      m := array_append(m, 'El proveedor «' || (f ->> 'proveedor') || '» no existe en el maestro');
    end if;

    v_cta := null;
    if f ->> 'cuenta_proveedor' is not null and v_prov is not null then
      v_cta := (select c.id from public.cuentas_proveedor c
                where c.empresa_id = p_empresa and c.proveedor_id = v_prov and c.numero = f ->> 'cuenta_proveedor' and c.activo);
      if v_cta is null then
        m := array_append(m, 'La cuenta «' || (f ->> 'cuenta_proveedor') || '» no está registrada para ese proveedor en esta empresa');
      end if;
    end if;

    v_monto := public.csv_numero(f ->> 'monto');
    if f ->> 'monto' is not null and (v_monto is null or v_monto < 0) then
      m := array_append(m, 'Monto inválido: ' || (f ->> 'monto'));
    end if;

    v_moneda := public.csv_moneda(f ->> 'moneda');
    v_tasa := public.tasa_vigente(v_moneda, current_date);
    if v_moneda is null then
      m := array_append(m, 'Moneda debe ser RD$ o US$');
    elsif v_tasa is null then
      m := array_append(m, 'No hay tasa de cambio US$ registrada');
    end if;

    -- Evita duplicar servicios al reimportar un archivo corregido (su hash ya es otro).
    -- Incluye las filas insertadas antes en el mismo archivo.
    if exists (
      select 1 from public.servicios_telecom s
      where s.empresa_id = p_empresa and s.activo and (
        (f ->> 'no_circuito' is not null and s.circuito = f ->> 'no_circuito')
        or (f ->> 'no_circuito' is null and s.circuito is null and lower(s.sucursal) = lower(f ->> 'sucursal')
            and s.proveedor_id = v_prov and s.tipo = v_tipo and lower(s.detalle) = lower(f ->> 'detalle'))
      )
    ) then
      m := array_append(m, 'El servicio ya está registrado (mismo circuito, o misma sucursal, proveedor, tipo y detalle)');
    end if;

    if cardinality(m) = 0 then
      begin
        insert into public.servicios_telecom (empresa_id, sucursal, ciudad, proveedor_id, cuenta_proveedor_id, tipo, detalle,
                                              velocidad, moneda, monto, tasa, circuito, cuenta_contable, estatus, comentarios)
        values (p_empresa, f ->> 'sucursal', f ->> 'ubicacion', v_prov, v_cta, v_tipo, f ->> 'detalle',
                f ->> 'velocidad', v_moneda, v_monto, v_tasa, f ->> 'no_circuito', f ->> 'cuenta_contable',
                coalesce(f ->> 'estatus', 'Activo'), f ->> 'comentarios');
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

create function public.csv_importar_flotas(p_empresa uuid, p_filas jsonb) returns jsonb
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
        insert into public.lineas_flota (empresa_id, numero, sim, area, departamento, usuario, datos, cantidad, costo_mensual,
                                         estado, proveedor_id, cuenta_proveedor_id, fecha_alta, fecha_cambiazo)
        values (p_empresa, f ->> 'numero', f ->> 'tarjeta_sim', f ->> 'area', f ->> 'departamento', f ->> 'nombre', v_datos,
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

create function public.csv_importar_partidas(p_empresa uuid, p_version uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb;
  i int;
  m text[];
  v_err jsonb := '[]';
  v_clave text;
  v_dist text;
  v_monto numeric;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    m := public.csv_obligatorios(f, 'partidas');

    -- «Uniforme», «Trimestral» o «Puntual · mar» (también acepta «Puntual marzo»).
    v_clave := public.csv_clave(f ->> 'distribucion');
    v_dist := case
      when v_clave = 'uniforme' then 'Uniforme'
      when v_clave = 'trimestral' then 'Trimestral'
      when v_clave ~ '^puntual_(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)' then
        'Puntual · ' || substring(v_clave from '^puntual_(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)')
    end;
    if f ->> 'distribucion' is not null and v_dist is null then
      m := array_append(m, 'Distribución debe ser Uniforme, Trimestral o Puntual · mes (ej. Puntual · mar)');
    end if;

    v_monto := public.csv_numero(f ->> 'monto');
    if f ->> 'monto' is not null and (v_monto is null or v_monto < 0) then
      m := array_append(m, 'Monto inválido: ' || (f ->> 'monto'));
    end if;

    if cardinality(m) = 0 then
      begin
        insert into public.partidas (empresa_id, version_id, codigo, nombre, categoria, centro_costo_codigo, cuenta_contable, distribucion, monto)
        values (p_empresa, p_version, f ->> 'codigo', f ->> 'nombre', f ->> 'categoria', f ->> 'centro_de_costo',
                f ->> 'cuenta_contable', v_dist, v_monto);
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

-- Primeras 10 filas tal como quedaron guardadas en esta transacción (fechas, montos y estados ya
-- convertidos), para que el usuario vea en la vista previa lo que se va a guardar, no el texto del archivo.
-- now() es fijo durante la transacción y trg_control lo pone en creado_en.
create function public.csv_muestra(p_catalogo text) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v jsonb;
begin
  execute format(
    'select coalesce(jsonb_agg(x.m), ''[]'') from (
       select to_jsonb(t) - array[''id'', ''empresa_id'', ''version_id'', ''proveedor_id'', ''cuenta_proveedor_id'', ''activo'',
                                  ''creado_en'', ''creado_por'', ''baja_en'', ''baja_por'', ''baja_motivo''] as m
       from public.%I t
       where t.creado_en = now() and t.creado_por is not distinct from auth.uid()
       order by t.ctid
       limit 10) x', p_catalogo)
  into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Punto de entrada: permisos, encabezado, archivo repetido, vista previa y confirmación.
-- Devuelve {filas, errores: [{fila, mensaje}], importado}.
-- ---------------------------------------------------------------------------
create function public.importar_csv(
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
  if p_catalogo not in ('proveedores', 'cuentas_proveedor', 'cuentas_contables', 'servicios_telecom', 'lineas_flota', 'partidas') then
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

  if p_catalogo in ('proveedores', 'cuentas_proveedor', 'cuentas_contables') then
    if not public.es_admin() then
      raise exception 'Solo el Administrador importa proveedores y cuentas contables.';
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

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'csv_clave(text)', 'csv_numero(text)', 'csv_fecha(text)', 'csv_moneda(text)', 'csv_obligatorios(jsonb, text)',
    'csv_mensaje(text, text)', 'csv_muestra(text)', 'csv_importar_proveedores(jsonb)', 'csv_importar_cuentas_proveedor(uuid, jsonb)', 'csv_importar_cuentas(uuid, jsonb)',
    'csv_importar_telecom(uuid, jsonb)', 'csv_importar_flotas(uuid, jsonb)', 'csv_importar_partidas(uuid, uuid, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;
end;
$$;
revoke execute on function public.csv_plantilla(text) from public, anon;
revoke execute on function public.importar_csv(text, uuid, text, text, jsonb, boolean, uuid) from public, anon;
grant execute on function public.csv_plantilla(text) to authenticated;
grant execute on function public.importar_csv(text, uuid, text, text, jsonb, boolean, uuid) to authenticated;
