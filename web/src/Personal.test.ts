import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-10', leerTodo: async () => ({ data: [] }), dinero: String }))
const { describir, diasHabiles, estadoAusencia, regreso } = await import('./Personal')

describe('días hábiles y regreso', () => {
  const sin = new Set<string>()
  it('cuenta de lunes a viernes, ambas fechas incluidas', () => {
    expect(diasHabiles('2026-11-09', '2026-11-15', sin)).toBe(5) // lunes a domingo
    expect(diasHabiles('2026-11-14', '2026-11-15', sin)).toBe(0) // fin de semana
  })
  it('regresa el siguiente día hábil', () => {
    expect(regreso('2026-11-13', sin)).toBe('2026-11-16') // termina viernes → lunes
    expect(regreso('2026-11-10', sin)).toBe('2026-11-11')
  })
  it('descuenta los feriados y no regresa en feriado', () => {
    const feriados = new Set(['2026-12-25'])
    expect(diasHabiles('2026-12-21', '2026-12-25', feriados)).toBe(4) // lunes a viernes, viernes feriado
    expect(regreso('2026-12-24', feriados)).toBe('2026-12-28') // jueves → viernes feriado → lunes
    expect(diasHabiles('2026-12-26', '2026-12-27', feriados)).toBe(0) // un feriado en fin de semana no resta dos veces
  })
})

describe('estadoAusencia', () => {
  const hoy = '2026-11-10'
  it('distingue cancelada, finalizada, en curso y programada', () => {
    expect(estadoAusencia({ cancelada: true, desde: '2026-11-01', hasta: '2026-11-20' }, hoy)).toBe('Cancelada')
    expect(estadoAusencia({ cancelada: false, desde: '2026-11-01', hasta: '2026-11-09' }, hoy)).toBe('Finalizada')
    expect(estadoAusencia({ cancelada: false, desde: '2026-11-10', hasta: '2026-11-10' }, hoy)).toBe('En curso')
    expect(estadoAusencia({ cancelada: false, desde: '2026-11-11', hasta: '2026-11-12' }, hoy)).toBe('Programada')
  })
})

describe('describir', () => {
  it('pone en palabras los eventos de la bitácora', () => {
    expect(describir({ tabla: 'personas', accion: 'INSERT', antes: null, despues: {} })).toBe('Alta de persona')
    expect(describir({ tabla: 'ausencias', accion: 'UPDATE', antes: { cancelada: false, activo: true }, despues: { cancelada: true, activo: true } })).toBe('Cancelación de ausencia')
    expect(describir({ tabla: 'personas', accion: 'UPDATE', antes: { activo: true }, despues: { activo: false } })).toBe('Baja de persona')
  })
})
