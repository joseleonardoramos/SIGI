-- Pruebas de administración de usuarios y roles (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'usuario@prueba.test');
insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 10);
insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000a1', null, 'Administrador');

set local role authenticated;

-- Usuario sin rol de Administrador
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$ select * from listar_usuarios() $$, 'P0001', 'Solo el Administrador puede ver los usuarios.', 'Un usuario común no lista usuarios');
select throws_ok(
  $$ select asignar_rol('00000000-0000-0000-0000-0000000000c1', null, 'Administrador') $$,
  'P0001', 'Solo el Administrador asigna roles.', 'Un usuario común no se da rol de Administrador');

-- Administrador
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from listar_usuarios() where email like '%@prueba.test'), 2, 'El Administrador lista los usuarios');

select asignar_rol('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura');
select asignar_rol('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Consulta');
select is(
  (select array_agg(rol) from membresias where usuario_id = '00000000-0000-0000-0000-0000000000c1' and activo),
  array['Consulta'], 'Cambiar de rol deja un solo rol vigente por empresa');

select asignar_rol('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura');
select is(
  (select count(*)::int from membresias where usuario_id = '00000000-0000-0000-0000-0000000000c1'),
  2, 'Volver a un rol anterior lo reactiva en lugar de duplicarlo');

select asignar_rol('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', null);
select is(
  (select count(*)::int from membresias where usuario_id = '00000000-0000-0000-0000-0000000000c1' and activo),
  0, 'Quitar el acceso desactiva el rol sin borrarlo');

select throws_ok(
  $$ select asignar_rol('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Administrador') $$,
  'P0001', 'El rol Administrador es global; Captura y Consulta requieren una empresa.', 'Administrador no se asigna por empresa');
select throws_ok(
  $$ select asignar_rol('00000000-0000-0000-0000-0000000000a1', null, null) $$,
  'P0001', 'No puede quitarse su propio rol de Administrador.', 'El Administrador no se deja sin acceso a sí mismo');

reset role;
select is(
  (select count(*)::int from bitacora where tabla = 'membresias' and registro_id in (select id::text from membresias where usuario_id = '00000000-0000-0000-0000-0000000000c1')),
  6, 'Cada cambio de rol queda en la bitácora');

select * from finish();
rollback;
