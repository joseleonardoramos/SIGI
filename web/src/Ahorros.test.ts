import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-11', leerTodo: async () => ({ data: [] }), dinero: String }))
const { ahorroAnual, cuenta, enEjercicio, ahorroDe } = await import('./ahorro')
const { mesesDelEjercicio } = await import('./panelDatos')

const meses = mesesDelEjercicio('2026', 1) // ene–dic 2026
const ini = (fecha_efectiva: string) => ({ linea_base: 1200, costo_nuevo: 0, fecha_efectiva })

describe('ahorro de una iniciativa', () => {
  it('el anual es la línea base menos el costo nuevo', () => {
    expect(ahorroAnual({ linea_base: 4830, costo_nuevo: 3220 })).toBe(1610)
  })
  it('en el ejercicio se prorratea desde la fecha efectiva', () => {
    expect(enEjercicio(ini('2025-06-01'), meses)).toBe(1200) // ya vigente al empezar: todo el año
    expect(enEjercicio(ini('2027-02-01'), meses)).toBe(0) // después del cierre: nada
    expect(enEjercicio(ini('2026-07-01'), meses)).toBeCloseTo(1200 * (184 / 365), 0) // segunda mitad del año
  })
  it('realizado, en gestión o no cuenta', () => {
    expect(cuenta('Realizado')).toBe('R')
    expect(cuenta('En negociación')).toBe('G')
    expect(cuenta('Descartada')).toBeNull()
  })
})

describe('ahorroDe', () => {
  it('suma realizado y en gestión del ejercicio, sin descartadas ni bajas', () => {
    const base = { empresa_id: 'a', modulo: 'Telecom', palanca: 'Precio', linea_base: 1200, costo_nuevo: 0, fecha_efectiva: '2025-01-01', activo: true }
    const r = ahorroDe([{ ...base, estado: 'Realizado' }, { ...base, estado: 'Propuesta' }, { ...base, estado: 'Descartada' }, { ...base, estado: 'Realizado', activo: false }], () => meses)
    expect(r).toEqual({ R: 1200, G: 1200 })
  })
})
