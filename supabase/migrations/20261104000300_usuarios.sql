-- Administración de usuarios y roles (fase 2).

-- Lista de usuarios para el Administrador (auth.users no es visible desde el cliente).
create function public.listar_usuarios()
returns table (id uuid, email text, creado_en timestamptz, ultimo_acceso timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el Administrador puede ver los usuarios.';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at
    from auth.users u
    order by u.email;
end;
$$;

-- Asigna el rol de un usuario en una empresa (o el rol global de Administrador con p_empresa nulo).
-- p_rol nulo quita el acceso. Un usuario tiene como máximo un rol vigente por empresa.
-- Corre con los permisos de quien llama: RLS y la bitácora aplican igual que en una edición manual.
create function public.asignar_rol(p_usuario uuid, p_empresa uuid, p_rol text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el Administrador asigna roles.';
  end if;
  if (p_rol = 'Administrador' and p_empresa is not null) or (p_rol in ('Captura', 'Consulta') and p_empresa is null) then
    raise exception 'El rol Administrador es global; Captura y Consulta requieren una empresa.';
  end if;
  if p_usuario = auth.uid() and p_empresa is null and p_rol is null then
    raise exception 'No puede quitarse su propio rol de Administrador.';
  end if;

  update public.membresias
     set activo = false, baja_motivo = 'Cambio de rol'
   where usuario_id = p_usuario
     and empresa_id is not distinct from p_empresa
     and activo
     and rol is distinct from p_rol;

  if p_rol is null then
    return;
  end if;

  -- Reactiva la membresía anterior si existe; así no se duplica y el historial queda en la bitácora.
  update public.membresias
     set activo = true
   where usuario_id = p_usuario and empresa_id is not distinct from p_empresa and rol = p_rol and not activo;
  if not found then
    insert into public.membresias (usuario_id, empresa_id, rol)
    values (p_usuario, p_empresa, p_rol)
    on conflict do nothing;
  end if;
end;
$$;

revoke execute on function public.listar_usuarios() from public, anon;
revoke execute on function public.asignar_rol(uuid, uuid, text) from public, anon;
grant execute on function public.listar_usuarios() to authenticated;
grant execute on function public.asignar_rol(uuid, uuid, text) to authenticated;
