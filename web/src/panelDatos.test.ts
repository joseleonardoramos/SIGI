import { describe, expect, it } from 'vitest'
import { acumular, etiquetaMes, indiceMes, mesesDelEjercicio, programar, transcurrido } from './panelDatos'

const meses = mesesDelEjercicio('2026-2027', 10)

describe('panelDatos', () => {
  it('arma el ejercicio fiscal desde su mes de inicio', () => {
    expect(meses.map(etiquetaMes).join(' ')).toBe('oct nov dic ene feb mar abr may jun jul ago sep')
    expect(meses[0]).toEqual({ anio: 2026, mes: 10 })
    expect(meses[11]).toEqual({ anio: 2027, mes: 9 })
  })

  it('reparte el presupuesto según la distribución y no pierde ni suma de más', () => {
    const suma = (v: number[]) => v.reduce((s, x) => s + x, 0)
    expect(suma(programar(1200, 'Uniforme', meses))).toBeCloseTo(1200)
    const trim = programar(1200, 'Trimestral', meses)
    expect(trim.filter((x) => x > 0)).toEqual([300, 300, 300, 300])
    expect(trim[0]).toBe(300) // primer mes del ejercicio
    const marzo = programar(500, 'Puntual · mar', meses)
    expect(marzo[indiceMes('2027-03-15', meses)]).toBe(500)
    expect(suma(marzo)).toBe(500)
  })

  it('ubica fechas en el ejercicio y calcula el avance del año', () => {
    expect(indiceMes('2026-10-01', meses)).toBe(0)
    expect(indiceMes('2026-09-30', meses)).toBe(-1)
    expect(transcurrido(meses, '2026-10-01')).toBe(0)
    expect(transcurrido(meses, '2028-01-01')).toBe(1)
    expect(transcurrido(meses, '2027-04-01')).toBeCloseTo(0.5, 1)
    expect(acumular([1, 2, 3])).toEqual([1, 3, 6])
  })
})
