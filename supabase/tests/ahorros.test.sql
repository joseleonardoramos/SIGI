-- Iniciativas de ahorro (pgTAP): por empresa, Captura registra en la suya, Consulta solo lee,
-- el costo nuevo no supera la línea base y nada se borra.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'captura@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'consulta@prueba.test');
insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 1),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'Empresa B', 1);
insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'Consulta');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok($$ insert into iniciativas_ahorro (empresa_id, codigo, nombre, modulo, palanca, linea_base, costo_nuevo, fecha_efectiva)
  values ('00000000-0000-0000-0000-00000000000a', 'AH-01', 'Renegociación de internet', 'Telecom', 'Precio', 1000, 700, '2026-07-01') $$, 'Captura registra una iniciativa en su empresa');
select throws_ok($$ insert into iniciativas_ahorro (empresa_id, codigo, nombre, modulo, palanca, linea_base, costo_nuevo, fecha_efectiva)
  values ('00000000-0000-0000-0000-00000000000b', 'AH-01', 'Ajena', 'Telecom', 'Precio', 1000, 700, '2026-07-01') $$, '42501', null, 'Captura no registra en otra empresa');
select throws_ok($$ insert into iniciativas_ahorro (empresa_id, codigo, nombre, modulo, palanca, linea_base, costo_nuevo, fecha_efectiva)
  values ('00000000-0000-0000-0000-00000000000a', 'AH-02', 'Más cara', 'Software', 'Cantidad', 100, 150, '2026-07-01') $$, '23514', null, 'El costo nuevo no puede superar la línea base');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is((select count(*)::int from iniciativas_ahorro), 1, 'Consulta ve las iniciativas de su empresa');
update iniciativas_ahorro set estado = 'Realizado'; -- RLS: no afecta ninguna fila
select is((select estado from iniciativas_ahorro where codigo = 'AH-01'), 'Propuesta', 'Consulta no edita');

reset role;
select throws_ok($$ delete from iniciativas_ahorro $$, null, null, 'Ni el servidor puede borrar iniciativas');

select * from finish();
rollback;
