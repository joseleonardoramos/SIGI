-- Pruebas de activos, reposición y proyectos (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'captura@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'consulta@prueba.test');
insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 10),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'Empresa B', 1);
insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'Consulta');
insert into activos (id, empresa_id, categoria, nombre, serial, garantia_hasta) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000000a', 'Servidor', 'Servidor ERP', 'SRV-001', current_date + 30),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-00000000000b', 'Red', 'Switch B', 'SW-001', current_date + 30);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select throws_ok(
  $$ insert into activos (empresa_id, categoria, nombre, serial) values ('00000000-0000-0000-0000-00000000000a', 'Servidor', 'Otro', 'srv-001') $$,
  '23505', null, 'Un serial no se repite en la empresa (sin importar mayúsculas)');
select lives_ok(
  $$ insert into activos (empresa_id, categoria, nombre, serial) values ('00000000-0000-0000-0000-00000000000a', 'UPS', 'UPS sala', null) $$,
  'Varios activos pueden no tener serial');
select throws_ok(
  $$ insert into reposiciones (empresa_id, tipo, descripcion) values ('00000000-0000-0000-0000-00000000000a', 'Reemplazo', 'Servidor nuevo') $$,
  '23514', null, 'Un reemplazo exige el activo que se reemplaza');
select throws_ok(
  $$ insert into reposiciones (empresa_id, tipo, activo_id, descripcion) values ('00000000-0000-0000-0000-00000000000a', 'Reemplazo', '00000000-0000-0000-0000-0000000000b5', 'X') $$,
  '23503', null, 'No se puede reponer un activo de otra empresa');
insert into reposiciones (empresa_id, tipo, activo_id, descripcion, costo) values
  ('00000000-0000-0000-0000-00000000000a', 'Reemplazo', '00000000-0000-0000-0000-0000000000a5', 'Servidor nuevo', 250000),
  ('00000000-0000-0000-0000-00000000000a', 'Compra nueva', null, 'Laptops', 90000);
insert into proyectos (empresa_id, nombre, tipo, inversion_inicial, opex_mensual) values
  ('00000000-0000-0000-0000-00000000000a', 'Tienda Santiago', 'Apertura', 500000, 15000);

select is(
  (select garantias_vencen_60 || '|' || reposiciones_pendientes from panel_empresa where empresa_id = '00000000-0000-0000-0000-00000000000a'),
  '1|2', 'El panel cuenta garantías por vencer y reposiciones pendientes');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is((select count(*)::int from proyectos), 1, 'Consulta ve los proyectos de su empresa');
select throws_ok(
  $$ insert into proyectos (empresa_id, nombre, tipo) values ('00000000-0000-0000-0000-00000000000a', 'X', 'Inversión') $$,
  '42501', null, 'Consulta no registra proyectos');

select * from finish();
rollback;
