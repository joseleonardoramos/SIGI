# SIGI: Sistema Integral de Gestión de Infraestructura
## Recomendaciones y requerimientos consolidados con backend Supabase

**Versión:** 3.1. **Fecha:** 4 de noviembre de 2026.
**Estado:** propuesta de diseño para revisión. No se ha desplegado infraestructura ni modificado los libros fuente.

## 1. Decisión tecnológica y alcance

Por decisión del usuario, Supabase será el backend. Se descartan ASP.NET Core, Azure SQL, Azure App Service, Azure Key Vault y Application Insights como componentes obligatorios de la arquitectura. No se requiere una API .NET ni una infraestructura propia en Azure.

Se mantienen los requerimientos funcionales previamente definidos. Esta versión reúne la arquitectura integral, la ampliación presupuestaria y las aclaraciones sobre gastos, cuentas y departamentos. Las especificaciones de Supabase siguientes son decisiones propuestas, no una certificación de disponibilidad, límites, costos o prestaciones de un plan contratado. Esos aspectos deben verificarse en la documentación oficial al implementar.

## 2. Módulos del sistema

| Módulo | Responsabilidades |
|---|---|
| Panel gerencial | Presupuesto, ejecución, proyecciones, servicios, activos, renovaciones y alertas |
| Presupuestos | Motor transversal para todas las categorías, empresas y ejercicios |
| Telecomunicaciones | Internet, MetroEthernet/MPLS, telefonía, troncales, DID, circuitos y contratos |
| Flotas móviles | Líneas, planes, SIM, IMEI, equipos, asignaciones, consumos y cambiazos |
| Software y suscripciones | Productos, licencias contratadas y asignadas, costos, vigencias y renovaciones |
| Activos de infraestructura | Servidores, redes, almacenamiento, seguridad, UPS, garantías y reposición |
| Contratos y proveedores | Cuentas de facturación, tarifas, documentos, vencimientos y condiciones |
| Personal y ausencias | Personal por empresa, vacaciones, permisos e incapacidades, con fechas y quién está fuera |
| Proyectos | Aperturas, remodelaciones, inversiones y servicios recurrentes derivados |
| Documentos y auditoría | Evidencias, cartas, bitácora de altas, ediciones y bajas, trazabilidad e importaciones |

Flotas se refiere a telefonía móvil. Categorías y subcategorías serán configurables sin cambios de código. El ERP seguirá siendo la autoridad contable; SIGI será el sistema de planificación y control operativo.

## 3. Arquitectura propuesta

| Capa | Componente propuesto | Uso |
|---|---|---|
| Interfaz | React y TypeScript | Portal operativo y gerencial; alojamiento independiente de Azure |
| Datos | PostgreSQL en Supabase | Registro transaccional, integridad y consultas consolidadas |
| Identidad | Supabase Auth | Autenticación y vínculo con membresías internas |
| Autorización | Políticas RLS y permisos de base de datos | Aislamiento por empresa y ámbito autorizado |
| Operaciones críticas | Funciones PostgreSQL/RPC | Reservas, compromisos, ejecución y reversos atómicos |
| Integraciones | Supabase Edge Functions en TypeScript | Validación de solicitudes, secretos y llamadas a sistemas externos |
| Archivos | Supabase Storage privado | Evidencias y archivos importados, con acceso restringido |
| Documentos existentes | SharePoint/OneDrive como fuentes externas | Lectura/importación autorizada, no backend obligatorio |
| Reportes | Vistas SQL y paneles React | Consolidación, navegación al detalle y exportaciones |
| Procesos prolongados | Trabajos persistidos y worker compatible con el despliegue | Importaciones y conciliaciones fuera del ciclo interactivo |
| Operación | Migraciones SQL, registros, alertas y respaldo | Entornos separados y recuperación verificable |

Diseño modular sobre una base de datos compartida, sin microservicios inicialmente. Supabase Realtime, si se utiliza, servirá para actualizar la interfaz, no para garantizar integridad financiera. Las transacciones y restricciones de PostgreSQL serán la autoridad.

### 3.1 Seguridad obligatoria

