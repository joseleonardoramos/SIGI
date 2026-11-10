import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, mensajeError: async () => '', fechaLocal: () => '2026-11-10', leerTodo: async () => ({ data: [] }), dinero: String }))
const { alerta, mesesEntre, plan, statusProveedor } = await import('./Flotas')

describe('mesesEntre', () => {
  it('cuenta meses completos', () => {
    expect(mesesEntre('2024-02-10', '2026-11-10')).toBe(33)
    expect(mesesEntre('2024-02-11', '2026-11-10')).toBe(32)
  })
})

describe('alerta', () => {
  const hoy = '2026-11-10'
  it('marca cambiazo elegible a los 33 meses del último cambiazo o de la creación', () => {
    expect(alerta({ estado: 'Sin alerta', fecha_alta: '2024-02-10', fecha_cambiazo: null }, hoy)).toBe('Cambiazo elegible')
    expect(alerta({ estado: 'Sin alerta', fecha_alta: '2020-01-01', fecha_cambiazo: '2025-01-01' }, hoy)).toBe('Sin alerta')
  })
  it('respeta el estado registrado: sin uso y cancelada ganan; suspendida no es alerta', () => {
    expect(alerta({ estado: 'Sin uso 90 días', fecha_alta: '2020-01-01', fecha_cambiazo: null }, hoy)).toBe('Sin uso 90 días')
    expect(alerta({ estado: 'Cancelada', fecha_alta: '2020-01-01', fecha_cambiazo: null }, hoy)).toBe('Cancelada')
    expect(alerta({ estado: 'Suspendida', fecha_alta: '2026-01-01', fecha_cambiazo: null }, hoy)).toBe('Sin alerta')
  })
})

describe('statusProveedor y plan', () => {
  it('traduce el estado al status del proveedor y arma el plan', () => {
    expect(statusProveedor('Suspendida')).toBe('SUSPENDED')
    expect(statusProveedor('Sin uso 90 días')).toBe('ACTIVE')
    expect(plan({ datos: true, cantidad: '30GB' })).toBe('Datos SI · 30GB')
    expect(plan({ datos: false, cantidad: null })).toBe('Datos NO · solo voz')
  })
})
