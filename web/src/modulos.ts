import type { Fila, Modulo } from './Catalogo'
import { supabase, fechaLocal, leerTodo } from './supabase'

// Configuración de cada catálogo que usa la pantalla genérica (Catalogo.tsx).
// Las listas de opciones repiten las restricciones de la base, que es la que decide.

const MONEDAS = ['RD$', 'US$']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const s = (v: unknown) => (v == null ? '' : String(v))

const proveedor = { tabla: 'proveedores', global: true, etiqueta: (f: Fila) => s(f.nombre) }
const cuentaProveedor = {
  tabla: 'cuentas_proveedor',
  select: '*, proveedores(nombre)',
  etiqueta: (f: Fila) => `${s((f.proveedores as { nombre?: string } | null)?.nombre)} · ${s(f.numero)}`,
}

// Maestro de áreas y departamentos (listas desplegables). El departamento depende del área elegida.
const area = { tabla: 'areas', etiqueta: (f: Fila) => s(f.nombre) }
const departamentoDelArea = { tabla: 'departamentos', etiqueta: (f: Fila) => s(f.nombre), filtrarPor: { campo: 'area_id', columna: 'area_id' } }
const departamento = { tabla: 'departamentos', select: '*, areas(nombre)', etiqueta: (f: Fila) => `${s((f.areas as { nombre?: string } | null)?.nombre)} · ${s(f.nombre)}` }

