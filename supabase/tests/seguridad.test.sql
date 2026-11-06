-- Pruebas de seguridad de SIGI (pgTAP). Ejecutar: npm run db:test
-- Todo ocurre dentro de una transacción que se deshace al final.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Usuarios de prueba: admin (global), captura y consulta de la empresa A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'captura@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'consulta@prueba.test');

insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 10),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'Empresa B', 1);

insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000a1', null, 'Administrador'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'Consulta');

insert into servicios_telecom (id, empresa_id, sucursal, tipo, detalle, monto) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'Sucursal A', 'Internet', 'Fibra', 100),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000b', 'Sucursal B', 'Internet', 'Fibra', 200);

insert into personas (id, empresa_id, nombre) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 'Persona A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000b', 'Persona B');

insert into ausencias (empresa_id, persona_id, tipo, desde, hasta) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'Vacaciones', '2026-11-02', '2026-11-13');

-- ===== Anónimo: no ve nada =====
set local role anon;
select throws_ok($$ select count(*) from servicios_telecom $$, '42501', null, 'Anónimo no tiene acceso a las tablas');
reset role;

-- ===== Consulta de A =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

select is((select count(*)::int from servicios_telecom), 1, 'Consulta ve solo los servicios de su empresa');
select is((select count(*)::int from empresas), 1, 'Consulta ve solo su empresa');
select is((select count(*)::int from ausencias), 0, 'Consulta no ve ausencias');
select is((select count(*)::int from personas), 0, 'Consulta no ve personal');
select throws_ok(
  $$ insert into servicios_telecom (empresa_id, sucursal, tipo, detalle, monto) values ('00000000-0000-0000-0000-00000000000a', 'X', 'Internet', 'X', 1) $$,
  '42501', null, 'Consulta no puede registrar');

-- ===== Captura de A =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select is((select count(*)::int from ausencias), 1, 'Captura ve las ausencias de su empresa');
select lives_ok(
  $$ insert into servicios_telecom (empresa_id, sucursal, tipo, detalle, monto) values ('00000000-0000-0000-0000-00000000000a', 'Nueva', 'Telefonía', 'Troncal', 50) $$,
  'Captura registra en su empresa');
select throws_ok(
  $$ insert into servicios_telecom (empresa_id, sucursal, tipo, detalle, monto) values ('00000000-0000-0000-0000-00000000000b', 'Ajena', 'Internet', 'X', 1) $$,
  '42501', null, 'Captura no registra en otra empresa');
select throws_ok(
  $$ delete from servicios_telecom where id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'Captura no puede borrar');
select throws_ok(
  $$ update servicios_telecom set activo = false, baja_motivo = 'prueba' where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'P0001', 'Solo el Administrador puede dar de baja o reactivar registros.', 'Captura no da de baja');
select throws_ok(
  $$ update servicios_telecom set empresa_id = '00000000-0000-0000-0000-00000000000b' where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'P0001', 'No se puede cambiar la empresa de un registro.', 'Captura no mueve un registro a otra empresa');
select throws_ok(
  $$ insert into ausencias (empresa_id, persona_id, tipo, desde, hasta) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'Permiso', '2026-11-10', '2026-11-11') $$,
  '23P01', null, 'No se permiten ausencias traslapadas');
select throws_ok(
  $$ insert into marcas_direccion (empresa_id, entidad, entidad_id, marcado) values ('00000000-0000-0000-0000-00000000000a', 'gastos', 'X', true) $$,
  '42501', null, 'Captura no marca Aprobado por Dirección');
insert into servicios_telecom (id, empresa_id, sucursal, tipo, detalle, monto, activo, baja_por, baja_motivo) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000a', 'Falsa', 'Internet', 'X', 1,
   false, '00000000-0000-0000-0000-0000000000a1', 'baja inventada');
select is(
  (select activo and baja_por is null and baja_motivo is null from servicios_telecom where id = '00000000-0000-0000-0000-0000000000f3'),
  true, 'Un alta no puede venir con una baja inventada');

-- ===== Administrador =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from servicios_telecom where empresa_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')),
  4, 'Administrador ve todas las empresas');
select throws_ok(
  $$ update servicios_telecom set activo = false where id = '00000000-0000-0000-0000-0000000000f2' $$,
  'P0001', 'La baja requiere un motivo.', 'La baja exige motivo');
update servicios_telecom set activo = false, baja_motivo = 'Contrato terminado' where id = '00000000-0000-0000-0000-0000000000f2';
select is(
  (select baja_por from servicios_telecom where id = '00000000-0000-0000-0000-0000000000f2'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'La baja guarda quién la hizo');
select is(
  (select count(*)::int from bitacora where tabla = 'servicios_telecom' and registro_id = '00000000-0000-0000-0000-0000000000f2' and accion = 'UPDATE'),
  1, 'La baja queda en la bitácora con el valor anterior');
update ausencias set activo = false, baja_motivo = 'Registrada por error' where persona_id = '00000000-0000-0000-0000-0000000000e1';
select lives_ok(
  $$ insert into ausencias (empresa_id, persona_id, tipo, desde, hasta) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'Permiso', '2026-11-10', '2026-11-11') $$,
  'Una ausencia dada de baja deja libres sus fechas');
select throws_ok(
  $$ insert into ausencias (empresa_id, persona_id, tipo, desde, hasta) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'Viaje', '2026-12-01', '2026-12-02') $$,
  '23503', null, 'Una ausencia no puede usar una persona de otra empresa');
update personas set activo = false, baja_motivo = 'Salida de la empresa' where id = '00000000-0000-0000-0000-0000000000e1';
select throws_ok(
  $$ insert into ausencias (empresa_id, persona_id, tipo, desde, hasta) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'Viaje', '2026-12-01', '2026-12-02') $$,
  'P0001', 'La persona está dada de baja o no existe; no acepta ausencias nuevas.', 'Una persona dada de baja no acepta ausencias nuevas');

update empresas set activo = false, baja_motivo = 'Cierre' where id = '00000000-0000-0000-0000-00000000000a';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok(
  $$ insert into servicios_telecom (empresa_id, sucursal, tipo, detalle, monto) values ('00000000-0000-0000-0000-00000000000a', 'Tras la baja', 'Internet', 'X', 1) $$,
  '42501', null, 'Captura no registra en una empresa dada de baja');
select is(
  (select count(*)::int from servicios_telecom where empresa_id = '00000000-0000-0000-0000-00000000000a'),
  3, 'El historial de una empresa dada de baja se sigue consultando');

reset role;
select throws_ok(
  $$ delete from servicios_telecom where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'P0001', 'SIGI no borra registros: use la baja (activo = false).', 'Ni el servidor borra registros');

select * from finish();
rollback;