- RLS en todas las tablas expuestas y políticas de Storage. Denegar por defecto.
- Membresías por usuario, empresa, rol y alcance departamental; el cliente no puede asignarse permisos.
- Validar permisos en servidor y en funciones críticas, además de la interfaz.
- Nunca exponer claves privilegiadas en el navegador. Una clave pública no reemplaza las políticas RLS.
- Funciones privilegiadas con permisos mínimos, contexto controlado y validación explícita del usuario y la empresa.
- Registrar actor, fecha, motivo y evidencia de cada alta, edición y baja. Nada se borra físicamente: las bajas son lógicas y conservan el historial.
- Documentos privados y enlaces temporales cuando corresponda; no almacenar secretos en partidas o comentarios.
- Revisar que vistas, exportaciones, procesos en segundo plano y reportes respeten el mismo aislamiento.
- Copias y restauración tanto de base de datos como de archivos; verificar cobertura del plan elegido. No asumir que el respaldo de uno cubre el otro.
- SSO, MFA, retención, residencia de datos y recuperación sujetos a requisitos internos y validación del plan.

### 3.2 Integridad y ejecución financiera

- Dinero en tipos decimales, no en punto flotante; moneda y regla de redondeo explícitas.
- Bloqueos o concurrencia equivalente al reservar saldo para impedir sobregiros simultáneos.
- Claves de idempotencia para importaciones, webhooks y movimientos financieros.
- Operaciones relacionadas en una transacción: liberar reserva, crear compromiso y registrar auditoría.
- Versiones aprobadas inmutables; correcciones por ajustes o reversos trazables.
- Auditoría financiera independiente de los registros técnicos y protegida contra edición por usuarios operativos.
- Trabajos con estados, reintentos acotados, recuperación y seguimiento; no asumir ejecución ilimitada en Edge Functions.
- No ejecutar fórmulas arbitrarias importadas como SQL o código. Usar reglas permitidas y conservar el original como evidencia.

### 3.3 Integraciones sin dependencia de Azure

SharePoint/OneDrive y Microsoft Graph son integraciones opcionales con fuentes ya existentes, no el backend de SIGI. Su acceso requiere permisos y configuración de identidad Microsoft cuando aplique; no implica desplegar la aplicación en Azure. Supabase Auth será la identidad de la aplicación; cualquier federación corporativa se validará por separado.

Importaciones: archivo → almacenamiento privado → lote en staging → validaciones → revisión humana → incorporación transaccional. Tras la migración aprobada, la base de datos será el maestro operativo; Excel será histórico o intercambio, evitando dos maestros editables.

## 4. Presupuesto de gastos, cuentas y departamentos

### 4.1 Presupuesto de Gastos

El presupuesto de Gastos es la vista y control del OPEX, no un gasto adicional a los presupuestos de software, flotas y telecomunicaciones. Cada partida existe una sola vez y puede consultarse por módulo, cuenta, departamento o empresa. Las inversiones se mantienen separadas como CAPEX según reglas de Finanzas; no se clasifican únicamente por nombre de producto.

Se alimenta de módulos operativos, partidas directas y distribuciones vigentes. Otros gastos puede ser una categoría planificada: no equivale automáticamente a gasto fuera de presupuesto. El gasto no presupuestado debe identificarse expresamente y someterse a autorización.

### 4.2 Reglas de imputación

Clave funcional: empresa + ejercicio + versión + departamento/centro de costo + cuenta contable + concepto + período. Cuenta del proveedor y cuenta contable son dimensiones diferentes.

- Matriz configurable de combinaciones válidas de empresa, departamento, cuenta y categoría, con vigencia y responsable.
- No deducir departamento de segmentos del código contable sin catálogo oficial.
- Clasificar por naturaleza del gasto, no solo por proveedor. Una licencia facturada por un operador no debe duplicarse en telecomunicaciones.
- Distinguir departamento gestor, beneficiario y centro de costo imputado.
- Repartos compartidos con base explícita y vigencia; las asignaciones deben reconciliarse con el gasto original.
- Mantener jerarquías para consolidar, sin sumar simultáneamente padres y detalles.
- No asumir que las reglas de Catador aplican a Bona.

Pendiente de validación: catálogo oficial, correspondencias de centros de costo, reparto de servicios comunes, criterios CAPEX/OPEX, impuestos y matriz de autorizaciones. Estas reglas son diseño propuesto, no políticas contables ya aprobadas.

