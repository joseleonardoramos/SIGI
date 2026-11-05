-- Red contra olvidos (pgTAP): recorre todas las tablas y vistas de public.
-- Si una migración futura agrega una tabla sin RLS, con borrado o sin bitácora, esta prueba falla y la nombra.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

create temporary view t_tablas as
select c.oid, c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

select is(
  (select coalesce(string_agg(relname, ', ' order by relname), '') from t_tablas where not relrowsecurity),
  '', 'Todas las tablas tienen RLS (denegar por defecto)');

select is(
  (select coalesce(string_agg(distinct table_name, ', '), '') from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'),
  '', 'El usuario anónimo no tiene permisos sobre ninguna tabla ni vista');

select is(
  (select coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '), '') from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('DELETE', 'TRUNCATE')),
  '', 'Ningún usuario puede borrar ni vaciar tablas');

select is(
  (select coalesce(string_agg(relname, ', ' order by relname), '') from t_tablas t
   where not exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname in ('sin_borrado', 'solo_agregar'))),
  '', 'Toda tabla bloquea el borrado con un trigger (también para el servidor)');

-- Los historiales (bitácora, marcas, importaciones) son de solo agregar y no se registran a sí mismos.
select is(
  (select coalesce(string_agg(relname, ', ' order by relname), '') from t_tablas t
   where t.relname not in ('bitacora', 'marcas_direccion', 'importaciones')
     and not exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'z_bitacora')),
  '', 'Toda tabla de datos deja sus altas y ediciones en la bitácora');

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and not (coalesce(c.reloptions, '{}') @> '{security_invoker=true}')),
  '', 'Todas las vistas aplican los permisos de quien consulta (security_invoker)');

select * from finish();
rollback;
