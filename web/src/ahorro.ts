import { transcurrido, type Mes } from './panelDatos'

// Regla única de ahorro (Ahorros, Panel y Presupuestos):
// ahorro = iniciativas registradas (línea base − costo nuevo, anual), prorrateado en el ejercicio desde su fecha efectiva.
// Realizado = «Realizado»; en gestión = los demás salvo «Descartada».
// Ahorro neto = realizado + en gestión − excesos; proyección de cierre = presupuesto vigente − ahorro neto.

export type Iniciativa = { empresa_id: string; modulo: string; palanca: string; linea_base: number; costo_nuevo: number; fecha_efectiva: string; estado: string; activo: boolean }

export const ahorroAnual = (i: Pick<Iniciativa, 'linea_base' | 'costo_nuevo'>) => Number(i.linea_base) - Number(i.costo_nuevo)
// Parte del ahorro anual que cae dentro del ejercicio: desde la fecha efectiva hasta el cierre.
export const enEjercicio = (i: Pick<Iniciativa, 'linea_base' | 'costo_nuevo' | 'fecha_efectiva'>, meses: Mes[]) => ahorroAnual(i) * (1 - transcurrido(meses, i.fecha_efectiva))
export const cuenta = (estado: string) => (estado === 'Realizado' ? 'R' : estado === 'Descartada' ? null : 'G')

// Realizado y en gestión del ejercicio; mesesDe da el ejercicio de cada empresa.
export function ahorroDe(iniciativas: Iniciativa[], mesesDe: (empresaId: string) => Mes[]) {
  let R = 0, G = 0
  for (const i of iniciativas) {
    const c = i.activo ? cuenta(i.estado) : null
    if (!c) continue
    const v = enEjercicio(i, mesesDe(i.empresa_id))
    if (c === 'R') R += v; else G += v
  }
  return { R, G }
}