### 4.3 Calculadora de partidas presupuestarias

Nombre recomendado para el constructor de costos. Registra cantidad, unidad, precio, moneda, periodicidad, vigencia, descuentos, incrementos, impuestos y contingencia separados. Genera programación mensual y anual con supuestos auditables.

Plantillas: licencias por usuarios y departamento; flotas con datos/renta y equipos separados; telecomunicaciones por servicio y tarifa vigente; equipos con instalación y accesorios; mantenimiento por frecuencia; aperturas con inversión inicial y OPEX posterior. Permite simular cambios sin alterar la versión aprobada. No aprueba compras ni registra ejecución por sí sola.

## 5. Modelo integral de datos

- Empresa, sucursal, departamento, centro de costo, cuenta contable y matriz de imputación.
- Usuario, membresía, rol, permiso y ámbito autorizado.
- Proveedor, cuenta de proveedor, contrato, tarifa y servicio.
- Línea, plan, equipo, SIM, empleado y asignación con historial.
- Producto software, suscripción, licencia, asignación y renovación.
- Activo, garantía, mantenimiento y proyecto.
- Presupuesto, versión, partida, programación, supuesto y movimiento presupuestario.
- Factura, detalle, nota de crédito, distribución y conciliación ERP.
- Compromiso (orden o contrato), factura, pago y evidencia de ejecución.
- Documento, lote de importación, registro de origen, incidencia de calidad y auditoría.

Identificadores internos estables; un teléfono no es clave primaria. Cada dato importado conserva archivo, versión, hoja, fila/celda, fecha, fórmula original, valor y resultado de validación. Impedir asignaciones activas incompatibles.

## 6. Reglas operativas y aceptación general

Flujo: compromiso → factura → pago → cierre, con evidencia en cada paso. Dirección puede marcar «Aprobado por Dirección» como dato informativo; no bloquea ni crea flujos de aprobación. Bloquear validación definitiva si faltan fechas o evidencia vigente. Reglas de cambiazo y ventanas deben configurarse por empresa y versión del procedimiento, no fijarse como constantes universales.

Catálogo técnico y disponibilidad son fuentes diferentes. No afirmar existencias actuales con inventarios históricos. Las cartas se generan como borradores desde la plantilla de la empresa, para revisión y firma autorizada. La gama técnica y la clasificación por precio se conservan por separado; límites y tratamiento de centavos deben definirse explícitamente antes de automatizar.

Seguridad: ningún usuario puede acceder a otra empresa sin membresía; pruebas de RLS también sobre archivos, vistas y RPC. Solo el Administrador puede marcar «Aprobado por Dirección», dar de alta empresas y asignar roles; la marca es informativa y no bloquea registros. Ninguna operación concurrente debe descontar saldo dos veces. Ninguna importación con error se transforma silenciosamente en cero.

## 7. Implementación priorizada

1. Supabase, migraciones, catálogos, Auth, RLS, Storage privado y auditoría.
2. Motor presupuestario, staging, calidad de datos, versiones y control de saldo.
3. Telecomunicaciones, flotas, software, facturas y panel gerencial.
4. Activos, proyectos, reposición, aperturas, reparto avanzado e integraciones autorizadas.

Criterios técnicos pendientes: alojamiento frontend, plan Supabase, límites de ejecución, worker, estrategia de recuperación, objetivos de disponibilidad y residencia de datos. No se prometen capacidades de un plan sin validación.

---

# Parte III. Ampliación del módulo de presupuestos basada en los archivos aportados

**Estado:** propuesta de requerimientos para revisión. No implementada. No modifica los Excel de origen ni aprueba presupuestos.

## 1. Entendimiento de las fuentes

### P1. Plan Presupuesto TI 2026-2027

El libro contiene Dashboard, OPEX de infraestructura, CAPEX AF2027, activos fijos, gastos por áreas, detalles de mantenimiento y equipos no activos fijos, dominios, costo de licencias por usuario, licenciamiento por departamento, contactos, entrenamientos y consolidación de cuentas. Incluye una hoja técnica GVMetadata que no debe importarse como presupuesto.

