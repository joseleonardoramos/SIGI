-- Una empresa dada de baja queda de solo lectura para Captura; su historial se puede seguir consultando.
-- El Administrador conserva el acceso para corregir o reactivar.
create or replace function public.puede_escribir(p_empresa uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.es_admin() or exists (
    select 1
    from public.membresias m
    join public.empresas e on e.id = m.empresa_id
    where m.usuario_id = auth.uid() and m.activo and m.empresa_id = p_empresa and m.rol = 'Captura' and e.activo
  );
$$;
