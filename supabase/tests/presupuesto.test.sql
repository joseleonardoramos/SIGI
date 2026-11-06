-- Pruebas del motor de presupuesto y gastos (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'captura@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'consulta@prueba.test');
insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 10);
insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'Consulta');
insert into proveedores (id, nombre) values ('00000000-0000-0000-0000-0000000000d1', 'Proveedor de prueba');
insert into tasas_cambio (moneda, vigente_desde, tasa, fuente) values ('US$', '2026-01-01', 60, 'Prueba');
insert into presupuestos_versiones (id, empresa_id, ejercicio, numero, estado) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', '2026-2027', 1, 'Vigente'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a', '2025-2026', 1, 'Cerrado'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000a', '2024-2025', 1, 'Borrador');
insert into partidas (id, empresa_id, version_id, codigo, nombre, categoria, distribucion, monto) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'P1', 'Internet', 'Telecom', 'Uniforme', 1000),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'P2', 'Cerrada', 'Telecom', 'Uniforme', 1000),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'P3', 'Flotas', 'Flotas', 'Uniforme', 1000),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b3', 'P4', 'Anterior', 'Telecom', 'Uniforme', 1000);

set local role authenticated;

-- ===== Consulta no registra =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select throws_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-0', 'Partida', 'X', 10, '2026-11-04') $$,
  'P0001', 'Sin permiso para registrar en esta empresa.', 'Consulta no registra gastos');

-- ===== Captura =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select lives_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-1', 'Partida', 'Fibra sede', 600, '2026-11-04',
       p_partida => '00000000-0000-0000-0000-0000000000f1', p_proveedor => '00000000-0000-0000-0000-0000000000d1') $$,
  'Compromiso dentro del disponible');
select is((select disponible from saldo_partidas where codigo = 'P1'), 400.00, 'El disponible baja con el compromiso');

select throws_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-2', 'Partida', 'Exceso', 500, '2026-11-04',
       p_partida => '00000000-0000-0000-0000-0000000000f1') $$,
  'P0001', 'Excede el disponible de la partida (400.00). Indique el motivo para registrarlo fuera de presupuesto.',
  'Un exceso sin motivo se rechaza');
select lives_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-2', 'Partida', 'Exceso', 500, '2026-11-04',
       p_partida => '00000000-0000-0000-0000-0000000000f1', p_motivo_fuera => 'Avería urgente') $$,
  'Un exceso con motivo queda fuera de presupuesto');
select is((select disponible from saldo_partidas where codigo = 'P1'), -100.00, 'El exceso se ve como disponible negativo');

select lives_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-3', 'Software', 'Licencia', 1, '2026-11-04',
       p_moneda => 'US$', p_partida => '00000000-0000-0000-0000-0000000000f1', p_motivo_fuera => 'Licencia anual') $$,
  'Compromiso en US$');
select is((select tasa from gastos where codigo = 'G-3'), 60::numeric, 'El gasto en US$ fija la tasa vigente');

select throws_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-4', 'Partida', 'X', 10, '2026-11-04',
       p_partida => '00000000-0000-0000-0000-0000000000f2', p_motivo_fuera => 'x') $$,
  'P0001', 'La versión de presupuesto de esa partida está cerrada.', 'No se registra contra un presupuesto cerrado');
select throws_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-5', 'Telecom', 'Sin partida', 10, '2026-11-04') $$,
  'P0001', 'Un gasto sin partida es fuera de presupuesto: indique el motivo.', 'Un gasto sin partida exige motivo');

-- Facturas
select throws_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-1'), 'Factura', 600, '2026-11-05') $$,
  'P0001', 'La factura requiere NCF o e-CF.', 'La factura exige NCF');
select throws_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-1'), 'Factura', 600, '2026-11-05', p_ncf => 'B0400000001') $$,
  'P0001', 'NCF o e-CF inválido: B0400000001. Ejemplos: B0100000001 o E310000000001.', 'Una nota de crédito no es una factura');
select lives_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-1'), 'Factura', 600, '2026-11-05', p_ncf => 'b0100000001') $$,
  'Factura con NCF válido');
select throws_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-1'), 'Factura', 10, '2026-11-05', p_ncf => 'B0100000001') $$,
  'P0001', 'El NCF B0100000001 ya está registrado para este proveedor.', 'No se repite un NCF del mismo proveedor');
select is((select disponible from saldo_partidas where codigo = 'P1'), -160.00, 'Facturar lo comprometido no consume dos veces');

