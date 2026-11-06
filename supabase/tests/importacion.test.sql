-- Pruebas de la importación CSV (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'captura@prueba.test');
insert into empresas (id, codigo, nombre, inicio_ejercicio_mes) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'Empresa A', 10);
insert into membresias (usuario_id, empresa_id, rol) values
  ('00000000-0000-0000-0000-0000000000a1', null, 'Administrador'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Captura');
insert into proveedores (id, nombre) values ('00000000-0000-0000-0000-0000000000d1', 'Claro Prueba');
insert into cuentas_proveedor (empresa_id, proveedor_id, numero) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', '7001');
insert into tasas_cambio (moneda, vigente_desde, tasa, fuente) values ('US$', '2026-01-01', 60, 'Prueba');
insert into areas (id, empresa_id, nombre) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000a', 'Ventas');
insert into departamentos (empresa_id, area_id, nombre) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'Ruta');
insert into presupuestos_versiones (id, empresa_id, ejercicio, numero, estado) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', '2026-2027', 1, 'Vigente'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a', '2025-2026', 1, 'Cerrado');

create temporary table telecom_ok (filas jsonb);
insert into telecom_ok values ('[
  {"Sucursal": "Sede", "Ubicación": "Santiago", "Proveedor": "claro prueba", "Cuenta Proveedor": "7001", "Detalle": "Fibra 100", "Tipo": "internet", "Moneda": "RD$", "Monto": "RD$ 1,500.00"},
  {"Sucursal": "Tienda 1", "Ubicación": "", "Proveedor": "Claro Prueba", "Cuenta Proveedor": "", "Detalle": "LTE", "Tipo": "Internet Móvil", "Moneda": "USD", "Monto": "25"}
]');
grant select on telecom_ok to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- Vista previa: valida pero no guarda
select is(
  (select importar_csv('servicios_telecom', '00000000-0000-0000-0000-00000000000a', 't.csv', repeat('a', 64), filas) - 'muestra' from telecom_ok),
  '{"filas": 2, "errores": [], "importado": false}'::jsonb, 'La vista previa valida sin errores');
select is((select count(*)::int from servicios_telecom), 0, 'La vista previa no guarda nada');

