import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase, mensajeError } from './supabase'
import { aObjetos, decodificar, descargar, huella, leerCsv, plantillaCsv } from './csv'

type Opcion = { id: string; nombre: string }
// Resultado de cada fila según la base: nueva, cambio (solo lo que cambia), igual y vacía (se omiten), error.
export type Detalle = {
  fila: number
  accion: 'nueva' | 'cambio' | 'igual' | 'vacia' | 'error'
  clave?: string
  mensaje?: string
  cambios?: { campo: string; antes?: string; despues?: string }[]
  valores?: Record<string, string | null>
  vacios?: string[]
}
type Resultado = {
  filas: number
  errores: { fila: number; mensaje: string }[]
  importado: boolean
  detalle: Detalle[]
  resumen: Partial<Record<Detalle['accion'], number>>
}

const ACCIONES: { id: Detalle['accion']; nombre: string; tono: [string, string] }[] = [
  { id: 'nueva', nombre: 'Nuevas', tono: ['#E6EEF7', '#1D3557'] },
  { id: 'cambio', nombre: 'Con cambios', tono: ['#FFF4D6', '#6B4A00'] },
  { id: 'igual', nombre: 'Sin cambios (se omiten)', tono: ['#EEF1F4', '#3E4A58'] },
  { id: 'vacia', nombre: 'Vacías (se omiten)', tono: ['#F4F4F4', '#4D4D4D'] },
  { id: 'error', nombre: 'Con error', tono: ['#FBE9DF', '#8A3A12'] },
]
const ESTADO: Record<Detalle['accion'], string> = { nueva: 'Nueva', cambio: 'Cambio', igual: 'Sin cambios', vacia: 'Vacía', error: 'Error' }
const MAX_FILAS = 500 // filas dibujadas a la vez; los filtros muestran el resto