El calendario presupuestario visible en OPEX y CAPEX abarca abril de 2026 a marzo de 2027. El detalle combina importes en pesos y dólares, compras puntuales, renovaciones y recurrencias. Existen estructuras jerárquicas de departamentos, totales y subtotales que no deben sumarse como si todos fueran transacciones. [P1] citeturn4search55

### P2. Presupuesto Infraestructura Bona 2026

El libro organiza CAPEX planificado y ejecutado, software, otros gastos, líneas de Internet y telefonía, flotas, aperturas/remodelaciones y cambios de computadoras. El calendario principal es enero a diciembre de 2026. Telecomunicaciones y flotas se expresan en pesos; varias secciones de software y CAPEX se presentan en dólares. Contiene presupuesto, ejecución, disponibilidad y detalle de compras. [P2] citeturn4search56

**Conclusión arquitectónica:** el módulo necesita dimensiones comunes y tipos de presupuesto especializados, no una copia de cada hoja de Excel como tabla independiente.


## 3. Requerimientos funcionales adicionales

Todas las filas siguientes son recomendaciones de diseño. P0: indispensable para una primera versión confiable. P1: siguiente incremento funcional.

| ID | Feature | Comportamiento requerido | Prioridad |
|---|---|---|---|
| PRE-01 | Calendarios fiscales configurables | Configurar inicio y cierre por empresa; soportar enero-diciembre y abril-marzo; conservar fecha real y período fiscal. | P0 |
| PRE-02 | Portafolio presupuestario | Crear presupuestos de telecomunicaciones, flotas, software, CAPEX, mantenimiento, alquileres, NAF, nube, honorarios y capacitación con un motor común. | P0 |
| PRE-03 | Dimensiones y jerarquías | Empresa, dirección, área, departamento, sucursal, centro de costo, cuenta, categoría y proyecto; vigencias y relaciones padre-hijo explícitas. | P0 |
| PRE-04 | Planificación mensual | Distribución uniforme, puntual, trimestral o personalizada; inicio y fin; prorrateo y meses sin servicio; conciliar anual y mensual. | P0 |
| PRE-05 | Multimoneda | Moneda de origen, moneda funcional y de reporte; tasas presupuestaria y real; fecha, fuente y versión; separar desviación cambiaria de variación de consumo/precio. | P0 |
| PRE-06 | Constructor de costos | Cantidad por precio unitario, periodicidad, descuentos, impuestos, incremento y contingencia separados; fórmula y supuestos auditables. | P0 |
| PRE-07 | Versiones y escenarios | Borrador, revisión, aprobado, vigente y cerrado; escenarios base, optimista y conservador; comparaciones y reforecast sin alterar el original. | P0 |
| PRE-08 | Control de ejecución | Presupuesto original y vigente, reserva, compromiso pendiente, ejecución, pago y disponible; movimientos parciales, cancelaciones y notas de crédito. | P0 |
| PRE-09 | Partidas fuera de presupuesto | Saldo negativo, ampliación y transferencia; se registran con motivo y evidencia, muestran el exceso y pueden marcarse como «Aprobado por Dirección» (informativo, sin flujo de aprobación). | P0 |
| PRE-10 | Renovaciones y recurrencias | Licencias, dominios, certificados, soporte, nube y alquileres; vencimiento, aviso configurable, renovación automática/manual y fecha límite de cancelación. | P0 |
| PRE-11 | Software por demanda | SKU, unidad de cobro, cantidad contratada/asignada, precio y vigencia; crecimiento por departamento y costo incremental de nuevos ingresos. | P1 |
| PRE-12 | Flotas desglosadas | Datos, renta, equipos, roaming y cargos adicionales; presupuesto por línea y agrupación; diferenciar compra puntual de distribución mensual. | P0 |
| PRE-13 | Telecomunicaciones por servicio | Servicio/circuito, proveedor, cuenta, localidad y plan; cambios de tarifa con fecha efectiva y escenarios de alta, baja o upgrade. | P0 |
| PRE-14 | Reposición y nuevos ingresos | Vincular activo actual, propuesta, cantidad, costo, departamento y fecha; separar reemplazo, compra nueva y mantenimiento; validar seriales duplicados. | P1 |
| PRE-15 | Aperturas y remodelaciones | Proyecto con lista de materiales, cantidades por local, instalación y servicios recurrentes; separar inversión inicial de OPEX posterior. | P1 |
| PRE-16 | Mantenimiento y consumibles | Artículo, cantidad, costo unitario, calendario, distribución por área y margen explícito; distinguir compra, inventario y consumo. | P1 |
| PRE-17 | Capacitación | Curso, proveedor, participante o vacante, fecha, moneda, cantidad y costos asociados; imputación al área sin evaluaciones de desempeño. | P1 |
| PRE-18 | Conciliación contable | Mapear cuentas por empresa; distribuir factura entre partidas y centros de costo; conciliar contra ERP y registrar partidas pendientes de clasificar. | P0 |
| PRE-19 | Importación inteligente y controlada | Mapear hojas, bloques y encabezados; identificar detalle/subtotal/resumen; preservar fórmulas, valores originales y coordenadas; previsualizar antes de confirmar. | P0 |
| PRE-20 | Calidad de datos | Detectar referencias rotas, autorreferencias, vacíos, tipos inválidos, duplicados, valores fuera de columnas y diferencias de totales. | P0 |
| PRE-21 | Consolidación sin doble conteo | Sumar solo partidas base; evitar repetir resúmenes, CAPEX planificado/ejecutado o el mismo gasto en software y telecomunicaciones. | P0 |
| PRE-22 | Reportes y alertas | Presupuesto contra ejecución mensual y acumulada, proyección de cierre, desviaciones, vencimientos y calidad de importación. | P0 |
| PRE-23 | Costos compartidos | Distribución por empresa/área con porcentaje o unidades y vigencia; mantener origen y asignaciones sin duplicar gasto consolidado. | P1 |
| PRE-24 | Trazabilidad | Autor, fecha, motivo y evidencia de cada cambio; bitácora de altas, ediciones y bajas; permisos por empresa; no sobrescribir versiones vigentes. | P0 |

