import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-10', leerTodo: async () => ({ data: [] }), dinero: String }))
const { cifras, sumar } = await import('./Presupuestos')

describe('cifras', () => {
  it('separa lo comprometido sin facturar y el exceso', () => {
    expect(cifras({ presupuesto: 1000, comprometido: 600, ejecutado: 450, disponible: 400 }))
      .toEqual({ presupuesto: 1000, ejecutado: 450, disponible: 400, pendiente: 150, exceso: 0 })
    expect(cifras({ presupuesto: 100, comprometido: 0, ejecutado: 130, disponible: -30 })).toMatchObject({ pendiente: 0, exceso: 30 })
  })
})

describe('sumar', () => {
  it('suma los excesos sin compensarlos con saldos libres', () => {
    const t = sumar([cifras({ presupuesto: 100, comprometido: 0, ejecutado: 50, disponible: 50 }), cifras({ presupuesto: 100, comprometido: 0, ejecutado: 120, disponible: -20 })])
    expect(t).toMatchObject({ presupuesto: 200, ejecutado: 170, disponible: 30, exceso: 20 })
    expect(sumar([])).toMatchObject({ presupuesto: 0, exceso: 0 })
  })
})
