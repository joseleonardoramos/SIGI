-- Prueba del panel gerencial (pgTAP): un caso armado a mano con resultado conocido.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'consulta@prueba.test');
insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 10),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'Empresa B', 1);
insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000a1', null, 'Administrador'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b', 'Consulta');
insert into presupuestos_versiones (id, empresa_id, ejercicio, numero, estado) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', '2026-2027', 1, 'Vigente'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a', '2025-2026', 1, 'Cerrado');
insert into partidas (id, empresa_id, version_id, codigo, nombre, categoria, distribucion, monto) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'P1', 'Internet', 'Telecom', 'Uniforme', 1000),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'P2', 'Flotas', 'Flotas', 'Uniforme', 500),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'P3', 'Año cerrado', 'Telecom', 'Uniforme', 999);
insert into proveedores (id, nombre) values ('00000000-0000-0000-0000-0000000000d9', 'Proveedor de prueba del panel');
insert into servicios_telecom (empresa_id, sucursal, tipo, detalle, moneda, monto) values
  ('00000000-0000-0000-0000-00000000000a', 'Sede', 'Internet', 'Fibra', 'RD$', 100),
  ('00000000-0000-0000-0000-00000000000a', 'Sede', 'Internet Móvil', 'LTE', 'US$', 10);
insert into areas (id, empresa_id, nombre) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000a', 'Ventas');
insert into departamentos (id, empresa_id, area_id, nombre) values ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'Ruta');
insert into lineas_flota (empresa_id, numero, area_id, departamento_id, costo_mensual, estado) values
  ('00000000-0000-0000-0000-00000000000a', '1', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000ad', 300, 'Sin alerta'),
  ('00000000-0000-0000-0000-00000000000a', '2', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000ad', 200, 'Cancelada');
insert into productos_software (empresa_id, nombre, tipo, unidad, contratadas, precio_unitario, periodicidad, inicio, vence, renovacion) values
  ('00000000-0000-0000-0000-00000000000a', 'Antivirus', 'Licencia', 'Equipo', 10, 5, 'Anual', current_date - 300, current_date + 30, 'Manual'),
  ('00000000-0000-0000-0000-00000000000a', 'Firma digital', 'Certificado', 'Certificado', 1, 50, 'Anual', current_date - 400, current_date - 1, 'Manual'),
  ('00000000-0000-0000-0000-00000000000a', 'Correo', 'SaaS', 'Usuario', 5, 6, 'Mensual', current_date - 10, current_date + 200, 'Automática');
insert into personas (id, empresa_id, nombre) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 'Persona A');
insert into ausencias (empresa_id, persona_id, tipo, desde, hasta) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'Vacaciones', current_date - 1, current_date + 1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-1', 'Partida', 'Fibra', 600, current_date, p_partida => '00000000-0000-0000-0000-0000000000f1');
select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-2', 'Flotas', 'Planes', 700, current_date, p_partida => '00000000-0000-0000-0000-0000000000f2', p_motivo_fuera => 'Más líneas');
select registrar_compromiso('00000000-0000-0000-0000-00000000000a', 'G-3', 'Telecom', 'Reparación', 50, current_date, p_motivo_fuera => 'Urgente');
select registrar_movimiento((select id from gastos where codigo = 'G-1' and empresa_id = '00000000-0000-0000-0000-00000000000a'), 'Factura', 600, current_date, p_ncf => 'B0100000099', p_proveedor => '00000000-0000-0000-0000-0000000000d9');
select registrar_movimiento((select id from gastos where codigo = 'G-1' and empresa_id = '00000000-0000-0000-0000-00000000000a'), 'Pago', 100, current_date);

-- presupuesto|comprometido|ejecutado|pagado|disponible|ahorro|exceso|sin_partida|telecom RD|US|flotas|líneas|software|fuera hoy
select is(
  (select concat_ws('|', presupuesto, comprometido, ejecutado, pagado, disponible, ahorro, exceso, sin_partida,
                    telecom_rd, telecom_us, flotas_mensual, flotas_lineas, software_vencen_60, personal_fuera_hoy)
   from panel_empresa where empresa_id = '00000000-0000-0000-0000-00000000000a'),
  '1500.00|1300.00|600.00|100.00|200.00|400.00|200.00|50.00|100.00|10.00|300.00|1|2|1',
  'El panel suma solo la versión vigente, sin doble conteo, excluye líneas canceladas y alerta el software vencido');
select throws_ok(
  $$ insert into presupuestos_versiones (empresa_id, ejercicio, numero, estado) values ('00000000-0000-0000-0000-00000000000a', '2026-2027', 2, 'Vigente') $$,
  '23505', null, 'No puede haber dos versiones vigentes en la misma empresa');
select is((select count(*)::int from panel_empresa where empresa_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')), 2, 'El Administrador ve todas las empresas');

-- Consulta de B: solo su empresa, y sin conteo de personal (no ve ausencias)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is((select string_agg(nombre || ':' || personal_fuera_hoy, ',') from panel_empresa), 'Empresa B:0', 'Consulta solo ve su empresa en el panel');

select * from finish();
rollback;
