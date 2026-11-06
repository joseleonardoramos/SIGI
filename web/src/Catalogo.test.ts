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