-- Pagos
select throws_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-1'), 'Pago', 700, '2026-11-06') $$,
  'P0001', 'El pago supera lo facturado; pendiente de pago: 600.00.', 'No se paga más de lo facturado');
select lives_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-1'), 'Pago', 600, '2026-11-06', p_metodo_pago => 'Transferencia') $$,
  'Pago de lo facturado');

-- Reversos
select throws_ok(
  $$ select reversar_movimiento((select id from gasto_pasos where ncf = 'B0100000001'), 'Factura equivocada') $$,
  'P0001', 'Primero reverse los pagos: lo pagado quedaría por encima de lo facturado.', 'No se reversa una factura ya pagada');
select lives_ok(
  $$ select reversar_movimiento((select id from gasto_pasos where tipo = 'Pago'), 'Pago duplicado') $$,
  'Reverso de un pago');
select throws_ok(
  $$ select reversar_movimiento((select id from gasto_pasos where tipo = 'Pago'), 'Otra vez') $$,
  'P0001', 'Ese movimiento ya fue reversado.', 'No se reversa dos veces');
select is(
  (select comprometido || '|' || facturado || '|' || pagado from resumen_gastos r join gastos g on g.id = r.gasto_id where g.codigo = 'G-1'),
  '600.00|600.00|0', 'El resumen del gasto excluye el pago reversado');

-- El motivo solo se guarda si de verdad queda fuera de presupuesto
select lives_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-6', 'Flotas', 'Plan', 100, '2026-11-04',
       p_partida => '00000000-0000-0000-0000-0000000000f3', p_motivo_fuera => 'Innecesario') $$,
  'Compromiso dentro del disponible aunque traiga motivo');
select is(
  (select p.fuera_presupuesto_motivo from gasto_pasos p join gastos g on g.id = p.gasto_id where g.codigo = 'G-6'),
  null, 'Un gasto dentro del presupuesto no queda marcado como fuera de presupuesto');

-- Presupuesto cerrado: no más compromisos, pero las facturas tardías sí
select lives_ok(
  $$ select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-7', 'Partida', 'Anterior', 100, '2026-11-04',
       p_partida => '00000000-0000-0000-0000-0000000000f4') $$,
  'Compromiso en una versión todavía abierta');
update presupuestos_versiones set estado = 'Cerrado' where id = '00000000-0000-0000-0000-0000000000b3';
select throws_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-7'), 'Compromiso', 10, '2026-11-05') $$,
  'P0001', 'La versión de presupuesto de esa partida está cerrada.', 'No se agrega compromiso a un presupuesto cerrado');
select throws_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-7'), 'Factura', 100, '2026-11-05', p_ncf => 'B0100000002') $$,
  'P0001', 'La factura requiere el proveedor (el NCF es único por emisor).', 'Una factura sin proveedor se rechaza');
select lives_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-7'), 'Factura', 100, '2026-11-05', p_ncf => 'B0100000002',
       p_proveedor => '00000000-0000-0000-0000-0000000000d1') $$,
  'Una factura tardía de un presupuesto cerrado se acepta');
select is((select proveedor_id from gastos where codigo = 'G-7'), '00000000-0000-0000-0000-0000000000d1'::uuid,
  'El proveedor se asigna al gasto con su primera factura');

-- Partida dada de baja (por un proceso del servidor, sin usuario)
reset role;
set local request.jwt.claims = '{}';
update partidas set activo = false, baja_motivo = 'Reorganización' where id = '00000000-0000-0000-0000-0000000000f3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok(
  $$ select registrar_movimiento((select id from gastos where codigo = 'G-6'), 'Factura', 5000, '2026-11-05', p_ncf => 'B0100000003', p_proveedor => '00000000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'La partida está dada de baja: no acepta montos nuevos.', 'Una partida dada de baja no salta el control de saldo');

-- Escritura directa bloqueada
select throws_ok(
  $$ insert into gasto_pasos (empresa_id, gasto_id, tipo, fecha, monto) values ('00000000-0000-0000-0000-00000000000a', (select id from gastos where codigo = 'G-1'), 'Pago', '2026-11-06', 1) $$,
  '42501', null, 'No se insertan movimientos sin pasar por las funciones');
select throws_ok(
  $$ update gastos set tasa = 1 where codigo = 'G-3' $$,
  '42501', null, 'No se cambia la tasa fijada de un gasto');

select * from finish();
rollback;
