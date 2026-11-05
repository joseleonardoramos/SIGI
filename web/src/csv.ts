// Lectura de archivos CSV para la importación. La validación de los datos la hace la base (importar_csv).

// Separador del archivo: coma, o punto y coma si el encabezado tiene más «;» (Excel en español guarda así).
export function separador(texto: string): ',' | ';' {
  const encabezado = texto.split(/\r?\n/, 1)[0] ?? ''
  const cuenta = (c: string) => encabezado.split(c).length - 1
  return cuenta(';') > cuenta(',') ? ';' : ','
}

// RFC 4180: campos entre comillas, comillas dobles escapadas ("") y saltos de línea dentro de comillas.
// Omite las filas vacías.
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '')
  const sep = separador(t)
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let comillas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') comillas = false
      else campo += c
    } else if (c === '"') comillas = true
    else if (c === sep) { fila.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ''
    } else campo += c
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila) }
  return filas.filter((f) => f.some((v) => v.trim() !== ''))
}

// Convierte las filas en objetos {encabezado: valor}.
// Una fila con celdas de más (no vacías) casi siempre es una coma sin comillas, como en 45,000.00:
// se rechaza para no correr las columnas y guardar un monto equivocado.
export function aObjetos(filas: string[][]): Record<string, string>[] {
  const [encabezado, ...resto] = filas
  if (!encabezado) return []
  return resto.map((f, i) => {
    if (f.slice(encabezado.length).some((v) => v.trim() !== '')) {
      throw new Error(`La fila ${i + 2} tiene más columnas que el encabezado. ¿Hay una coma sin comillas, por ejemplo en un monto como 45,000.00?`)
    }
    return Object.fromEntries(encabezado.map((h, j) => [h.trim(), f[j] ?? '']))
  })
}

// UTF-8 (lo acordado); si el archivo viene de Excel en Windows-1252, lo lee igual para no dañar acentos.
export function decodificar(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// Huella SHA-256 del archivo: la base la usa para no importar dos veces el mismo archivo.
export async function huella(bytes: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Encabezado de plantilla con BOM, para que Excel lo abra como UTF-8.
export function plantillaCsv(columnas: string[]): string {
  const celda = (c: string) => (/[",;\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
  return '﻿' + columnas.map(celda).join(',') + '\r\n'
}
