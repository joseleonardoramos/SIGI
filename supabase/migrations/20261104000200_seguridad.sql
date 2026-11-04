-- Seguridad de SIGI: roles por empresa, RLS (denegar por defecto), historial y sin borrado físico.
--   Administrador: global (membresía sin empresa). Todo, incluidas bajas, empresas, roles y la marca de Dirección.
--   Captura: lee y registra operación en sus empresas; ve personal y ausencias. No da de baja.
--   Consulta: solo lee la operación de sus empresas; no ve personal ni ausencias.

-- ---------------------------------------------------------------------------
-- Funciones de permiso. SECURITY DEFINER para leer membresías sin recursión de RLS.
-- ---------------------------------------------------------------------------
create function public.es_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.membresias m
    where m.usuario_id = auth.uid() and m.activo and m.rol = 'Administrador'
  );
$$;

create function public.puede_leer(p_empresa uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.es_admin() or exists (
    select 1 from public.membresias m
    where m.usuario_id = auth.uid() and m.activo and m.empresa_id = p_empresa
  );
$$;

create function public.puede_escribir(p_empresa uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.es_admin() or exists (
    select 1 from public.membresias m
    where m.usuario_id = auth.uid() and m.activo and m.empresa_id = p_empresa and m.rol = 'Captura'
  );
$$;

create function public.tiene_acceso() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.membresias m where m.usuario_id = auth.uid() and m.activo);
$$;

-- ---------------------------------------------------------------------------
-- Triggers genéricos.
-- ---------------------------------------------------------------------------

-- Autoría, empresa inmutable y bajas solo por el Administrador, con motivo.
create function public.trg_control() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_en := now();
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    -- Todo registro nace activo: una baja solo existe si el Administrador la hace después.
    new.activo := true;
    new.baja_en := null;
    new.baja_por := null;
    new.baja_motivo := null;
    return new;
  end if;

  if to_jsonb(new) -> 'empresa_id' is distinct from to_jsonb(old) -> 'empresa_id' then
    raise exception 'No se puede cambiar la empresa de un registro.';
  end if;
  new.creado_en := old.creado_en;
  new.creado_por := old.creado_por;

  if new.activo is distinct from old.activo then
    -- auth.uid() nulo = proceso del servidor (migraciones, cargas administrativas).
    if auth.uid() is not null and not public.es_admin() then
      raise exception 'Solo el Administrador puede dar de baja o reactivar registros.';
    end if;
    if not new.activo then
      if coalesce(btrim(new.baja_motivo), '') = '' then
        raise exception 'La baja requiere un motivo.';
      end if;
      new.baja_en := now();
      new.baja_por := auth.uid();
    else
      new.baja_en := null;
      new.baja_por := null;
      new.baja_motivo := null;
    end if;
  else
    new.baja_en := old.baja_en;
    new.baja_por := old.baja_por;
    new.baja_motivo := old.baja_motivo;
  end if;
  return new;
end;
$$;

-- Bitácora: guarda el valor anterior y el nuevo de cada alta y edición.
create function public.trg_bitacora() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return null;
  end if;
  insert into public.bitacora (tabla, registro_id, empresa_id, accion, antes, despues, usuario_id)
  values (
    tg_table_name,
    to_jsonb(new) ->> 'id',
    coalesce((to_jsonb(new) ->> 'empresa_id')::uuid, case when tg_table_name = 'empresas' then (to_jsonb(new) ->> 'id')::uuid end),
    tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new),
    auth.uid()
  );
  return null;
end;
$$;

-- Nada se borra ni se reescribe donde el historial es de solo agregar.
create function public.trg_sin_borrado() returns trigger
language plpgsql
as $$
begin
  raise exception 'SIGI no borra registros: use la baja (activo = false).';
end;
$$;

create function public.trg_solo_agregar() returns trigger
language plpgsql
as $$
begin
  raise exception 'Este historial no se puede modificar.';
end;
$$;

-- Tablas con columnas estándar (activo, creado_*, baja_*).
do $$
declare
  t text;
