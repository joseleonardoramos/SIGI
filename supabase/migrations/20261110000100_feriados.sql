-- Feriados: días no laborables que se descuentan de los días hábiles de las ausencias.
-- Comunes a todas las empresas (feriados nacionales); solo el Administrador los registra. Nada se borra.
create table feriados (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  nombre text not null check (btrim(nombre) <> ''),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text
);
-- Un feriado activo por fecha; uno dado de baja no impide registrar otro.
create unique index feriados_fecha_unica on feriados (fecha) where activo;

alter table feriados enable row level security;
create trigger a_control before insert or update on feriados for each row execute function public.trg_control();
create trigger z_bitacora after insert or update on feriados for each row execute function public.trg_bitacora();
create trigger sin_borrado before delete on feriados for each row execute function public.trg_sin_borrado();
create trigger sin_vaciar before truncate on feriados for each statement execute function public.trg_sin_borrado();
create policy feriados_leer on feriados for select to authenticated using (public.tiene_acceso());
create policy feriados_crear on feriados for insert to authenticated with check (public.es_admin());
create policy feriados_editar on feriados for update to authenticated using (public.es_admin()) with check (public.es_admin());
revoke all on feriados from anon;
revoke delete, truncate on feriados from authenticated;
