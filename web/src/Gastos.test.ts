import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-10', leerTodo: async () => ({ data: [] }), dinero: String }))
const { alertas, estado, totales } = await import('./Gastos')

const paso = (id: string, tipo: string, monto: number, reversado = false) => ({ id, tipo, monto, reversado })

describe('totales', () => {
  it('ignora reversos y movimientos reversados; una factura mayor amplía el compromiso', () => {
    const t = totales([paso('1', 'Compromiso', 100), paso('2', 'Factura', 60), paso('3', 'Factura', 50, true), paso('4', 'Reverso', 50), paso('5', 'Pago', 20)])
    expect(t).toEqual({ com: 100, inv: 60, paid: 20 })
    expect(totales([paso('1', 'Compromiso', 100), paso('2', 'Factura', 120)]).com).toBe(120)
  })
})

describe('estado', () => {
  it('sigue compromiso → factura → pago', () => {
    expect(estado({ com: 100, inv: 0, paid: 0 })).toBe('Comprometido')
    expect(estado({ com: 100, inv: 60, paid: 0 })).toBe('Facturado parcial')
    expect(estado({ com: 100, inv: 100, paid: 0 })).toBe('Facturado')
    expect(estado({ com: 100, inv: 100, paid: 40 })).toBe('Pagado parcial')
    expect(estado({ com: 100, inv: 100, paid: 100 })).toBe('Pagado')
  })
})

describe('alertas', () => {
  it('marca facturas y pagos vigentes sin evidencia', () => {
    const pasos = [paso('c', 'Compromiso', 100), paso('f', 'Factura', 100), paso('p', 'Pago', 100), paso('r', 'Factura', 10, true)]
    expect(alertas(pasos, new Set(['f']))).toEqual(['Pago sin evidencia'])
    expect(alertas(pasos, new Set())).toEqual(['Factura sin evidencia', 'Pago sin evidencia'])
  })
})