export const MODULOS: Record<string, Modulo> = {
  telecom: {
    id: 'telecom', titulo: 'Telecomunicaciones', tabla: 'servicios_telecom', orden: { k: 'sucursal' }, agrupar: ['sucursal'],
    total: { k: 'monto', label: 'Monto mensual activo' },
    campos: [
      { k: 'sucursal', label: 'Sucursal', obligatorio: true },
      { k: 'ciudad', label: 'Ubicación' },
      { k: 'proveedor_id', label: 'Proveedor', tipo: 'ref', ref: proveedor },
      { k: 'cuenta_proveedor_id', label: 'Cuenta proveedor', tipo: 'ref', ref: cuentaProveedor },
      { k: 'tipo', label: 'Tipo', tipo: 'opciones', opciones: ['Internet', 'Telefonía', 'Metro Ethernet', 'Internet Móvil'], obligatorio: true },
      { k: 'detalle', label: 'Detalle', obligatorio: true },
      { k: 'velocidad', label: 'Velocidad' },
      { k: 'moneda', label: 'Moneda', tipo: 'opciones', opciones: MONEDAS, defecto: 'RD$', obligatorio: true },
      { k: 'monto', label: 'Monto', tipo: 'numero', obligatorio: true },
      { k: 'circuito', label: 'No. circuito' },
      { k: 'cuenta_contable', label: 'Cuenta contable' },
      { k: 'estatus', label: 'Estatus', defecto: 'Activo', obligatorio: true },
      { k: 'vence', label: 'Vence', tipo: 'fecha', oculto: true },
      { k: 'comentarios', label: 'Comentarios', oculto: true },
    ],
  },
  flotas: {
    id: 'flotas', titulo: 'Flotas móviles', tabla: 'lineas_flota', orden: { k: 'numero' }, agrupar: ['area_id', 'departamento_id'],
    total: { k: 'costo_mensual', label: 'Costo mensual (sin canceladas)', si: (f) => f.estado !== 'Cancelada' },
    nota: 'Para cancelar una línea, cambie su estado a «Cancelada»: deja de sumar en los totales y se conserva.',
    campos: [
      { k: 'numero', label: 'Número', obligatorio: true },
      { k: 'sim', label: 'Tarjeta SIM', oculto: true },
      { k: 'usuario', label: 'Nombre' },
      { k: 'area_id', label: 'Área', tipo: 'ref', ref: area, obligatorio: true },
      { k: 'departamento_id', label: 'Departamento', tipo: 'ref', ref: departamentoDelArea, obligatorio: true },
      { k: 'cuenta_proveedor_id', label: 'Cuenta proveedor', tipo: 'ref', ref: cuentaProveedor },
      { k: 'datos', label: 'Datos', tipo: 'si_no', defecto: true },
      { k: 'cantidad', label: 'Cantidad' },
      { k: 'costo_mensual', label: 'Precio', tipo: 'numero', obligatorio: true },
      { k: 'estado', label: 'Estado', tipo: 'opciones', opciones: ['Sin alerta', 'Sin uso 90 días', 'Cambiazo elegible', 'Suspendida', 'Cancelada'], defecto: 'Sin alerta', obligatorio: true },
      { k: 'fecha_alta', label: 'Fecha creación', tipo: 'fecha', obligatorio: true, defecto: fechaLocal() },
      { k: 'fecha_cambiazo', label: 'Fecha cambiazo', tipo: 'fecha' },
    ],
  },
  software: {
    id: 'software', titulo: 'Software y suscripciones', tabla: 'productos_software', orden: { k: 'nombre' },
    campos: [
      { k: 'nombre', label: 'Producto', obligatorio: true },
      { k: 'tipo', label: 'Tipo', tipo: 'opciones', opciones: ['SaaS', 'PaaS', 'IaaS', 'Licencia', 'Certificado'], obligatorio: true },
      { k: 'proveedor_id', label: 'Proveedor', tipo: 'ref', ref: proveedor },
      { k: 'cuenta_proveedor_id', label: 'Cuenta proveedor', tipo: 'ref', ref: cuentaProveedor, oculto: true },
      { k: 'unidad', label: 'Unidad', defecto: 'Usuario', obligatorio: true },
      { k: 'contratadas', label: 'Contratadas', tipo: 'numero', obligatorio: true },
      { k: 'asignadas', label: 'Asignadas', tipo: 'numero', defecto: '0', obligatorio: true },
      { k: 'precio_unitario', label: 'Precio unitario', tipo: 'numero', obligatorio: true },
      { k: 'moneda', label: 'Moneda', tipo: 'opciones', opciones: MONEDAS, defecto: 'US$', obligatorio: true },
      { k: 'periodicidad', label: 'Periodicidad', tipo: 'opciones', opciones: ['Mensual', 'Anual', 'Por consumo'], obligatorio: true },
      { k: 'inicio', label: 'Inicio', tipo: 'fecha', obligatorio: true },
      { k: 'vence', label: 'Vence', tipo: 'fecha' },
      { k: 'renovacion', label: 'Renovación', tipo: 'opciones', opciones: ['Automática', 'Manual', 'Por consumo'], obligatorio: true },
      { k: 'preaviso_dias', label: 'Preaviso (días)', tipo: 'numero', defecto: '0', obligatorio: true, oculto: true },
      { k: 'cuenta_contable', label: 'Cuenta contable', oculto: true },
    ],
  },
  versiones: {
    id: 'versiones', titulo: 'Versiones de presupuesto', tabla: 'presupuestos_versiones', orden: { k: 'ejercicio', asc: false },
    nota: 'Una versión «Cerrado» ya no acepta compromisos nuevos; las facturas tardías sí.',
    campos: [
      { k: 'ejercicio', label: 'Ejercicio (2026 o 2026-2027)', obligatorio: true },
      { k: 'numero', label: 'Versión', tipo: 'numero', defecto: '1', obligatorio: true },
      { k: 'escenario', label: 'Escenario', defecto: 'Base', obligatorio: true },
      { k: 'estado', label: 'Estado', tipo: 'opciones', opciones: ['Borrador', 'Vigente', 'Cerrado'], defecto: 'Borrador', obligatorio: true },
    ],
  },
  partidas: {
    id: 'partidas', titulo: 'Partidas de presupuesto', tabla: 'partidas', orden: { k: 'codigo' },
    total: { k: 'monto', label: 'Presupuesto total' },
    campos: [
      { k: 'version_id', label: 'Versión', tipo: 'ref', obligatorio: true, ref: { tabla: 'presupuestos_versiones', etiqueta: (f) => `${s(f.ejercicio)} · v${s(f.numero)} (${s(f.estado)})` } },
      { k: 'codigo', label: 'Código', obligatorio: true },
      { k: 'nombre', label: 'Nombre', obligatorio: true },
      { k: 'categoria', label: 'Categoría', obligatorio: true },
      { k: 'centro_costo_codigo', label: 'Centro de costo' },
      { k: 'cuenta_contable', label: 'Cuenta contable' },
      { k: 'distribucion', label: 'Distribución', tipo: 'opciones', opciones: ['Uniforme', 'Trimestral', ...MESES.map((m) => `Puntual · ${m}`)], defecto: 'Uniforme', obligatorio: true },
      { k: 'monto', label: 'Presupuesto', tipo: 'numero', obligatorio: true },
    ],
    extra: {
      columnas: [{ k: 'comprometido', label: 'Comprometido' }, { k: 'ejecutado', label: 'Ejecutado' }, { k: 'disponible', label: 'Disponible' }],
      cargar: async (empresa) => {
        const { data } = await leerTodo<{ partida_id: string }>((desde, hasta) =>
          supabase.from('saldo_partidas').select('partida_id, comprometido, ejecutado, disponible').eq('empresa_id', empresa).order('partida_id').range(desde, hasta))
        return Object.fromEntries(data.map((r) => [r.partida_id, r]))
      },
    },
  },
  activos: {
    id: 'activos', titulo: 'Activos de infraestructura', tabla: 'activos', orden: { k: 'categoria' },
    nota: 'El serial no se repite en la empresa. Un activo retirado se conserva con su historial.',
    campos: [
      { k: 'categoria', label: 'Categoría', tipo: 'opciones', opciones: ['Servidor', 'Red', 'Almacenamiento', 'Seguridad', 'UPS', 'Equipo de usuario', 'Otro'], obligatorio: true },
      { k: 'nombre', label: 'Nombre', obligatorio: true },
      { k: 'marca_modelo', label: 'Marca y modelo' },
      { k: 'serial', label: 'Serial' },
      { k: 'sucursal', label: 'Sucursal' },
      { k: 'responsable', label: 'Responsable', oculto: true },
      { k: 'proveedor_id', label: 'Proveedor', tipo: 'ref', ref: proveedor, oculto: true },
      { k: 'fecha_compra', label: 'Fecha de compra', tipo: 'fecha', oculto: true },
      { k: 'costo', label: 'Costo', tipo: 'numero' },
      { k: 'moneda', label: 'Moneda', tipo: 'opciones', opciones: MONEDAS, defecto: 'RD$', obligatorio: true },
      { k: 'garantia_hasta', label: 'Garantía hasta', tipo: 'fecha' },
      { k: 'estado', label: 'Estado', tipo: 'opciones', opciones: ['En uso', 'En reparación', 'Para reponer', 'Retirado'], defecto: 'En uso', obligatorio: true },
    ],
  },
  reposiciones: {
    id: 'reposiciones', titulo: 'Plan de reposición', tabla: 'reposiciones', orden: { k: 'fecha_prevista' },
    total: { k: 'costo', label: 'Costo pendiente', si: (f) => f.estado === 'Propuesta' || f.estado === 'Presupuestada' },
    nota: 'Reemplazo y mantenimiento exigen el activo actual; una compra nueva no.',
    campos: [
      { k: 'tipo', label: 'Tipo', tipo: 'opciones', opciones: ['Reemplazo', 'Compra nueva', 'Mantenimiento'], defecto: 'Reemplazo', obligatorio: true },
      { k: 'activo_id', label: 'Activo actual', tipo: 'ref', ref: { tabla: 'activos', etiqueta: (f) => `${s(f.nombre)}${f.serial ? ` · ${s(f.serial)}` : ''}` } },
      { k: 'descripcion', label: 'Propuesta', obligatorio: true },
      { k: 'cantidad', label: 'Cantidad', tipo: 'numero', defecto: '1', obligatorio: true },
      { k: 'costo', label: 'Costo total (todas las unidades)', tipo: 'numero' },
      { k: 'moneda', label: 'Moneda', tipo: 'opciones', opciones: MONEDAS, defecto: 'RD$', obligatorio: true },
      { k: 'departamento_id', label: 'Departamento', tipo: 'ref', ref: departamento },
      { k: 'fecha_prevista', label: 'Fecha prevista', tipo: 'fecha' },
      { k: 'estado', label: 'Estado', tipo: 'opciones', opciones: ['Propuesta', 'Presupuestada', 'Ejecutada', 'Descartada'], defecto: 'Propuesta', obligatorio: true },
    ],
  },
  proyectos: {
    id: 'proyectos', titulo: 'Proyectos y aperturas', tabla: 'proyectos', orden: { k: 'inicio', asc: false },
    total: { k: 'inversion_inicial', label: 'Inversión inicial', si: (f) => f.estado !== 'Cancelado' },
    nota: 'La inversión inicial (CAPEX) va separada del OPEX mensual que el proyecto deja después.',
    campos: [
      { k: 'nombre', label: 'Proyecto', obligatorio: true },
      { k: 'tipo', label: 'Tipo', tipo: 'opciones', opciones: ['Apertura', 'Remodelación', 'Inversión'], defecto: 'Apertura', obligatorio: true },
      { k: 'sucursal', label: 'Sucursal' },
      { k: 'inicio', label: 'Inicio', tipo: 'fecha' },
      { k: 'fin', label: 'Fin', tipo: 'fecha' },
      { k: 'estado', label: 'Estado', tipo: 'opciones', opciones: ['Planificado', 'En ejecución', 'Terminado', 'Cancelado'], defecto: 'Planificado', obligatorio: true },
      { k: 'inversion_inicial', label: 'Inversión inicial', tipo: 'numero', defecto: '0', obligatorio: true },
      { k: 'opex_mensual', label: 'OPEX mensual después', tipo: 'numero', defecto: '0', obligatorio: true },
      { k: 'moneda', label: 'Moneda', tipo: 'opciones', opciones: MONEDAS, defecto: 'RD$', obligatorio: true },
      { k: 'nota', label: 'Nota', oculto: true },
    ],
  },
  personas: {
    id: 'personas', titulo: 'Personal', tabla: 'personas', orden: { k: 'nombre' },
    nota: 'Una persona dada de baja no acepta ausencias nuevas; su historial se conserva.',
    campos: [
      { k: 'nombre', label: 'Nombre', obligatorio: true },
      { k: 'cargo', label: 'Cargo' },
      { k: 'area_id', label: 'Área', tipo: 'ref', ref: area },
    ],
  },
  ausencias: {
    id: 'ausencias', titulo: 'Ausencias', tabla: 'ausencias', orden: { k: 'desde', asc: false },
    nota: 'Si una ausencia fue un error, márquela como cancelada: se conserva y deja de contar.',
    campos: [
      { k: 'persona_id', label: 'Persona', tipo: 'ref', obligatorio: true, ref: { tabla: 'personas', etiqueta: (f) => s(f.nombre) } },
      { k: 'tipo', label: 'Tipo', tipo: 'opciones', opciones: ['Vacaciones', 'Permiso', 'Incapacidad', 'Viaje', 'Otro'], defecto: 'Vacaciones', obligatorio: true },
      { k: 'desde', label: 'Desde', tipo: 'fecha', obligatorio: true },
      { k: 'hasta', label: 'Hasta', tipo: 'fecha', obligatorio: true },
      { k: 'cobertura', label: 'Lo cubre' },
      { k: 'nota', label: 'Nota', oculto: true },
      { k: 'cancelada', label: 'Cancelada', tipo: 'si_no' },
    ],
  },
  proveedores: {
    id: 'proveedores', titulo: 'Proveedores (maestro)', tabla: 'proveedores', global: true, soloAdmin: true, orden: { k: 'nombre' },
    campos: [
      { k: 'nombre', label: 'Nombre', obligatorio: true },
      { k: 'rnc', label: 'RNC (9 u 11 dígitos)' },
      { k: 'categorias', label: 'Categorías', tipo: 'lista' },
    ],
  },
  cuentas_proveedor: {
    id: 'cuentas_proveedor', titulo: 'Cuentas de proveedor', tabla: 'cuentas_proveedor', soloAdmin: true, orden: { k: 'numero' },
    campos: [
      { k: 'proveedor_id', label: 'Proveedor', tipo: 'ref', ref: proveedor, obligatorio: true },
      { k: 'numero', label: 'Número de cuenta', obligatorio: true },
      { k: 'descripcion', label: 'Descripción' },
      { k: 'moneda', label: 'Moneda', tipo: 'opciones', opciones: MONEDAS, defecto: 'RD$', obligatorio: true },
    ],
  },
  cuentas_contables: {
    id: 'cuentas_contables', titulo: 'Cuentas contables', tabla: 'cuentas_contables', soloAdmin: true, orden: { k: 'codigo' },
    campos: [
      { k: 'codigo', label: 'Código', obligatorio: true },
      { k: 'descripcion', label: 'Descripción', obligatorio: true },
      { k: 'tipo', label: 'Tipo', tipo: 'opciones', opciones: ['OPEX', 'CAPEX'], defecto: 'OPEX', obligatorio: true },
      { k: 'categoria', label: 'Categoría', obligatorio: true },
      { k: 'centro_costo_codigo', label: 'Centro de costo (3 dígitos)' },
      { k: 'estado', label: 'Estado', tipo: 'opciones', opciones: ['Activa', 'Nueva', 'Inactiva'], defecto: 'Activa', obligatorio: true },
    ],
  },
  areas: {
    id: 'areas', titulo: 'Áreas', tabla: 'areas', soloAdmin: true, orden: { k: 'nombre' },
    nota: 'Las áreas aparecen como lista en Flotas, Personal y Reposición. Cada área tiene sus departamentos.',
    campos: [{ k: 'nombre', label: 'Área', obligatorio: true }],
  },
  departamentos: {
    id: 'departamentos', titulo: 'Departamentos', tabla: 'departamentos', soloAdmin: true, orden: { k: 'nombre' }, agrupar: ['area_id'],
    nota: 'El nombre no se repite dentro de un área. También se cargan desde Importar CSV → Áreas y departamentos.',
    campos: [
      { k: 'area_id', label: 'Área', tipo: 'ref', ref: area, obligatorio: true },
      { k: 'nombre', label: 'Departamento', obligatorio: true },
    ],
  },
  centros_costo: {
    id: 'centros_costo', titulo: 'Centros de costo', tabla: 'centros_costo', soloAdmin: true, orden: { k: 'codigo' },
    campos: [
      { k: 'codigo', label: 'Código (3 dígitos)', obligatorio: true },
      { k: 'nombre', label: 'Nombre', obligatorio: true },
    ],
  },
  tasas: {
    id: 'tasas', titulo: 'Tasas de cambio', tabla: 'tasas_cambio', global: true, soloAdmin: true, orden: { k: 'vigente_desde', asc: false },
    nota: 'Cada cambio es una fila nueva con su fecha. Los gastos guardan la tasa vigente el día en que se comprometen.',
    campos: [
      { k: 'moneda', label: 'Moneda', tipo: 'opciones', opciones: ['US$'], defecto: 'US$', obligatorio: true },
      { k: 'vigente_desde', label: 'Vigente desde', tipo: 'fecha', obligatorio: true },
      { k: 'tasa', label: 'RD$ por US$', tipo: 'numero', obligatorio: true },
      { k: 'fuente', label: 'Fuente', defecto: 'Banco Central', obligatorio: true },
    ],
  },
}
