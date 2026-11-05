import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY (ver web/.env.example).')

// Clave pública: los permisos los decide la base de datos (RLS), no el navegador.
export const supabase = createClient(url, key)

// Supabase entrega como máximo 1000 filas por consulta (max_rows): se piden por partes hasta el final.
// La consulta debe tener un orden estable (por ejemplo, terminar en .order('id')).
// shortcut: tope de 20000 filas por lista; si un catálogo crece más, paginar en la pantalla.
export async function leerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>,
  tope = 20000,
): Promise<{ data: T[]; error: unknown }> {
  const filas: T[] = []
  for (let desde = 0; desde < tope; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999)
    if (error) return { data: filas, error }
    const parte = (data ?? []) as T[]
    filas.push(...parte)
    if (parte.length < 1000) break
  }
  return { data: filas, error: null }
}

// Fecha AAAA-MM-DD en la hora local. toISOString() usa UTC: de noche en RD ya daría el día siguiente.
export function fechaLocal(d = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// Mensaje legible de un error de Supabase o de la función usuarios.
export async function mensajeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (body?.error) return String(body.error)
    } catch { /* respuesta sin JSON */ }
  }
  // Errores de la base con mensaje técnico en inglés: se traducen; los propios de SIGI ya vienen en español.
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  const traducidos: Record<string, string> = {
    '23505': 'Ya existe un registro con esos datos.',
    '23P01': 'Esa persona ya tiene una ausencia en esas fechas. Cancele la anterior si fue un error.',
    '23503': 'Un dato elegido no pertenece a esta empresa o ya no existe.',
    '23514': `Un valor no es válido (${message ?? ''}).`,
    '42501': 'No tiene permiso para esta acción.',
  }
  // Reglas propias de SIGI, reconocidas por el nombre de la restricción que las aplica.
  const porRegla: Record<string, string> = {
    una_version_vigente: 'Ya hay una versión vigente en esta empresa: cierre la anterior o deje esta en Borrador.',
    activos_serial_unico: 'Ese serial ya está registrado en esta empresa.',
    reposiciones_check: 'Un reemplazo o mantenimiento necesita el activo actual.',
    proyectos_check: 'La fecha de fin no puede ser anterior al inicio.',
  }
  const regla = Object.keys(porRegla).find((r) => message?.includes(`"${r}"`))
  if (regla) return porRegla[regla]
  return (code && traducidos[code]) || message || 'Ocurrió un error.'
}
