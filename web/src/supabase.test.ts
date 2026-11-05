import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.stubEnv('VITE_SUPABASE_URL', 'http://prueba')
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'prueba')
const { leerTodo } = await import('./supabase')

describe('leerTodo', () => {
  it('pide de 1000 en 1000 hasta recibir una parte incompleta', async () => {
    const total = Array.from({ length: 2345 }, (_, i) => i)
    const pedidos: [number, number][] = []
    const { data, error } = await leerTodo<number>(async (desde, hasta) => {
      pedidos.push([desde, hasta])
      return { data: total.slice(desde, hasta + 1), error: null }
    })
    expect(error).toBeNull()
    expect(data).toHaveLength(2345)
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('devuelve el error sin seguir pidiendo', async () => {
    let llamadas = 0
    const { error } = await leerTodo(async () => { llamadas++; return { data: null, error: { message: 'falla' } } })
    expect(error).toEqual({ message: 'falla' })
    expect(llamadas).toBe(1)
  })
})
