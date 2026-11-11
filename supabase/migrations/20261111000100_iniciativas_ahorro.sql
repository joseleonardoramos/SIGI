-- Iniciativas de ahorro (diseño de Ahorros): cada una con línea base y costo nuevo anualizados,
-- palanca, fecha efectiva y estado. «Realizado» = reflejado en factura o contrato firmado;
-- los demás estados (salvo «Descartada») cuentan como en gestión. Nada se borra.
create table iniciativas_ahorro (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id),
  codigo text not null,
  nombre text not null check (btrim(nombre) <> ''),
  modulo text not null check (modulo in ('Telecom', 'Flotas', 'Software', 'Partida', 'Otro')),
  palanca text not null check (palanca in ('Precio', 'Cantidad', 'Arquitectura', 'Plan / tarifa', 'Conciliación', 'Otra')),
  linea_base numeric(18, 2) not null check (linea_base >= 0), -- costo anual antes, en moneda de reporte
  costo_nuevo numeric(18, 2) not null check (costo_nuevo >= 0), -- costo anual después
  fecha_efectiva date not null,
  estado text not null default 'Propuesta' check (estado in ('Propuesta', 'En validación', 'En trámite', 'En negociación', 'Realizado', 'Descartada')),
  evidencia text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (empresa_id, codigo),
  constraint iniciativas_ahorro_ahorra check (costo_nuevo <= linea_base)
);

alter table iniciativas_ahorro enable row level security;
create trigger a_control before insert or update on iniciativas_ahorro for each row execute function public.trg_control();
create trigger z_bitacora after insert or update on iniciativas_ahorro for each row execute function public.trg_bitacora();
create trigger sin_borrado before delete on iniciativas_ahorro for each row execute function public.trg_sin_borrado();
create trigger sin_vaciar before truncate on iniciativas_ahorro for each statement execute function public.trg_sin_borrado();
-- Como los demás registros operativos: la leen los de la empresa y la registran Captura y Administrador.
create policy iniciativas_leer on iniciativas_ahorro for select to authenticated using (public.puede_leer(empresa_id));
create policy iniciativas_crear on iniciativas_ahorro for insert to authenticated with check (public.puede_escribir(empresa_id));
create policy iniciativas_editar on iniciativas_ahorro for update to authenticated using (public.puede_escribir(empresa_id)) with check (public.puede_escribir(empresa_id));
revoke all on iniciativas_ahorro from anon;
revoke delete, truncate on iniciativas_ahorro from authenticated;
