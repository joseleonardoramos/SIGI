// Cálculos del panel gerencial: meses del ejercicio fiscal, reparto mensual del presupuesto
// y avance del año. Sin acceso a datos: solo cuentas, para poder probarlas.

export type Mes = { anio: number; mes: number } // mes de 1 a 12

const ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const etiquetaMes = (m: Mes) => ABREV[m.mes - 1]

// Los 12 meses del ejercicio: «2026-2027» con inicio en octubre → oct 2026 … sep 2027.
export function mesesDelEjercicio(ejercicio: string, inicioMes: number): Mes[] {
  const anio = Number(ejercicio.slice(0, 4))
  return Array.from({ length: 12 }, (_, i) => {
    const m = inicioMes - 1 + i
    return { anio: anio + Math.floor(m / 12), mes: (m % 12) + 1 }
  })
}

// Reparte el monto de una partida en los 12 meses según su distribución.
// Trimestral: un cuarto al inicio de cada trimestre del ejercicio. Puntual: todo en el mes indicado.
export function programar(monto: number, distribucion: string, meses: Mes[]): number[] {
  if (distribucion === 'Uniforme') return meses.map(() => monto / 12)
  if (distribucion === 'Trimestral') return meses.map((_, i) => (i % 3 === 0 ? monto / 4 : 0))
  const mes = ABREV.indexOf(distribucion.replace('Puntual · ', '')) + 1
  return meses.map((m) => (m.mes === mes ? monto : 0))
}

// Posición (0–11) de una fecha AAAA-MM-DD dentro del ejercicio; -1 si cae fuera.
export function indiceMes(fecha: string, meses: Mes[]): number {
  const [anio, mes] = fecha.split('-').map(Number)
  return meses.findIndex((m) => m.anio === anio && m.mes === mes)
}

// Fracción del ejercicio transcurrida a la fecha de corte (0 a 1).
export function transcurrido(meses: Mes[], hoy: string): number {
  const inicio = Date.UTC(meses[0].anio, meses[0].mes - 1, 1)
  const fin = Date.UTC(meses[11].anio, meses[11].mes, 1)
  const [a, m, d] = hoy.split('-').map(Number)
  const ahora = Date.UTC(a, m - 1, d)
  return Math.min(Math.max((ahora - inicio) / (fin - inicio), 0), 1)
}

// Suma acumulada (para la vista «Acumulado» del gráfico).
export const acumular = (valores: number[]) => valores.map((_, i) => valores.slice(0, i + 1).reduce((s, v) => s + v, 0))
