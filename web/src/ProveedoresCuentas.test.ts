import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-10', leerTodo: async () => ({ data: [] }), dinero: String }))
const { partes } = await import('./ProveedoresCuentas')

describe('partes', () => {
  it('separa centro de costo y concepto en la estructura empresa-centro-concepto', () => {
    expect(partes({ codigo: '11-112-63-0110', centro_costo_codigo: null })).toEqual({ concepto: '63-0110', centro: '112' })
  })
  it('el centro registrado en la cuenta manda sobre el del código', () => {
    expect(partes({ codigo: '11-112-63-0110', centro_costo_codigo: '113' }).centro).toBe('113')
  })
  it('otro formato es su propio concepto', () => {
    expect(partes({ codigo: '6210-050', centro_costo_codigo: null })).toEqual({ concepto: '6210-050', centro: '' })
  })
})