### Reglas específicas de cálculo

- Disponible = presupuesto vigente aprobado menos reservas activas menos compromisos pendientes menos ejecución reconocida. Los estados deben ser mutuamente excluyentes para cada porción del importe.
- El pago no vuelve a disminuir el disponible si la ejecución ya lo hizo.
- Una recepción o factura parcial libera únicamente la porción correspondiente del compromiso.
- Proyección de cierre = ejecución al corte más estimación del gasto restante. La estimación incluye compromisos pendientes pertinentes y gasto no comprometido, sin sumarlos dos veces.
- Para comparar empresas con ejercicios distintos, usar fechas calendario equivalentes o mostrar explícitamente el período fiscal de cada una.
- No mezclar importes netos y brutos; el tratamiento de impuestos recuperables y no recuperables se define con Finanzas.
- Los factores observados en fórmulas no se convierten automáticamente en tasas tributarias oficiales.
- No inferir moneda, aprobación de Dirección ni ejecución a partir de formato, color, nombre de hoja o celda vacía.
- Un vacío es dato no informado; cero es un valor explícito. Ambos deben distinguirse en almacenamiento e interfaz.
- Los márgenes de contingencia se registran por separado y no se acumulan varias veces al consolidar detalles y resúmenes.

## 4. Ampliación del modelo de datos

Entidades propuestas, adicionales o especializadas respecto al modelo anterior:

- CalendarioFiscal y PeriodoFiscal: empresa, fechas reales, orden y estado de cierre.
- Presupuesto y VersionPresupuesto: ejercicio, escenario, estado y moneda de reporte.
- PartidaPresupuestaria: categoría, cuenta, centro de costo, recurso/proyecto vinculado y responsable.
- ProgramacionMensual: partida, período, importe original y convertido, tasa y criterio de distribución.
- SupuestoCosto: unidad, cantidad, precio, recurrencia, margen, incremento y vigencia.
- TipoCambioVersionado: par de monedas, tasa, fecha, fuente y propósito.
- MovimientoPresupuestario: reserva, compromiso, liberación, ejecución, reversión y ajuste, con documento de origen.
- DistribucionCosto: empresa/área destino, base de reparto y vínculo al gasto original.
- Renovacion: contrato, fecha, modalidad, preaviso y partida.
- LoteImportacion y RegistroOrigen: archivo, versión, hoja, celda/fila, fórmula, valor almacenado y clasificación de fila.
- IncidenciaCalidad: tipo, severidad, impacto, estado, revisor y resolución.
- Bitácora: acción, entidad, valor anterior, valor nuevo, usuario, fecha y motivo. Incluye la marca «Aprobado por Dirección» (quién y cuándo).

