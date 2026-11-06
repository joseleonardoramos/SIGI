import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-06', leerTodo: async () => ({ data: [] }), dinero: String }))
const { enRD, tieneRespaldo } = await import('./Telecom')

describe('enRD', () => {
  it('convierte US$ a la tasa vigente y deja RD$ igual', () => {
    expect(enRD({ moneda: 'US$', monto: 100 }, 60.5)).toBe(6050)
    expect(enRD({ moneda: 'RD$', monto: 1500 }, 60.5)).toBe(1500)
  })
  it('sin tasa registrada no inventa un monto en RD$', () => {
    expect(enRD({ moneda: 'US$', monto: 100 }, null)).toBeNull()
  })
})

describe('tieneRespaldo', () => {
  it('exige dos accesos a internet (fijo o móvil)', () => {
    expect(tieneRespaldo([{ tipo: 'Internet' }, { tipo: 'Internet Móvil' }])).toBe(true)
    expect(tieneRespaldo([{ tipo: 'Internet' }, { tipo: 'Telefonía' }, { tipo: 'Metro Ethernet' }])).toBe(false)
  })
})
