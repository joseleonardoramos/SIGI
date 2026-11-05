import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.stubEnv('VITE_SUPABASE_URL', 'http://prueba')
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'prueba')
const { leerTodo, mensajeError } = await import('./supabase')

describe('mensajeError', () => {
  it('traduce las reglas de SIGI por el nombre exacto de la restricción', async () => {
    expect(await mensajeError({ code: '23505', message: 'duplicate key value violates unique constraint "una_version_vigente"' }))
      .toBe('Ya hay una versión vigente en esta empresa: cierre la anterior o deje esta en Borrador.')
    expect(await mensajeError({ code: '23514', message: 'new row for relation "proyectos" violates check constraint "proyectos_check"' }))
      .toBe('La fecha de fin no puede ser anterior al inicio.')
    // reposiciones_cantidad_check no debe confundirse con reposiciones_check
    expect(await mensajeError({ code: '23514', message: 'new row for relation "reposiciones" violates check constraint "reposiciones_cantidad_check"' }))
      .toBe('Un valor no es válido (new row for relation "reposiciones" violates check constraint "reposiciones_cantidad_check").')
  })

  it('usa el mensaje genérico del código o el original', async () => {
    expect(await mensajeError({ code: '42501', message: 'permission denied' })).toBe('No tiene permiso para esta acción.')
    expect(await mensajeError({ message: 'El monto debe ser mayor que cero.' })).toBe('El monto debe ser mayor que cero.')
  })
})

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
