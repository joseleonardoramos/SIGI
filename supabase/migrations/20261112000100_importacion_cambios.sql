-- Importación CSV: carga solo lo nuevo y los cambios.
-- Cada fila se compara con lo que ya existe (por su clave de catálogo):
--   nueva       → se inserta
--   cambio      → se actualizan solo las columnas que cambian (la bitácora guarda el valor anterior)
--   igual       → ya existe sin cambios: se omite
--   vacia       → fila sin ningún dato: se omite y se informa su número
--   error       → no se guarda nada del archivo (igual que antes)
-- Una celda opcional vacía NO borra lo guardado: se informa como «sin dato, se conserva».
-- La vista previa devuelve todas las filas con su resultado; confirmar repite lo mismo y guarda.

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------

-- Fila sin ningún valor (las celdas vacías ya llegan como nulo).
create function public.csv_vacia(f jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select not exists (select 1 from jsonb_each_text(f) e where e.value is not null);
$$;

-- Columnas opcionales que el archivo trae pero que en esta fila vienen vacías
-- (las que el archivo no trae no se mencionan: no se cargan en ninguna fila).
create function public.csv_vacios(f jsonb, p_catalogo text) returns text[]
language sql stable set search_path = ''
as $$
  select coalesce(array_agg(c.columna), '{}')
  from public.csv_plantilla(p_catalogo) c
  where not c.obligatoria and f ? public.csv_clave(c.columna) and f ->> public.csv_clave(c.columna) is null;
$$;

-- Nombre de una columna en palabras del usuario.
create function public.csv_etiqueta(p_columna text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce((jsonb_build_object(
    'sucursal', 'Sucursal', 'ciudad', 'Ubicación', 'proveedor_id', 'Proveedor', 'cuenta_proveedor_id', 'Cuenta proveedor',
    'cuenta_contable', 'Cuenta contable', 'circuito', 'No. circuito', 'estatus', 'Estatus', 'detalle', 'Detalle', 'tipo', 'Tipo',
    'velocidad', 'Velocidad', 'moneda', 'Moneda', 'monto', 'Monto', 'comentarios', 'Comentarios', 'numero', 'Número',
    'sim', 'Tarjeta SIM', 'usuario', 'Nombre', 'area_id', 'Área', 'departamento_id', 'Departamento', 'datos', 'Datos',
    'cantidad', 'Cantidad', 'costo_mensual', 'Precio', 'estado', 'Estado', 'fecha_alta', 'Fecha creación',
    'fecha_cambiazo', 'Fecha cambiazo', 'nombre', 'Nombre', 'rnc', 'RNC', 'categorias', 'Categorías',
    'descripcion', 'Descripción', 'categoria', 'Categoría', 'centro_costo_codigo', 'Centro de costo', 'codigo', 'Código',
    'distribucion', 'Distribución') ->> p_columna), p_columna);
$$;

-- Valor de una columna como texto para mostrar (las referencias por su nombre, no por su id).
create function public.csv_valor(p_columna text, v jsonb) returns text
language sql stable set search_path = ''
as $$
  select case
    when v is null or v = 'null'::jsonb then null
    when p_columna = 'area_id' then (select a.nombre from public.areas a where a.id = (v #>> '{}')::uuid)
    when p_columna = 'departamento_id' then (select d.nombre from public.departamentos d where d.id = (v #>> '{}')::uuid)
    when p_columna = 'proveedor_id' then (select p.nombre from public.proveedores p where p.id = (v #>> '{}')::uuid)
    when p_columna = 'cuenta_proveedor_id' then (select c.numero from public.cuentas_proveedor c where c.id = (v #>> '{}')::uuid)
    when p_columna = 'datos' then case when v = 'true'::jsonb then 'SI' else 'NO' end
    when jsonb_typeof(v) = 'array' then (select string_agg(x, '; ') from jsonb_array_elements_text(v) x)
    else v #>> '{}'
  end;
$$;

-- Guarda una fila del archivo.
--   p_id nulo  → inserta p_defectos + p_nuevo.
--   p_id dado  → compara p_nuevo con lo guardado y actualiza solo lo que cambia.
-- p_nuevo lleva solo lo que trae el archivo (los nulos se ignoran: una celda vacía no borra);
-- p_defectos son los valores de una fila nueva que el archivo no trae (empresa, estado inicial…).
-- Devuelve {accion: nueva|cambio|igual, cambios: [{campo, antes, despues}], valores: {campo: valor}}.
create function public.csv_guardar(p_tabla text, p_id uuid, p_nuevo jsonb, p_defectos jsonb default '{}')
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v jsonb;
  v_actual jsonb;
  v_cambios jsonb;
  v_cols text;
begin
  if p_id is null then
    v := p_defectos || jsonb_strip_nulls(p_nuevo);
    select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(v) k;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', p_tabla, v_cols, v_cols, p_tabla)
      using v;
    return jsonb_build_object('accion', 'nueva', 'valores', (
      select jsonb_object_agg(public.csv_etiqueta(e.key), public.csv_valor(e.key, e.value))
      from jsonb_each(v) e where e.key not in ('empresa_id', 'version_id', 'tasa')));
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_tabla) into v_actual using p_id;
  select coalesce(jsonb_agg(jsonb_build_object('columna', e.key, 'campo', public.csv_etiqueta(e.key),
                                               'antes', public.csv_valor(e.key, v_actual -> e.key),
                                               'despues', public.csv_valor(e.key, e.value)) order by e.key), '[]')
    into v_cambios
  from jsonb_each(jsonb_strip_nulls(p_nuevo)) e
  where (v_actual -> e.key) is distinct from e.value;   -- jsonb compara números por su valor: 1500 = 1500.00

  if jsonb_array_length(v_cambios) = 0 then
    return jsonb_build_object('accion', 'igual');
  end if;
  select string_agg(format('%I', c ->> 'columna'), ', ') into v_cols from jsonb_array_elements(v_cambios) c;
  execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.id = $2',
                 p_tabla, v_cols, v_cols, p_tabla)
    using p_nuevo, p_id;
  return jsonb_build_object('accion', 'cambio', 'cambios', (select jsonb_agg(c - 'columna') from jsonb_array_elements(v_cambios) c));
end;
$$;

-- Resultado de una fila para la vista previa. La fila 1 del archivo es el encabezado.
create function public.csv_fila(i bigint, p_accion text, p_clave text default null, p_mensaje text default null,
                                r jsonb default null, p_vacios text[] default null)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'fila', i + 1, 'accion', p_accion, 'clave', p_clave, 'mensaje', p_mensaje,
    'cambios', r -> 'cambios', 'valores', r -> 'valores',
    'vacios', case when cardinality(p_vacios) > 0 then to_jsonb(p_vacios) end)));
$$;

-- ---------------------------------------------------------------------------
-- Importadores: cada uno valida, busca la fila existente por su clave y la guarda con csv_guardar.
-- Devuelven una entrada por fila del archivo (csv_fila).
-- ---------------------------------------------------------------------------

-- Proveedores (maestro común). Clave: el nombre, sin distinguir mayúsculas.
create or replace function public.csv_importar_proveedores(p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb; i bigint; m text[]; v_res jsonb := '[]'; v_vistas jsonb := '{}'; v_clave text; r jsonb;
  v_rnc text; v_id uuid; v_activo boolean;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    if public.csv_vacia(f) then v_res := v_res || public.csv_fila(i, 'vacia'); continue; end if;
    m := public.csv_obligatorios(f, 'proveedores');
    v_rnc := nullif(regexp_replace(coalesce(f ->> 'rnc', ''), '[^0-9]', '', 'g'), '');
    if v_rnc is not null and length(v_rnc) not in (9, 11) then
      m := array_append(m, 'RNC debe tener 9 u 11 dígitos');
    end if;
    v_clave := f ->> 'nombre';
    if v_vistas ? lower(v_clave) then
      m := array_append(m, 'Repetido en el archivo: es el mismo proveedor de la fila ' || (v_vistas ->> lower(v_clave)));
    elsif v_clave is not null then
      v_vistas := v_vistas || jsonb_build_object(lower(v_clave), i + 1);
    end if;
    if cardinality(m) = 0 then
      select p.id, p.activo into v_id, v_activo from public.proveedores p where lower(p.nombre) = lower(v_clave);
      if v_id is not null and not v_activo then
        m := array_append(m, 'El proveedor existe pero está dado de baja: reactívelo antes de importarlo');
      else
        begin
          r := public.csv_guardar('proveedores', v_id,
            jsonb_build_object('rnc', v_rnc, 'categorias',
              (select to_jsonb(array_agg(btrim(c))) from unnest(string_to_array(f ->> 'categorias', ';')) c where btrim(c) <> '')),
            jsonb_build_object('nombre', v_clave, 'categorias', '[]'::jsonb));
        exception when others then
          m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
        end;
      end if;
    end if;
    v_res := v_res || case when cardinality(m) > 0 then public.csv_fila(i, 'error', v_clave, array_to_string(m, '; '))
                      else public.csv_fila(i, r ->> 'accion', v_clave, null, r, public.csv_vacios(f, 'proveedores')) end;
  end loop;
  return v_res;
end;
$$;

-- Cuentas de proveedor. Clave: proveedor + número.
create or replace function public.csv_importar_cuentas_proveedor(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb; i bigint; m text[]; v_res jsonb := '[]'; v_vistas jsonb := '{}'; v_clave text; r jsonb;
  v_prov uuid; v_moneda text; v_id uuid; v_activo boolean;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    if public.csv_vacia(f) then v_res := v_res || public.csv_fila(i, 'vacia'); continue; end if;
    m := public.csv_obligatorios(f, 'cuentas_proveedor');
    v_prov := (select p.id from public.proveedores p where lower(p.nombre) = lower(f ->> 'proveedor') and p.activo);
    if f ->> 'proveedor' is not null and v_prov is null then
      m := array_append(m, 'El proveedor «' || (f ->> 'proveedor') || '» no existe en el maestro');
    end if;
    v_moneda := public.csv_moneda(f ->> 'moneda');
    if v_moneda is null then
      m := array_append(m, 'Moneda debe ser RD$ o US$');
    end if;
    v_clave := concat_ws(' · ', f ->> 'proveedor', f ->> 'numero');
    if v_vistas ? lower(v_clave) then
      m := array_append(m, 'Repetida en el archivo: es la misma cuenta de la fila ' || (v_vistas ->> lower(v_clave)));
    else
      v_vistas := v_vistas || jsonb_build_object(lower(v_clave), i + 1);
    end if;
    if cardinality(m) = 0 then
      select c.id, c.activo into v_id, v_activo from public.cuentas_proveedor c
      where c.empresa_id = p_empresa and c.proveedor_id = v_prov and c.numero = f ->> 'numero';
      if v_id is not null and not v_activo then
        m := array_append(m, 'La cuenta existe pero está dada de baja: reactívela antes de importarla');
      else
        begin
          r := public.csv_guardar('cuentas_proveedor', v_id,
            jsonb_build_object('proveedor_id', v_prov, 'numero', f ->> 'numero', 'descripcion', f ->> 'descripcion',
                               'moneda', case when f ->> 'moneda' is not null then v_moneda end),
            jsonb_build_object('empresa_id', p_empresa, 'moneda', 'RD$'));
        exception when others then
          m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
        end;
      end if;
    end if;
    v_res := v_res || case when cardinality(m) > 0 then public.csv_fila(i, 'error', v_clave, array_to_string(m, '; '))
                      else public.csv_fila(i, r ->> 'accion', v_clave, null, r, public.csv_vacios(f, 'cuentas_proveedor')) end;
  end loop;
  return v_res;
end;
$$;

-- Cuentas contables. Clave: código.
create or replace function public.csv_importar_cuentas(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb; i bigint; m text[]; v_res jsonb := '[]'; v_vistas jsonb := '{}'; v_clave text; r jsonb;
  v_tipo text; v_estado text; v_id uuid; v_activo boolean;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    if public.csv_vacia(f) then v_res := v_res || public.csv_fila(i, 'vacia'); continue; end if;
    m := public.csv_obligatorios(f, 'cuentas_contables');
    v_tipo := upper(f ->> 'tipo');
    v_estado := initcap(f ->> 'estado');
    if f ->> 'tipo' is not null and v_tipo not in ('OPEX', 'CAPEX') then
      m := array_append(m, 'Tipo debe ser OPEX o CAPEX');
    end if;
    if v_estado is not null and v_estado not in ('Activa', 'Nueva', 'Inactiva') then
      m := array_append(m, 'Estado debe ser Activa, Nueva o Inactiva');
    end if;
    if f ->> 'centro_de_costo' !~ '^[0-9]{3}$' then
      m := array_append(m, 'Centro de costo debe tener 3 dígitos');
    end if;
    v_clave := f ->> 'codigo';
    if v_vistas ? lower(v_clave) then
      m := array_append(m, 'Repetida en el archivo: es la misma cuenta de la fila ' || (v_vistas ->> lower(v_clave)));
    elsif v_clave is not null then
      v_vistas := v_vistas || jsonb_build_object(lower(v_clave), i + 1);
    end if;
    if cardinality(m) = 0 then
      select c.id, c.activo into v_id, v_activo from public.cuentas_contables c where c.empresa_id = p_empresa and c.codigo = v_clave;
      if v_id is not null and not v_activo then
        m := array_append(m, 'La cuenta existe pero está dada de baja: reactívela antes de importarla');
      else
        begin
          r := public.csv_guardar('cuentas_contables', v_id,
            jsonb_build_object('codigo', v_clave, 'descripcion', f ->> 'descripcion', 'tipo', v_tipo, 'categoria', f ->> 'categoria',
                               'centro_costo_codigo', f ->> 'centro_de_costo', 'estado', v_estado),
            jsonb_build_object('empresa_id', p_empresa, 'estado', 'Activa'));
        exception when others then
          m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
        end;
      end if;
    end if;
    v_res := v_res || case when cardinality(m) > 0 then public.csv_fila(i, 'error', v_clave, array_to_string(m, '; '))
                      else public.csv_fila(i, r ->> 'accion', v_clave, null, r, public.csv_vacios(f, 'cuentas_contables')) end;
  end loop;
  return v_res;
end;
$$;

-- Áreas y departamentos. Clave: área + departamento. Solo se agregan (no tienen datos que cambiar).
create or replace function public.csv_importar_departamentos(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb; i bigint; m text[]; v_res jsonb := '[]'; v_vistas jsonb := '{}'; v_clave text; r jsonb;
  v_area uuid; v_depto uuid;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    if public.csv_vacia(f) then v_res := v_res || public.csv_fila(i, 'vacia'); continue; end if;
    m := public.csv_obligatorios(f, 'departamentos');
    v_clave := concat_ws(' · ', f ->> 'area', f ->> 'departamento');
    if v_vistas ? lower(v_clave) then
      m := array_append(m, 'Repetido en el archivo: es el mismo departamento de la fila ' || (v_vistas ->> lower(v_clave)));
    else
      v_vistas := v_vistas || jsonb_build_object(lower(v_clave), i + 1);
    end if;
    if cardinality(m) = 0 then
      begin
        v_area := (select a.id from public.areas a where a.empresa_id = p_empresa and lower(a.nombre) = lower(f ->> 'area') and a.activo);
        v_depto := (select d.id from public.departamentos d where d.area_id = v_area and lower(d.nombre) = lower(f ->> 'departamento') and d.activo);
        if v_depto is not null then
          r := jsonb_build_object('accion', 'igual');
        else
          if v_area is null then
            insert into public.areas (empresa_id, nombre) values (p_empresa, f ->> 'area') returning id into v_area;
          end if;
          r := public.csv_guardar('departamentos', null, '{}', jsonb_build_object('empresa_id', p_empresa, 'area_id', v_area, 'nombre', f ->> 'departamento'));
        end if;
      exception when others then
        m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
      end;
    end if;
    v_res := v_res || case when cardinality(m) > 0 then public.csv_fila(i, 'error', v_clave, array_to_string(m, '; '))
                      else public.csv_fila(i, r ->> 'accion', v_clave, null, r) end;
  end loop;
  return v_res;
end;
$$;

-- Servicios de telecomunicaciones. Clave: el circuito; sin circuito, sucursal + proveedor + tipo + detalle.
create or replace function public.csv_importar_telecom(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb; i bigint; m text[]; v_res jsonb := '[]'; v_vistas jsonb := '{}'; v_clave text; r jsonb;
  v_tipo text; v_prov uuid; v_cta uuid; v_monto numeric; v_moneda text; v_tasa numeric; v_id uuid;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    if public.csv_vacia(f) then v_res := v_res || public.csv_fila(i, 'vacia'); continue; end if;
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

    v_clave := coalesce('Circuito ' || (f ->> 'no_circuito'), concat_ws(' · ', f ->> 'sucursal', f ->> 'proveedor', v_tipo, f ->> 'detalle'));
    if v_vistas ? lower(v_clave) then
      m := array_append(m, 'Repetido en el archivo: es el mismo servicio de la fila ' || (v_vistas ->> lower(v_clave)));
    else
      v_vistas := v_vistas || jsonb_build_object(lower(v_clave), i + 1);
    end if;

    if cardinality(m) = 0 then
      select s.id into v_id from public.servicios_telecom s
      where s.empresa_id = p_empresa and s.activo and (
        (f ->> 'no_circuito' is not null and s.circuito = f ->> 'no_circuito')
        or (f ->> 'no_circuito' is null and s.circuito is null and lower(s.sucursal) = lower(f ->> 'sucursal')
            and s.proveedor_id = v_prov and s.tipo = v_tipo and lower(s.detalle) = lower(f ->> 'detalle')))
      order by s.creado_en limit 1;
      begin
        -- La tasa se fija al registrar el servicio; no se cambia al reimportar.
        r := public.csv_guardar('servicios_telecom', v_id,
          jsonb_build_object('sucursal', f ->> 'sucursal', 'ciudad', f ->> 'ubicacion', 'proveedor_id', v_prov, 'cuenta_proveedor_id', v_cta,
                             'tipo', v_tipo, 'detalle', f ->> 'detalle', 'velocidad', f ->> 'velocidad', 'monto', v_monto,
                             'circuito', f ->> 'no_circuito', 'cuenta_contable', f ->> 'cuenta_contable', 'estatus', f ->> 'estatus',
                             'comentarios', f ->> 'comentarios', 'moneda', case when f ->> 'moneda' is not null then v_moneda end),
          jsonb_build_object('empresa_id', p_empresa, 'moneda', v_moneda, 'tasa', v_tasa, 'estatus', 'Activo'));
      exception when others then
        m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
      end;
    end if;
    v_res := v_res || case when cardinality(m) > 0 then public.csv_fila(i, 'error', v_clave, array_to_string(m, '; '))
                      else public.csv_fila(i, r ->> 'accion', v_clave, null, r, public.csv_vacios(f, 'servicios_telecom')) end;
  end loop;
  return v_res;
end;
$$;

-- Líneas de flota. Clave: el número (entre las líneas no canceladas).
create or replace function public.csv_importar_flotas(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb; i bigint; m text[]; v_res jsonb := '[]'; v_vistas jsonb := '{}'; v_clave text; r jsonb;
  v_n int; v_cta uuid; v_prov uuid; v_area uuid; v_depto uuid; v_estado text; v_datos boolean;
  v_alta date; v_cambiazo date; v_precio numeric; v_id uuid;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    if public.csv_vacia(f) then v_res := v_res || public.csv_fila(i, 'vacia'); continue; end if;
    m := public.csv_obligatorios(f, 'lineas_flota');

    select count(*), min(c.id::text)::uuid, min(c.proveedor_id::text)::uuid into v_n, v_cta, v_prov
    from public.cuentas_proveedor c
    where c.empresa_id = p_empresa and c.numero = f ->> 'cuenta_proveedor' and c.activo;
    if f ->> 'cuenta_proveedor' is not null and v_n = 0 then
      m := array_append(m, 'La cuenta de proveedor «' || (f ->> 'cuenta_proveedor') || '» no existe en esta empresa');
    elsif v_n > 1 then
      m := array_append(m, 'La cuenta «' || (f ->> 'cuenta_proveedor') || '» existe en varios proveedores');
    end if;

    v_area := (select a.id from public.areas a where a.empresa_id = p_empresa and lower(a.nombre) = lower(f ->> 'area') and a.activo);
    v_depto := (select d.id from public.departamentos d where d.area_id = v_area and lower(d.nombre) = lower(f ->> 'departamento') and d.activo);
    if f ->> 'area' is not null and v_area is null then
      m := array_append(m, 'El área «' || (f ->> 'area') || '» no existe en el maestro de áreas');
    elsif f ->> 'departamento' is not null and v_depto is null then
      m := array_append(m, 'El departamento «' || (f ->> 'departamento') || '» no existe en el área «' || (f ->> 'area') || '»');
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

    v_clave := f ->> 'numero';
    if v_vistas ? lower(v_clave) then
      m := array_append(m, 'Repetida en el archivo: es la misma línea de la fila ' || (v_vistas ->> lower(v_clave)));
    elsif v_clave is not null then
      v_vistas := v_vistas || jsonb_build_object(lower(v_clave), i + 1);
    end if;

    if cardinality(m) = 0 then
      select l.id into v_id from public.lineas_flota l
      where l.empresa_id = p_empresa and l.numero = v_clave and l.activo and l.estado <> 'Cancelada'
      order by l.creado_en limit 1;
      begin
        r := public.csv_guardar('lineas_flota', v_id,
          jsonb_build_object('numero', v_clave, 'sim', f ->> 'tarjeta_sim', 'area_id', v_area, 'departamento_id', v_depto,
                             'usuario', f ->> 'nombre', 'cantidad', f ->> 'cantidad', 'costo_mensual', v_precio,
                             'proveedor_id', v_prov, 'cuenta_proveedor_id', v_cta, 'fecha_cambiazo', v_cambiazo,
                             'datos', case when f ->> 'datos_si_no' is not null then v_datos end,
                             'estado', case when f ->> 'status' is not null then v_estado end,
                             'fecha_alta', v_alta),
          jsonb_build_object('empresa_id', p_empresa, 'estado', 'Sin alerta', 'datos', true, 'fecha_alta', current_date));
      exception when others then
        m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
      end;
    end if;
    v_res := v_res || case when cardinality(m) > 0 then public.csv_fila(i, 'error', v_clave, array_to_string(m, '; '))
                      else public.csv_fila(i, r ->> 'accion', v_clave, null, r, public.csv_vacios(f, 'lineas_flota')) end;
  end loop;
  return v_res;
end;
$$;

-- Partidas de presupuesto. Clave: el código dentro de la versión.
create or replace function public.csv_importar_partidas(p_empresa uuid, p_version uuid, p_filas jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  f jsonb; i bigint; m text[]; v_res jsonb := '[]'; v_vistas jsonb := '{}'; v_clave text; r jsonb;
  v_dist_clave text; v_dist text; v_monto numeric; v_id uuid; v_activo boolean;
begin
  for f, i in select x.f, x.i from jsonb_array_elements(p_filas) with ordinality as x(f, i) loop
    if public.csv_vacia(f) then v_res := v_res || public.csv_fila(i, 'vacia'); continue; end if;
    m := public.csv_obligatorios(f, 'partidas');

    -- «Uniforme», «Trimestral» o «Puntual · mar» (también acepta «Puntual marzo»).
    v_dist_clave := public.csv_clave(f ->> 'distribucion');
    v_dist := case
      when v_dist_clave = 'uniforme' then 'Uniforme'
      when v_dist_clave = 'trimestral' then 'Trimestral'
      when v_dist_clave ~ '^puntual_(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)' then
        'Puntual · ' || substring(v_dist_clave from '^puntual_(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)')
    end;
    if f ->> 'distribucion' is not null and v_dist is null then
      m := array_append(m, 'Distribución debe ser Uniforme, Trimestral o Puntual · mes (ej. Puntual · mar)');
    end if;

    v_monto := public.csv_numero(f ->> 'monto');
    if f ->> 'monto' is not null and (v_monto is null or v_monto < 0) then
      m := array_append(m, 'Monto inválido: ' || (f ->> 'monto'));
    end if;

    v_clave := f ->> 'codigo';
    if v_vistas ? lower(v_clave) then
      m := array_append(m, 'Repetida en el archivo: es la misma partida de la fila ' || (v_vistas ->> lower(v_clave)));
    elsif v_clave is not null then
      v_vistas := v_vistas || jsonb_build_object(lower(v_clave), i + 1);
    end if;

    if cardinality(m) = 0 then
      select p.id, p.activo into v_id, v_activo from public.partidas p where p.version_id = p_version and p.codigo = v_clave;
      if v_id is not null and not v_activo then
        m := array_append(m, 'La partida existe pero está dada de baja: reactívela antes de importarla');
      else
        begin
          r := public.csv_guardar('partidas', v_id,
            jsonb_build_object('codigo', v_clave, 'nombre', f ->> 'nombre', 'categoria', f ->> 'categoria',
                               'centro_costo_codigo', f ->> 'centro_de_costo', 'cuenta_contable', f ->> 'cuenta_contable',
                               'distribucion', v_dist, 'monto', v_monto),
            jsonb_build_object('empresa_id', p_empresa, 'version_id', p_version));
        exception when others then
          m := array_append(m, public.csv_mensaje(sqlstate, sqlerrm));
        end;
      end if;
    end if;
    v_res := v_res || case when cardinality(m) > 0 then public.csv_fila(i, 'error', v_clave, array_to_string(m, '; '))
                      else public.csv_fila(i, r ->> 'accion', v_clave, null, r, public.csv_vacios(f, 'partidas')) end;
  end loop;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Despachador: devuelve el detalle de todas las filas y un resumen; guarda solo si se confirma y no hay errores.
-- ---------------------------------------------------------------------------
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
  v_res jsonb := '[]';
  v_err jsonb := '[]';
  v_resumen jsonb;
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
    return jsonb_build_object('filas', v_n, 'importado', false, 'detalle', '[]'::jsonb, 'resumen', '{}'::jsonb,
      'errores', jsonb_build_array(jsonb_build_object(
        'fila', 0, 'mensaje', 'Este archivo ya se importó el ' || to_char(v_previa at time zone 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI') || '.')));
  end if;

  -- Claves normalizadas y celdas vacías como nulo.
  select coalesce(jsonb_agg(n.obj order by n.ord), '[]') into v_filas
  from (
    select a.ord, (select coalesce(jsonb_object_agg(public.csv_clave(e.k), nullif(btrim(e.v), '')), '{}') from jsonb_each_text(a.f) as e(k, v)) as obj
    from jsonb_array_elements(p_filas) with ordinality as a(f, ord)
  ) n;

  select string_agg('«' || c.columna || '»', ', ') into v_faltan
  from public.csv_plantilla(p_catalogo) c
  where c.obligatoria and not (v_filas -> 0 ? public.csv_clave(c.columna));
  if v_faltan is not null then
    return jsonb_build_object('filas', v_n, 'importado', false, 'detalle', '[]'::jsonb, 'resumen', '{}'::jsonb,
      'errores', jsonb_build_array(jsonb_build_object(
        'fila', 1, 'mensaje', 'Faltan columnas en el encabezado: ' || v_faltan || '. Descargue la plantilla.')));
  end if;

  begin
    v_res := case p_catalogo
      when 'proveedores' then public.csv_importar_proveedores(v_filas)
      when 'cuentas_proveedor' then public.csv_importar_cuentas_proveedor(p_empresa, v_filas)
      when 'cuentas_contables' then public.csv_importar_cuentas(p_empresa, v_filas)
      when 'departamentos' then public.csv_importar_departamentos(p_empresa, v_filas)
      when 'servicios_telecom' then public.csv_importar_telecom(p_empresa, v_filas)
      when 'lineas_flota' then public.csv_importar_flotas(p_empresa, v_filas)
      when 'partidas' then public.csv_importar_partidas(p_empresa, p_version, v_filas)
    end;
    -- Las variables sobreviven al deshacer.
    select coalesce(jsonb_agg(jsonb_build_object('fila', x -> 'fila', 'mensaje', x -> 'mensaje')), '[]') into v_err
    from jsonb_array_elements(v_res) x where x ->> 'accion' = 'error';
    if jsonb_array_length(v_err) > 0 or not p_confirmar then
      raise exception using errcode = 'SG001'; -- deshace todo: vista previa o archivo con errores
    end if;
    insert into public.importaciones (empresa_id, catalogo, version_id, archivo, hash, filas, contenido)
    values (p_empresa, p_catalogo, p_version, p_archivo, p_hash, v_n, p_filas);
  exception when sqlstate 'SG001' then
    null;
  end;

  select coalesce(jsonb_object_agg(a, n), '{}') into v_resumen
  from (select x ->> 'accion' as a, count(*) as n from jsonb_array_elements(v_res) x group by 1) s;

  return jsonb_build_object('filas', v_n, 'errores', v_err, 'importado', p_confirmar and jsonb_array_length(v_err) = 0,
                            'detalle', v_res, 'resumen', v_resumen);
end;
$$;

drop function public.csv_muestra(text);

-- Los ayudantes solo los usa importar_csv (security definer): nadie los llama directamente.
revoke execute on function public.csv_vacia(jsonb) from public, anon, authenticated;
revoke execute on function public.csv_vacios(jsonb, text) from public, anon, authenticated;
revoke execute on function public.csv_etiqueta(text) from public, anon, authenticated;
revoke execute on function public.csv_valor(text, jsonb) from public, anon, authenticated;
revoke execute on function public.csv_guardar(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.csv_fila(bigint, text, text, text, jsonb, text[]) from public, anon, authenticated;
