import { describe, expect, it } from 'vitest'
import { aObjetos, decodificar, leerCsv, plantillaCsv, separador } from './csv'

describe('leerCsv', () => {
  it('lee comas, comillas, comillas escapadas y saltos de línea dentro de comillas', () => {
    const texto = 'Sucursal,Monto,Comentarios\r\nSede,"1,500.00","Dijo ""urgente""\nsegunda línea"\r\n'
    expect(leerCsv(texto)).toEqual([
      ['Sucursal', 'Monto', 'Comentarios'],
      ['Sede', '1,500.00', 'Dijo "urgente"\nsegunda línea'],
    ])
  })

  it('detecta el punto y coma de Excel en español y quita el BOM', () => {
    const texto = '﻿Nombre;RNC\nClaro;101001577\n'
    expect(separador(texto)).toBe(';')
    expect(leerCsv(texto)).toEqual([['Nombre', 'RNC'], ['Claro', '101001577']])
  })

  it('omite filas vacías y conserva celdas vacías', () => {
    expect(leerCsv('a,b,c\n\n1,,3\n,,\n')).toEqual([['a', 'b', 'c'], ['1', '', '3']])
  })

  it('lee la última fila aunque no termine en salto de línea', () => {
    expect(leerCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('aObjetos', () => {
  it('usa el encabezado como claves y completa columnas faltantes', () => {
    expect(aObjetos([[' Área ', 'Precio'], ['Ventas']])).toEqual([{ Área: 'Ventas', Precio: '' }])
  })

  it('rechaza una fila con columnas de más (coma de miles sin comillas)', () => {
    expect(() => aObjetos(leerCsv('Sucursal,Monto,Comentarios\nSede,45,000.00,Enlace\n'))).toThrow('La fila 2 tiene más columnas')
  })

  it('acepta celdas vacías de sobra al final de la fila', () => {
    expect(aObjetos([['a', 'b'], ['1', '2', '', '']])).toEqual([{ a: '1', b: '2' }])
  })
})

describe('decodificar', () => {
  it('lee UTF-8 y también archivos guardados en Windows-1252', () => {
    expect(decodificar(new TextEncoder().encode('Área').buffer as ArrayBuffer)).toBe('Área')
    expect(decodificar(new Uint8Array([0xc1, 0x72, 0x65, 0x61]).buffer)).toBe('Área')
  })
})

describe('plantillaCsv', () => {
  it('pone BOM y comillas donde hace falta', () => {
    expect(plantillaCsv(['Número', 'Datos (SI/NO)', 'A,B'])).toBe('﻿Número,Datos (SI/NO),"A,B"\r\n')
  })
})
