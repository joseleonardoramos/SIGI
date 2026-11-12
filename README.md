# SIGI — Sistema Integral de Gestión de Infraestructura

- `docs/` — diseño funcional (v3.1) y pase a producción en Docker y Docker Swarm (`docs/PaseProduccion.md`).
- `design/` — prototipo de pantallas (lienzo de Claude Design).
- `supabase/` — base de datos: migraciones, seguridad y pruebas.
- `proxy/` y `docker-compose.produccion.yml` — proxy HTTPS de producción (80 y 443, un solo nombre: `sigi.elcatador.local`).

## Desarrollo local

Requisitos: Docker Desktop abierto y Node 20 o superior.

```bash
npm install          # instala la CLI de Supabase del proyecto
npm run db:start     # levanta Supabase en Docker y aplica las migraciones
npm run db:test      # pruebas de seguridad (RLS, bajas, historial)
npm run db:reset     # borra la base local y la recrea desde las migraciones
npm run db:stop
```

Studio local: http://127.0.0.1:54323. Las claves locales se ven con `npx supabase status`; son de desarrollo y no sirven fuera de esta máquina.

## Frontend en Docker

1. Copia `.env.example` a `.env` y pon en `VITE_SUPABASE_PUBLISHABLE_KEY` el valor `PUBLISHABLE_KEY` de `npx supabase status`.
2. Levanta la aplicación en http://localhost:8080:

```bash
npm run web:start
```

