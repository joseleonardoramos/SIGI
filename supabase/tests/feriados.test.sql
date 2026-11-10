-- Feriados (pgTAP): todos los ven, solo el Administrador los registra, uno activo por fecha y nada se borra.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'captura@prueba.test');
insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 1);
insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000a1', null, 'Administrador'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ insert into feriados (fecha, nombre) values ('2027-02-27', 'Día de la Independencia') $$, 'El Administrador registra un feriado');
select throws_ok($$ insert into feriados (fecha, nombre) values ('2027-02-27', 'Repetido') $$, '23505', null, 'No hay dos feriados activos en la misma fecha');
update feriados set activo = false, baja_motivo = 'Fecha equivocada' where fecha = '2027-02-27';
select lives_ok($$ insert into feriados (fecha, nombre) values ('2027-02-27', 'Día de la Independencia') $$, 'Uno dado de baja no impide registrarlo otra vez');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from feriados where activo), 1, 'Captura ve los feriados');
select throws_ok($$ insert into feriados (fecha, nombre) values ('2027-01-01', 'Año Nuevo') $$, '42501', null, 'Captura no registra feriados');

reset role;
select throws_ok($$ delete from feriados $$, null, null, 'Ni el servidor puede borrar feriados');

select * from finish();
rollback;