Restricciones: identificadores internos estables, importación idempotente, precisión decimal para dinero, transacciones atómicas para reservar saldo y concurrencia controlada. El detalle presupuestario debe ser la fuente de los resúmenes, no al revés.

## 5. Pantallas y experiencia de usuario

1. Portafolio de presupuestos por empresa, ejercicio y estado.
2. Editor de partidas con vista anual y matriz mensual.
3. Constructor de costos y simulador de escenarios.
4. Partidas fuera de presupuesto, transferencias y excepciones, con la marca «Aprobado por Dirección».
5. Seguimiento de ejecución y documentos vinculados.
6. Calendario de renovaciones y compromisos futuros.
7. Plan de reposición, aperturas y demanda de licencias.
8. Centro de importaciones con previsualización y cuarentena.
9. Panel gerencial con navegación hasta factura y celda de origen.

Filtros comunes: empresa, período, categoría, centro de costo, sucursal, proveedor, moneda y proyecto. Cada pantalla debe indicar si muestra planificación, ejecución o proyección y la fecha de corte.

## 6. Indicadores propuestos

- Presupuesto vigente, ejecutado, comprometido pendiente y disponible.
- Desviación mensual y acumulada, absoluta y porcentual.
- Proyección de cierre y exceso proyectado.
- Impacto por tipo de cambio separado de precio y cantidad.
- Gasto recurrente frente a inversión o gasto puntual.
- Costo de licencias por departamento y costo incremental por nuevo ingreso.
- Costo de telecomunicaciones por sucursal y flotas por área.
- Renovaciones pendientes y exposición financiera futura.
- Partidas sin cuenta, moneda o programación completa.
- Importes en cuarentena y discrepancias pendientes de resolver.

Si el presupuesto es cero, la desviación porcentual se muestra como no aplicable y se destaca el gasto no presupuestado, sin dividir entre cero.


---

## 8. Roles, personal y bitácora (versión 3.1)

**Roles.** Una persona puede tener roles distintos en empresas distintas. Cada membresía es una combinación de usuario, empresa y rol.

| Rol | Alcance | Puede |
|---|---|---|
| Administrador | Global: todas las empresas. Es el Gerente de infraestructura. | Crear empresas, asignar roles, dar de alta y de baja cuentas, servicios, líneas y personal, y marcar «Aprobado por Dirección». |
| Captura | Empresas asignadas | Registrar y editar datos de operación. |
| Consulta | Empresas asignadas | Ver. |

No hay flujos de aprobación. SIGI es un sistema de control para la gerencia de infraestructura: registra datos para obtener indicadores de la operación.

**Historial.** Nada se borra físicamente. Las bajas son lógicas: la cuenta, servicio, línea o persona queda inactiva con fecha, motivo y usuario. Las correcciones se registran como un movimiento nuevo (nota de crédito o reverso). Toda alta, edición, baja y marca de «Aprobado por Dirección» queda en la bitácora con el valor anterior y el nuevo.

**Marca «Aprobado por Dirección».** Dato informativo que se puede poner en un gasto, en una partida fuera de presupuesto o en una categoría con exceso. Guarda quién la marcó y cuándo. Solo la marca el Administrador, y puede quitarse; el cambio queda en la bitácora. No bloquea registros.

**Personal y ausencias.** Registro de personas por empresa y área, con cargo y estado activo o inactivo. Registro de ausencias: vacaciones, permisos, incapacidades y viajes, con persona, tipo, fecha de inicio, fecha de fin, días hábiles (calculados), quién lo cubre (opcional), nota y estado.

Reglas:
- Una persona no puede tener dos ausencias que se traslapen, salvo las canceladas.
- Los estados se calculan por fechas: Programada, En curso y Finalizada. Cancelada se marca a mano y el registro se conserva.
- El panel gerencial muestra «Personal fuera hoy» con los nombres de quienes tienen una ausencia en curso.
- Una persona dada de baja deja de aceptar ausencias nuevas, pero su historial se conserva.
- Reportes: quién está fuera hoy, ausencias de los próximos 30 días e historial por persona.