begin
  foreach t in array array[
    'empresas', 'membresias', 'centros_costo', 'cuentas_contables', 'proveedores', 'cuentas_proveedor',
    'servicios_telecom', 'lineas_flota', 'productos_software', 'presupuestos_versiones', 'partidas',
    'gastos', 'gasto_pasos', 'evidencias', 'personas', 'ausencias'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger a_control before insert or update on public.%I for each row execute function public.trg_control()', t);
    execute format('create trigger z_bitacora after insert or update on public.%I for each row execute function public.trg_bitacora()', t);
    execute format('create trigger sin_borrado before delete on public.%I for each row execute function public.trg_sin_borrado()', t);
    execute format('create trigger sin_vaciar before truncate on public.%I for each statement execute function public.trg_sin_borrado()', t);
  end loop;

  -- Historiales de solo agregar.
  foreach t in array array['bitacora', 'marcas_direccion'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger solo_agregar before update or delete on public.%I for each row execute function public.trg_solo_agregar()', t);
    execute format('create trigger sin_vaciar before truncate on public.%I for each statement execute function public.trg_solo_agregar()', t);
  end loop;
end;
$$;

-- La marca de Dirección registra quién y cuándo, sin importar lo que envíe el cliente.
create function public.trg_marca_autor() returns trigger
language plpgsql
as $$
begin
  new.marcado_por := coalesce(auth.uid(), new.marcado_por);
  new.marcado_en := now();
  return new;
end;
$$;
create trigger a_autor before insert on public.marcas_direccion for each row execute function public.trg_marca_autor();

-- Una persona dada de baja no acepta ausencias nuevas; su historial se conserva.
create function public.trg_ausencia_persona_activa() returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.personas p where p.id = new.persona_id and p.activo) then
    raise exception 'La persona está dada de baja o no existe; no acepta ausencias nuevas.';
  end if;
  return new;
end;
$$;
create trigger b_persona_activa before insert on public.ausencias for each row execute function public.trg_ausencia_persona_activa();

-- ---------------------------------------------------------------------------
-- Integridad entre empresas: un registro solo puede apuntar a padres de su misma empresa.
-- ---------------------------------------------------------------------------
alter table cuentas_proveedor add unique (id, empresa_id);
alter table presupuestos_versiones add unique (id, empresa_id);
alter table partidas add unique (id, empresa_id);
alter table gastos add unique (id, empresa_id);
alter table gasto_pasos add unique (id, empresa_id);
alter table personas add unique (id, empresa_id);

alter table servicios_telecom add foreign key (cuenta_proveedor_id, empresa_id) references cuentas_proveedor (id, empresa_id);
alter table lineas_flota add foreign key (cuenta_proveedor_id, empresa_id) references cuentas_proveedor (id, empresa_id);
alter table productos_software add foreign key (cuenta_proveedor_id, empresa_id) references cuentas_proveedor (id, empresa_id);
alter table gastos add foreign key (cuenta_proveedor_id, empresa_id) references cuentas_proveedor (id, empresa_id);
alter table partidas add foreign key (version_id, empresa_id) references presupuestos_versiones (id, empresa_id);
alter table gastos add foreign key (partida_id, empresa_id) references partidas (id, empresa_id);
alter table gasto_pasos add foreign key (gasto_id, empresa_id) references gastos (id, empresa_id);
alter table evidencias add foreign key (paso_id, empresa_id) references gasto_pasos (id, empresa_id);
alter table ausencias add foreign key (persona_id, empresa_id) references personas (id, empresa_id);

-- ---------------------------------------------------------------------------
-- Privilegios: sin acceso anónimo; nadie borra ni vacía; el historial lo escriben solo los triggers.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke delete, truncate on all tables in schema public from authenticated;
revoke insert, update on public.bitacora from authenticated;
revoke update on public.marcas_direccion from authenticated;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- Políticas RLS. Sin política = denegado.
-- ---------------------------------------------------------------------------

-- Empresas: cada quien ve las suyas; solo el Administrador crea y edita.
create policy empresas_leer on empresas for select to authenticated using (public.puede_leer(id));
create policy empresas_crear on empresas for insert to authenticated with check (public.es_admin());
create policy empresas_editar on empresas for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- Membresías: cada quien ve las suyas; solo el Administrador asigna roles.
create policy membresias_leer on membresias for select to authenticated using (usuario_id = auth.uid() or public.es_admin());
create policy membresias_crear on membresias for insert to authenticated with check (public.es_admin());
create policy membresias_editar on membresias for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- Proveedores: maestro global; lo ve cualquier usuario con acceso; solo el Administrador lo mantiene.
create policy proveedores_leer on proveedores for select to authenticated using (public.tiene_acceso());
create policy proveedores_crear on proveedores for insert to authenticated with check (public.es_admin());
create policy proveedores_editar on proveedores for update to authenticated using (public.es_admin()) with check (public.es_admin());

do $$
declare
  t text;
begin
  -- Catálogos por empresa: leen todos los de la empresa; mantiene el Administrador.
  foreach t in array array['centros_costo', 'cuentas_contables', 'cuentas_proveedor'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.puede_leer(empresa_id))', t || '_leer', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.es_admin())', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.es_admin()) with check (public.es_admin())', t || '_editar', t);
  end loop;

  -- Operación: leen todos los de la empresa; registran Administrador y Captura.
  foreach t in array array[
    'servicios_telecom', 'lineas_flota', 'productos_software', 'presupuestos_versiones', 'partidas',
    'gastos', 'gasto_pasos', 'evidencias'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.puede_leer(empresa_id))', t || '_leer', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.puede_escribir(empresa_id))', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.puede_escribir(empresa_id)) with check (public.puede_escribir(empresa_id))', t || '_editar', t);
  end loop;

  -- Personal y ausencias: datos personales; solo Administrador y Captura de la empresa.
  foreach t in array array['personas', 'ausencias'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.puede_escribir(empresa_id))', t || '_leer', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.puede_escribir(empresa_id))', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.puede_escribir(empresa_id)) with check (public.puede_escribir(empresa_id))', t || '_editar', t);
  end loop;
end;
$$;

-- Bitácora: incluye datos de personal, así que la ven Administrador y Captura de la empresa.
create policy bitacora_leer on bitacora for select to authenticated using (public.es_admin() or public.puede_escribir(empresa_id));

-- Marca "Aprobado por Dirección": la ven todos los de la empresa; solo la escribe el Administrador.
create policy marcas_leer on marcas_direccion for select to authenticated using (public.puede_leer(empresa_id));
create policy marcas_crear on marcas_direccion for insert to authenticated with check (public.es_admin());

-- Marca vigente por entidad (la más reciente).
create view marcas_vigentes with (security_invoker = true) as
select distinct on (empresa_id, entidad, entidad_id)
  empresa_id, entidad, entidad_id, marcado, marcado_por, marcado_en
from marcas_direccion
order by empresa_id, entidad, entidad_id, marcado_en desc, id;

-- ---------------------------------------------------------------------------
-- Evidencias en Storage privado. Ruta: <empresa_id>/<archivo>. Sin edición ni borrado.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy evidencias_leer on storage.objects for select to authenticated
  using (bucket_id = 'evidencias' and public.puede_leer(((storage.foldername(name))[1])::uuid));
create policy evidencias_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'evidencias' and public.puede_escribir(((storage.foldername(name))[1])::uuid));