// Qué pasará con la fila, en palabras.
export function explicar(d: Detalle): string {
  switch (d.accion) {
    case 'nueva': return Object.entries(d.valores ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ')
    case 'cambio': return (d.cambios ?? []).map((c) => `${c.campo}: ${c.antes ?? '(vacío)'} → ${c.despues ?? '(vacío)'}`).join(' · ')
    case 'igual': return 'Ya existe igual en SIGI: se omite.'
    case 'vacia': return 'Fila vacía: se omite.'
    default: return d.mensaje ?? ''
  }
}

type Archivo = { nombre: string; hash: string; filas: Record<string, string>[] }

const CATALOGOS = [
  { id: 'servicios_telecom', nombre: 'Servicios de telecomunicaciones', admin: false },
  { id: 'lineas_flota', nombre: 'Líneas de flota', admin: false },
  { id: 'partidas', nombre: 'Partidas de presupuesto', admin: false },
  { id: 'proveedores', nombre: 'Proveedores (maestro)', admin: true },
  { id: 'cuentas_proveedor', nombre: 'Cuentas de proveedor', admin: true },
  { id: 'cuentas_contables', nombre: 'Cuentas contables', admin: true },
  { id: 'departamentos', nombre: 'Áreas y departamentos', admin: true },
]

// Importa en la empresa elegida en la cabecera (los proveedores son globales).
export default function Importar({ empresa, nombreEmpresa, esAdmin }: { empresa: string; nombreEmpresa: string; esAdmin: boolean }) {
  const catalogos = CATALOGOS.filter((c) => esAdmin || !c.admin)
  const [catalogo, setCatalogo] = useState(catalogos[0].id)
  const [versiones, setVersiones] = useState<Opcion[]>([])
  const [version, setVersion] = useState('')
  const [archivo, setArchivo] = useState<Archivo | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [ver, setVer] = useState<Detalle['accion'] | ''>('') // filtro de la vista previa

  const global = catalogo === 'proveedores'

  useEffect(() => {
    if (catalogo !== 'partidas' || !empresa) { setVersiones([]); setVersion(''); return }
    supabase.from('presupuestos_versiones').select('id, ejercicio, numero, estado')
      .eq('empresa_id', empresa).eq('activo', true).neq('estado', 'Cerrado').order('ejercicio', { ascending: false })
      .then(({ data }) => {
        const lista = (data ?? []).map((v) => ({ id: v.id, nombre: `${v.ejercicio} · versión ${v.numero} (${v.estado})` }))
        setVersiones(lista)
        setVersion(lista[0]?.id ?? '')
      })
  }, [catalogo, empresa])

  // Cualquier cambio de destino invalida la vista previa.
  useEffect(() => { setArchivo(null); setResultado(null); setError('') }, [catalogo, empresa, version])

  async function descargarPlantilla() {
    const { data, error } = await supabase.rpc('csv_plantilla', { p_catalogo: catalogo })
    if (error) { setError(await mensajeError(error)); return }
    const columnas = (data as { columna: string; obligatoria: boolean }[]).map((c) => c.columna)
    descargar(`plantilla-${catalogo}.csv`, plantillaCsv(columnas))
  }

  async function enviar(datos: Archivo, confirmar: boolean) {
    setOcupado(true)
    setError('')
    const { data, error } = await supabase.rpc('importar_csv', {
      p_catalogo: catalogo,
      p_empresa: global ? null : empresa,
      p_archivo: datos.nombre,
      p_hash: datos.hash,
      p_filas: datos.filas,
      p_confirmar: confirmar,
      p_version: catalogo === 'partidas' ? version : null,
    })
    setOcupado(false)
    if (error) { setError(await mensajeError(error)); return }
    setResultado(data as Resultado)
    setVer('')
  }

  async function elegir(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo corregido
    if (!file) return
    setResultado(null)
    const bytes = await file.arrayBuffer()
    const filas = leerCsv(decodificar(bytes))
    if (filas.length < 2) { setError('El archivo no tiene filas debajo del encabezado.'); return }
    let objetos: Record<string, string>[]
    try {
      objetos = aObjetos(filas)
    } catch (err) {
      setArchivo(null)
      setError((err as Error).message)
      return
    }
    const datos = { nombre: file.name, hash: await huella(bytes), filas: objetos }
    setArchivo(datos)
    enviar(datos, false)
  }

  const n = (a: Detalle['accion']) => resultado?.resumen?.[a] ?? 0
  const aCargar = n('nueva') + n('cambio')
  const listo = archivo && resultado && resultado.errores.length === 0 && !resultado.importado
  const visibles = (resultado?.detalle ?? []).filter((d) => !ver || d.accion === ver)
  const faltaDestino = (!global && !empresa) || (catalogo === 'partidas' && !version)

  return (
    <section>
      <h2>Importar CSV</h2>
      <div className="tarjeta fila">
        <label>Qué importar
          <select value={catalogo} onChange={(e) => setCatalogo(e.target.value)}>
            {catalogos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <p className="nota">{global ? 'Maestro común a todas las empresas.' : <>Se importa en <b>{nombreEmpresa}</b> (cámbiela arriba).</>}</p>
        {catalogo === 'partidas' && (
          <label>Versión de presupuesto
            <select value={version} onChange={(e) => setVersion(e.target.value)}>
              {versiones.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="secundario" onClick={descargarPlantilla}>Descargar plantilla</button>
        <label>Archivo CSV
          <input type="file" accept=".csv,text/csv" disabled={ocupado || faltaDestino} onChange={elegir} />
        </label>
      </div>
      {faltaDestino && <p className="nota">{catalogo === 'partidas' ? 'Cree primero una versión de presupuesto abierta para esta empresa.' : 'No tiene empresas donde importar.'}</p>}
      <p className="nota">Separado por comas o punto y coma, en UTF-8. Montos con punto decimal (1,500.00). Fechas AAAA-MM-DD o DD/MM/AAAA. Primero se revisa el archivo y se muestra fila por fila qué es nuevo, qué cambia y qué se omite; nada se guarda hasta confirmar.</p>

      {ocupado && <p role="status">Revisando…</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {archivo && resultado && (
        <>
          {resultado.importado
            ? <p className="ok" role="status">Se cargaron {n('nueva')} nuevas y {n('cambio')} con cambios de «{archivo.nombre}». Se omitieron {n('igual')} sin cambios y {n('vacia')} vacías. Todo queda en la bitácora.</p>
            : resultado.errores.length > 0
              ? <p className="error" role="alert">{resultado.errores.length} fila(s) con errores en «{archivo.nombre}». Corrija el archivo y vuelva a elegirlo; no se guardó nada.</p>
              : aCargar === 0
                ? <p className="ok" role="status">Nada que cargar: todo lo de «{archivo.nombre}» ya está en SIGI sin cambios{n('vacia') ? ` (y ${n('vacia')} filas vacías)` : ''}.</p>
                : <p className="ok" role="status">Revise la vista previa: se cargarán {n('nueva')} nuevas y {n('cambio')} con cambios; se omiten {n('igual')} sin cambios y {n('vacia')} vacías. Nada se guarda hasta confirmar.</p>}

          {resultado.detalle.length === 0 && resultado.errores.length > 0 && (
            <table>
              <thead><tr><th>Fila</th><th>Error</th></tr></thead>
              <tbody>
                {resultado.errores.map((e) => <tr key={e.fila + e.mensaje}><td>{e.fila || '—'}</td><td>{e.mensaje}</td></tr>)}
              </tbody>
            </table>
          )}

          {resultado.detalle.length > 0 && (
            <>
              <div className="fila-controles" role="group" aria-label="Filtrar la vista previa">
                <button type="button" className={ver === '' ? '' : 'secundario'} aria-pressed={ver === ''} onClick={() => setVer('')}>Todas ({resultado.detalle.length})</button>
                {ACCIONES.filter((a) => n(a.id) > 0).map((a) => (
                  <button key={a.id} type="button" className={ver === a.id ? '' : 'secundario'} aria-pressed={ver === a.id} onClick={() => setVer(a.id)}>{a.nombre} ({n(a.id)})</button>
                ))}
              </div>
              <p className="nota">Las celdas opcionales vacías no borran lo que ya está guardado. Revise las fechas: se leen como día/mes/año.</p>
              <div className="desplazable">
                <table>
                  <thead><tr><th>Fila</th><th>Resultado</th><th>Registro</th><th>Qué se hará</th></tr></thead>
                  <tbody>
                    {visibles.slice(0, MAX_FILAS).map((d) => {
                      const a = ACCIONES.find((x) => x.id === d.accion)!
                      return (
                        <tr key={d.fila}>
                          <td className="num">{d.fila}</td>
                          <td><span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 999, background: a.tono[0], color: a.tono[1], whiteSpace: 'nowrap' }}>{ESTADO[d.accion]}</span></td>
                          <td style={{ fontWeight: 600 }}>{d.clave}</td>
                          <td style={{ fontSize: 13 }}>
                            {explicar(d)}
                            {d.vacios && d.vacios.length > 0 && d.accion !== 'error' && (
                              <div className="nota">{d.accion === 'nueva' ? 'Sin dato' : 'Sin dato, se conserva lo guardado'}: {d.vacios.join(', ')}</div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {visibles.length > MAX_FILAS && <p className="nota">Se muestran {MAX_FILAS} de {visibles.length} filas; use los filtros para ver el resto.</p>}
              {listo && aCargar > 0 && (
                <button type="button" disabled={ocupado} onClick={() => enviar(archivo, true)}>Cargar {n('nueva')} nuevas y {n('cambio')} con cambios</button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