Para desarrollar con recarga automática: copia `.env` a `web/.env.local` y ejecuta `npm run dev` dentro de `web/` (http://localhost:5173).

## Primer Administrador

Nadie puede registrarse solo: los usuarios los crea el Administrador. El primero se crea con el script, usando la clave de servicio en el entorno (nunca en un archivo del repositorio):

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY de supabase status> npm run admin:crear -- correo@empresa.com 'Contraseña12345'
```

Si el usuario ya existe, el script solo le da el rol de Administrador. Después, el Administrador entra a la aplicación y:

- **Empresas:** crea, edita o da de baja (con motivo) cada empresa.
- **Usuarios y roles:** crea usuarios con una contraseña temporal y elige el rol en cada empresa (Sin acceso, Consulta o Captura) o el rol global de Administrador.
- Cada usuario cambia su contraseña temporal en «Cambiar contraseña» (mínimo 12 caracteres, con letras y números).

## Presupuesto y gastos

Los gastos no se escriben directo en las tablas: se registran con funciones que bloquean la partida y validan el saldo.

| Función | Hace |
|---|---|
| `registrar_compromiso` | Crea el gasto con su orden, contrato o reserva. Fija la tasa de cambio vigente. |
| `registrar_movimiento` | Agrega más compromiso, una factura (exige NCF o e-CF válido y no repetido) o un pago (no más de lo facturado). |
| `reversar_movimiento` | Corrige sin borrar: marca el movimiento como reversado y deja un «Reverso» con el motivo. |
| vista `saldo_partidas` | Presupuesto, comprometido, ejecutado, pagado y disponible por partida, en la moneda de reporte. |

- Si un monto supera el disponible, se rechaza salvo que se indique el motivo: queda **fuera de presupuesto** y el disponible se ve negativo.
- Un gasto sin partida siempre es fuera de presupuesto y exige motivo.
- Las tasas de cambio (`tasas_cambio`) las registra el Administrador con fecha de vigencia; cada cambio es una fila nueva.

```bash
npm run test:concurrencia   # dos sesiones a la vez sobre la misma partida: la segunda espera y se rechaza
npm run test:funciones      # solo el Administrador crea usuarios
```

## Módulos

El selector de la cabecera elige la empresa; sus colores (El Catador o Bona) se configuran en Administración → Empresas.

| Sección | Pantallas |
|---|---|
| Inicio | Panel gerencial de la empresa elegida (vista `panel_empresa`) y consolidado por moneda de reporte |
| Presupuesto | Versiones, Presupuesto y ejecución (portafolio, saldo, comparación, partidas, programación mensual), Ahorros (iniciativas con palanca y estado; realizado, en gestión y proyección de cierre), Gastos y evidencias |
| Operación | Telecomunicaciones, Flotas (cancelar = estado «Cancelada»), Software |
| Activos y proyectos | Activos (serial único, garantía), Plan de reposición (reemplazo, compra nueva o mantenimiento), Proyectos y aperturas (inversión inicial separada del OPEX mensual) |
| Personal | Personal y ausencias en una pantalla: quién está fuera hoy y en 30 días, ausencias (no se traslapan; cancelar las conserva) y la bitácora de ambas |
| Catálogos | Proveedores y cuentas (maestro de proveedores con sus cuentas por empresa y catálogo contable por concepto o en matriz centro de costo × concepto), Centros de costo, Áreas, Departamentos, Tasas de cambio, Feriados (solo el Administrador los edita). Los feriados se descuentan de los días hábiles de las ausencias. Áreas y departamentos alimentan las listas de Flotas, Personal y Reposición; el departamento depende del área |
| Herramientas | Importar CSV, Bitácora |

Telecomunicaciones se agrupa por sucursal y Flotas por área y departamento, con subtotales por moneda. Presupuesto → Comparar versiones muestra dos versiones lado a lado por categoría, y el panel incluye la ejecución por categoría de la versión vigente. Todas las listas permiten buscar, ver los registros dados de baja y exportar a CSV (lo que se ve en pantalla, con los números sin formato para Excel). Editar deja el valor anterior en la bitácora; dar de baja (solo el Administrador) pide un motivo y conserva el registro.

## Importación CSV

Pantalla **Importar CSV** (Administrador y Captura). Catálogos: servicios de telecomunicaciones, líneas de flota y partidas de presupuesto; el Administrador además importa proveedores, cuentas de proveedor y cuentas contables.

1. Elegir qué importar y la empresa (y la versión de presupuesto para partidas).
2. **Descargar plantilla** para tener el encabezado exacto. Hay ejemplos llenos en `docs/plantillas/`, numerados en el orden en que conviene importarlos (áreas y departamentos, proveedores y sus cuentas van antes que los servicios y las líneas, porque las líneas deben usar un área y un departamento del maestro).
3. Elegir el archivo: se revisa completo y se muestran los errores con su número de fila. **Nada se guarda** hasta confirmar, y si una fila tiene error no se guarda ninguna.
4. Confirmar. El mismo archivo no se puede importar dos veces.

Formato: separado por comas o por punto y coma, UTF-8 (también acepta el ANSI de Excel), montos con punto decimal (`1,500.00` o `RD$ 1,500.00`), fechas `AAAA-MM-DD` o `DD/MM/AAAA`. Máximo 5000 filas por archivo.

## Operación

```bash
npm start        # levanta Supabase local y el frontend (http://localhost:8080)
npm stop         # los detiene; los datos quedan en los volúmenes de Docker
npm test         # todas las pruebas: base, frontend, función de usuarios, concurrencia y respaldo
npm run respaldar -- <carpeta>
```

Si Docker se reinició (por ejemplo, después de apagar el equipo) y la creación de usuarios u otra parte no responde, ejecute `npm stop` y luego `npm start`: algún contenedor de Supabase pudo quedar detenido.

**Respaldos.** `npm run respaldar -- <carpeta>` guarda en la carpeta que usted elija la base completa (`base.dump`), los archivos de evidencias (`evidencias.tar`) y sus huellas (`sha256.txt`). No hay carpeta por defecto: sin carpeta, no se guarda nada. Para no escribirla cada vez, defina la variable `SIGI_RESPALDOS` y cada respaldo se guardará en una subcarpeta con la fecha. Los respaldos tienen datos personales: elija un lugar que usted controle. No se guardan sesiones ni tokens de acceso; después de restaurar, cada usuario vuelve a iniciar sesión.

`npm run test:respaldo` respalda en una carpeta temporal, restaura en una base aparte (nueva y encima de datos), comprueba que todo coincida y borra lo temporal. Ejecútelo después de cambiar la base.

**Recuperar un respaldo** (detenga antes el frontend con `npm run web:stop`; en Git Bash de Windows, deje `MSYS_NO_PATHCONV=1` delante para que no cambie las rutas del contenedor):

```bash
docker cp <carpeta>/base.dump supabase_db_SIGI:/tmp/base.dump
MSYS_NO_PATHCONV=1 docker exec supabase_db_SIGI pg_restore -U supabase_admin --clean --if-exists -n public -n auth -n storage -d postgres /tmp/base.dump
MSYS_NO_PATHCONV=1 docker exec -i supabase_storage_SIGI tar -C /mnt -xf - < <carpeta>/evidencias.tar
```

Se restauran los datos, los usuarios y las evidencias tal como estaban (fechas, autores y bitácora incluidos). Este procedimiento lo prueba `npm run test:respaldo` sobre una base aparte.

**Todo corre local.** SIGI no usa servicios en la nube: la base, los usuarios, las evidencias y el frontend viven en Docker en este equipo o en el servidor local. El registro libre está desactivado y la contraseña mínima (12, con letras y números) se fija en `supabase/config.toml`.

**Aplicar una versión nueva** (después de `git pull`), sin perder datos:

```bash
npm run respaldar -- <carpeta>   # primero, un respaldo
npx supabase migration up        # aplica solo las migraciones nuevas; los datos se conservan
npm run web:start                # reconstruye el frontend
```

No use `npm run db:reset` en la instalación con datos reales: borra la base y la recrea vacía.

## Reglas de la base

- **Roles:** Administrador (global), Captura y Consulta (por empresa). Una persona puede tener roles distintos en empresas distintas.
- **Nada se borra.** Las bajas cambian `activo` a falso, exigen motivo y solo las hace el Administrador.
- **Bitácora:** cada alta y edición guarda el valor anterior y el nuevo.
- **Personal y ausencias:** solo los ven el Administrador y Captura.
- **«Aprobado por Dirección»:** marca informativa; solo la escribe el Administrador.
- **Secretos:** nunca en el repositorio. La clave `service_role` solo se usa en el entorno para crear el primer Administrador; el frontend usa la clave pública.
