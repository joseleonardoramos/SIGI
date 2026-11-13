import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-04' }))
const { aDatos, agruparPor } = await import('./Catalogo')

describe('agruparPor', () => {
  it('agrupa en orden alfabético y junta los vacíos en «(sin dato)»', () => {
    const filas = [{ s: 'Santiago' }, { s: 'Bávaro' }, { s: '' }, { s: 'Santiago' }]
    expect(agruparPor(filas, (f) => f.s).map(([k, v]) => `${k}:${v.length}`)).toEqual(['(sin dato):1', 'Bávaro:1', 'Santiago:2'])
  })
})
const { MODULOS } = await import('./modulos')
const { opcionesRef } = await import('./Catalogo')

describe('opcionesRef (cuenta contable)', () => {
  const campo = MODULOS.telecom.campos.find((c) => c.k === 'cuenta_contable')!
  const cuentas = [
    { id: '1', activo: true, codigo: '6105-021', descripcion: 'Metro Ethernet', estado: 'Activa' },
    { id: '2', activo: true, codigo: '6105-020', descripcion: 'Internet', estado: 'Nueva' },
    { id: '3', activo: true, codigo: '6105-099', descripcion: 'Vieja', estado: 'Inactiva' },
  ]
  const opciones = (actual: string) => opcionesRef(campo, cuentas, { cuenta_contable: actual }).map((o) => [o.props.value, o.props.children])

  it('ofrece las cuentas por su código, en orden, sin las inactivas', () => {
    expect(opciones('')).toEqual([['6105-020', '6105-020 · Internet'], ['6105-021', '6105-021 · Metro Ethernet']])
  })
  it('conserva el valor guardado aunque no esté disponible', () => {
    expect(opciones('6105-099')[0]).toEqual(['6105-099', '6105-099 · Vieja (no disponible)'])
    expect(opciones('11-999-63-0115')[0]).toEqual(['11-999-63-0115', '11-999-63-0115 (no está en el catálogo)'])
  })
})

describe('aDatos', () => {
  it('convierte montos con comas, vacíos a nulo y casillas a booleano', () => {
    const { datos } = aDatos(MODULOS.flotas, {
      numero: '809-555-0001', sim: '', usuario: '', area_id: 'a1', departamento_id: 'd1', cuenta_proveedor_id: '',
      datos: false, cantidad: '', costo_mensual: '1,250.50', estado: 'Sin alerta', fecha_alta: '2026-11-04', fecha_cambiazo: '',
    })
    expect(datos).toMatchObject({ costo_mensual: 1250.5, datos: false, sim: null, fecha_cambiazo: null, cuenta_proveedor_id: null })
  })

  it('exige los campos obligatorios y números válidos', () => {
    expect(aDatos(MODULOS.centros_costo, { codigo: '', nombre: 'X' }).error).toBe('Falta «Código (3 dígitos)».')
    expect(aDatos(MODULOS.tasas, { moneda: 'US$', vigente_desde: '2026-11-04', tasa: 'sesenta', fuente: 'BC' }).error)
      .toBe('«RD$ por US$» debe ser un número.')
  })

  it('convierte listas separadas por punto y coma', () => {
    expect(aDatos(MODULOS.proveedores, { nombre: 'Claro', rnc: '', categorias: 'Telecom; Flotas;' }).datos)
      .toMatchObject({ categorias: ['Telecom', 'Flotas'], rnc: null })
  })
})
