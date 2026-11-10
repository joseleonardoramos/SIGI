import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-10', leerTodo: async () => ({ data: [] }), dinero: String }))
const { renovacion, muchasLibres } = await import('./Software')
const { diasEntre, sumarDias } = await import('./comun')

describe('fechas', () => {
  it('cuenta días y resta el preaviso', () => {
    expect(diasEntre('2026-11-10', '2026-12-10')).toBe(30)
    expect(sumarDias('2027-01-15', -30)).toBe('2026-12-16')
  })
})

describe('renovacion', () => {
  const hoy = '2026-11-10'
  it('sin vencimiento no hay renovación', () => {
    expect(renovacion({ vence: null, preaviso_dias: 30, renovacion: 'Manual' }, hoy)).toBeNull()
  })
  it('avisa según el plazo de cancelación (vencimiento − preaviso)', () => {
    expect(renovacion({ vence: '2026-12-01', preaviso_dias: 30, renovacion: 'Automática' }, hoy)?.aviso).toBe('Renueva sola · plazo vencido')
    expect(renovacion({ vence: '2026-12-01', preaviso_dias: 30, renovacion: 'Manual' }, hoy)?.aviso).toBe('Gestionar renovación ya')
    expect(renovacion({ vence: '2026-12-20', preaviso_dias: 30, renovacion: 'Manual' }, hoy)?.aviso).toBe('Decidir antes del 20 nov')
    expect(renovacion({ vence: '2027-06-01', preaviso_dias: 30, renovacion: 'Manual' }, hoy)?.aviso).toBe('En plazo')
  })
})

describe('muchasLibres', () => {
  it('marca más del 10 % sin asignar, solo con más de una unidad', () => {
    expect(muchasLibres({ contratadas: 100, asignadas: 85 })).toBe(true)
    expect(muchasLibres({ contratadas: 100, asignadas: 90 })).toBe(false)
    expect(muchasLibres({ contratadas: 1, asignadas: 0 })).toBe(false)
  })
})
