import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY (ver web/.env.example).')

// Clave pública: los permisos los decide la base de datos (RLS), no el navegador.
export const supabase = createClient(url, key)

// Mensaje legible de un error de Supabase o de la función usuarios.
export async function mensajeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (body?.error) return String(body.error)
    } catch { /* respuesta sin JSON */ }
  }
  return (error as { message?: string })?.message ?? 'Ocurrió un error.'
}
