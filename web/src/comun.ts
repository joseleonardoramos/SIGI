import { supabase, leerTodo } from './supabase'

// Datos que comparten las pantallas de operación (Telecom, Software…).

// Monto en RD$: US$ a la tasa vigente; sin tasa registrada, los US$ no se convierten (null).
export const enRD = (moneda: string, monto: number, tasaUSD: number | null) =>
  moneda === 'US$' ? (tasaUSD ? monto * tasaUSD : null) : monto

// Tasa US$ vigente a la fecha (la última registrada que no es futura).
export async function tasaVigenteUSD(hoy: string) {
  const { data, error } = await supabase.from('tasas_cambio').select('tasa, vigente_desde').eq('activo', true).eq('moneda', 'US$')
    .lte('vigente_desde', hoy).order('vigente_desde', { ascending: false }).limit(1).maybeSingle()
  return { tasa: data ? { tasa: Number(data.tasa), desde: data.vigente_desde as string } : null, error }
}

// Cuentas contables vigentes (no inactivas) como «empresa|código», de una empresa o de todas las visibles.
export async function cuentasVigentes(co: string) {
  const { data, error } = await leerTodo<{ empresa_id: string; codigo: string; estado: string }>((d, h) => {
    let q = supabase.from('cuentas_contables').select('empresa_id, codigo, estado').eq('activo', true)
    if (co !== 'all') q = q.eq('empresa_id', co)
    return q.order('id').range(d, h)
  })
  return { cuentas: new Set(data.filter((x) => x.estado !== 'Inactiva').map((x) => `${x.empresa_id}|${x.codigo}`)), error }
}

// Días de una fecha AAAA-MM-DD a otra (negativo si ya pasó).
export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 864e5)
export const sumarDias = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * 864e5).toISOString().slice(0, 10)
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const fechaCorta = (f: string) => `${f.slice(8, 10)} ${MES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`
