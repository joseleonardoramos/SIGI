import { describe, expect, it } from 'vitest'
import { monto, pasa } from './diseno'

describe('monto', () => {
  it('muestra el monto completo y abrevia solo desde un millón', () => {
    expect(monto(191_700.4)).toBe('191,700')
    expect(monto(999_999)).toBe('999,999')
    expect(monto(1_000_000)).toBe('1.00 M')
    expect(monto(-2_345_678)).toBe('-2.35 M')
    expect(monto(-0.3)).toBe('0')
  })
})

describe('pasa', () => {
  it('sin elección pasa todo; con varias, pasa cualquiera de ellas', () => {
    expect(pasa([], 'Internet')).toBe(true)
    expect(pasa(['Internet', 'Metro Ethernet'], 'Metro Ethernet')).toBe(true)
    expect(pasa(['Internet', 'Metro Ethernet'], 'Telefonía')).toBe(false)
    expect(pasa(['Internet'], null)).toBe(false)
  })
})
