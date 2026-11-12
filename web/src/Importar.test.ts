import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '' }))
const { explicar } = await import('./Importar')

describe('explicar', () => {
  it('describe en palabras qué se hará con cada fila', () => {
    expect(explicar({ fila: 2, accion: 'nueva', valores: { Número: '809-555-0001', Cantidad: null, 'Fecha creación': '2025-03-15' } }))
      .toBe('Número: 809-555-0001 · Fecha creación: 2025-03-15')
    expect(explicar({ fila: 3, accion: 'cambio', cambios: [{ campo: 'Monto', antes: '1500.00', despues: '1800' }, { campo: 'RNC', despues: '101010101' }] }))
      .toBe('Monto: 1500.00 → 1800 · RNC: (vacío) → 101010101')
    expect(explicar({ fila: 4, accion: 'igual' })).toBe('Ya existe igual en SIGI: se omite.')
    expect(explicar({ fila: 5, accion: 'vacia' })).toBe('Fila vacía: se omite.')
    expect(explicar({ fila: 6, accion: 'error', mensaje: 'Falta «Monto»' })).toBe('Falta «Monto»')
  })
})