-- Errores con número de fila; no se guarda nada aunque haya filas buenas
select is(
  (select jsonb_path_query_array(importar_csv('servicios_telecom', '00000000-0000-0000-0000-00000000000a', 't.csv', repeat('b', 64), '[
     {"Sucursal": "Sede", "Proveedor": "Claro Prueba", "Detalle": "Fibra", "Tipo": "internet", "Monto": "100"},
     {"Sucursal": "Sede", "Proveedor": "Claro Prueba", "Detalle": "X", "Tipo": "Satelital", "Monto": "100"},
     {"Sucursal": "Sede", "Proveedor": "Otro", "Detalle": "X", "Tipo": "Internet", "Monto": "abc"}
   ]', true), '$.errores[*].fila')),
  '[3, 4]'::jsonb, 'Los errores indican la fila del archivo (la 1 es el encabezado)');
select is((select count(*)::int from servicios_telecom), 0, 'Un archivo con errores no guarda ninguna fila');

-- Confirmar
select is(
  (select importar_csv('servicios_telecom', '00000000-0000-0000-0000-00000000000a', 't.csv', repeat('a', 64), filas, true) ->> 'importado' from telecom_ok),
  'true', 'Confirmar guarda el archivo');
select is((select count(*)::int from servicios_telecom), 2, 'Se guardan todas las filas');
select is((select monto from servicios_telecom where detalle = 'Fibra 100'), 1500.00, 'El monto acepta RD$ y comas de miles');
select is((select tasa from servicios_telecom where detalle = 'LTE'), 60.0000, 'Un servicio en US$ toma la tasa vigente');
select matches(
  (select importar_csv('servicios_telecom', '00000000-0000-0000-0000-00000000000a', 't.csv', repeat('a', 64), filas, true) -> 'errores' -> 0 ->> 'mensaje' from telecom_ok),
  '^Este archivo ya se importó el ', 'El mismo archivo no se importa dos veces');
select is(
  (select jsonb_path_query_array(importar_csv('servicios_telecom', '00000000-0000-0000-0000-00000000000a', 't2.csv', repeat('9', 64), filas), '$.errores[*].fila') from telecom_ok),
  '[2, 3]'::jsonb, 'Reimportar un archivo corregido no duplica los servicios ya registrados');

select is(
  (select importar_csv('servicios_telecom', '00000000-0000-0000-0000-00000000000a', 't.csv', repeat('c', 64), '[{"Sucursal": "Sede", "Detalle": "X"}]') -> 'errores' -> 0 ->> 'mensaje'),
  'Faltan columnas en el encabezado: «Proveedor», «Tipo», «Monto». Descargue la plantilla.', 'Se avisa qué columnas faltan');

-- Flotas
select is(
  (select importar_csv('lineas_flota', '00000000-0000-0000-0000-00000000000a', 'f.csv', repeat('d', 64), '[
     {"Cuenta Proveedor": "7001", "Número": "809-555-0001", "Fecha creación": "15/03/2025", "Status": "Activa", "Área": "Ventas", "Departamento": "Ruta", "Datos (SI/NO)": "NO", "Precio": "850"}
   ]', true) ->> 'importado'),
  'true', 'Se importa una línea de flota');
select is(
  (select estado || '|' || datos || '|' || fecha_alta from lineas_flota where numero = '809-555-0001'),
  'Sin alerta|false|2025-03-15', 'Status, Datos y fecha DD/MM/AAAA se convierten');
select is(
  (select importar_csv('lineas_flota', '00000000-0000-0000-0000-00000000000a', 'f3.csv', repeat('8', 64), '[
     {"Cuenta Proveedor": "7001", "Número": "809-555-0009", "Fecha creación": "04/03/2024", "Área": "Ventas", "Departamento": "Ruta", "Precio": "1"}
   ]') -> 'muestra') @> '[{"numero": "809-555-0009", "fecha_alta": "2024-03-04"}]',
  true, 'La vista previa muestra la fecha ya convertida (4 de marzo), no el texto del archivo');
select is(
  (select importar_csv('lineas_flota', '00000000-0000-0000-0000-00000000000a', 'f.csv', repeat('e', 64), '[
     {"Cuenta Proveedor": "7001", "Número": "809-555-0002", "Área": "Ventas", "Departamento": "Ruta", "Precio": "850"},
     {"Cuenta Proveedor": "7001", "Número": "809-555-0002", "Área": "Ventas", "Departamento": "Ruta", "Precio": "850"}
   ]') -> 'errores' -> 0),
  '{"fila": 3, "mensaje": "La línea «809-555-0002» ya está registrada"}'::jsonb, 'Una línea repetida en el mismo archivo se detecta');

-- Partidas
select throws_ok(
  $$ select importar_csv('partidas', '00000000-0000-0000-0000-00000000000a', 'p.csv', repeat('f', 64),
       '[{"Código": "P1", "Nombre": "X", "Categoría": "Telecom", "Distribución": "Uniforme", "Monto": "100"}]', true,
       '00000000-0000-0000-0000-0000000000b2') $$,
  'P0001', 'La versión de presupuesto está cerrada.', 'No se importa a un presupuesto cerrado');
select is(
  (select importar_csv('partidas', '00000000-0000-0000-0000-00000000000a', 'p.csv', repeat('f', 64),
     '[{"Código": "P1", "Nombre": "Renovación", "Categoría": "Software", "Distribución": "Puntual marzo", "Monto": "12,000"}]', true,
     '00000000-0000-0000-0000-0000000000b1') ->> 'importado'),
  'true', 'Se importan partidas a una versión vigente');
select is((select distribucion from partidas where codigo = 'P1'), 'Puntual · mar', 'La distribución puntual se normaliza');

-- Catálogos del Administrador
select throws_ok(
  $$ select importar_csv('proveedores', null, 'pr.csv', repeat('1', 64), '[{"Nombre": "Nuevo"}]', true) $$,
  'P0001', 'Solo el Administrador importa proveedores, cuentas, áreas y departamentos.', 'Captura no importa proveedores');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select importar_csv('cuentas_contables', '00000000-0000-0000-0000-00000000000a', 'c.csv', repeat('2', 64), '[
     {"Código": "6101-001", "Descripción": "Internet", "Tipo": "opex", "Categoría": "Telecom", "Centro de costo": "101"},
     {"Código": "6101-001", "Descripción": "Repetida", "Tipo": "OPEX", "Categoría": "Telecom", "Centro de costo": "1"}
   ]') -> 'errores' -> 0),
  '{"fila": 3, "mensaje": "Centro de costo debe tener 3 dígitos"}'::jsonb, 'Las cuentas contables se validan fila por fila');
select is(
  (select importar_csv('cuentas_proveedor', '00000000-0000-0000-0000-00000000000a', 'cp.csv', repeat('3', 64), '[
     {"Proveedor": "Claro Prueba", "Número": "7002", "Moneda": "RD$"},
     {"Proveedor": "No existe", "Número": "1", "Moneda": "RD$"}
   ]') -> 'errores'),
  '[{"fila": 3, "mensaje": "El proveedor «No existe» no existe en el maestro"}]'::jsonb, 'Las cuentas de proveedor exigen un proveedor del maestro');
select is(
  (select importar_csv('proveedores', null, 'pr.csv', repeat('4', 64), '[{"Nombre": "CLARO PRUEBA"}]') -> 'errores' -> 0 ->> 'mensaje'),
  'Ya existe un registro igual (en el archivo o en SIGI)', 'Un proveedor que solo cambia mayúsculas se rechaza');

-- Maestro de áreas y departamentos
select is(
  (select importar_csv('departamentos', '00000000-0000-0000-0000-00000000000a', 'd.csv', repeat('5', 64), '[
     {"Área": "Operaciones", "Departamento": "Almacén"},
     {"Área": "ventas", "Departamento": "Ruta"}
   ]') -> 'errores'),
  '[{"fila": 3, "mensaje": "Ya existe un registro igual (en el archivo o en SIGI)"}]'::jsonb, 'Un departamento no se repite dentro de su área');
select is(
  (select (importar_csv('departamentos', '00000000-0000-0000-0000-00000000000a', 'd2.csv', repeat('6', 64),
     '[{"Área": "Operaciones", "Departamento": "Almacén"}]', true) ->> 'importado')
     || '|' || (select count(*) from areas where nombre = 'Operaciones')),
  'true|1', 'Importar áreas y departamentos crea el área que falta');
select is(
  (select importar_csv('lineas_flota', '00000000-0000-0000-0000-00000000000a', 'f9.csv', repeat('7', 64), '[
     {"Cuenta Proveedor": "7001", "Número": "809-555-0099", "Área": "Logística", "Departamento": "Ruta", "Precio": "10"}
   ]') -> 'errores' -> 0 ->> 'mensaje'),
  'El área «Logística» no existe en el maestro de áreas', 'Una línea de flota exige un área del maestro');

select * from finish();
rollback;
