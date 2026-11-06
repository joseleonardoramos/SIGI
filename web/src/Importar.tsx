import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase, mensajeError } from './supabase'
import { aObjetos, decodificar, descargar, huella, leerCsv, plantillaCsv } from './csv'

type Opcion = { id: string; nombre: string }
type Resultado = {
  filas: number
  errores: { fila: number; mensaje: string }[]
  importado: boolean
  muestra?: Record<string, unknown>[] // primeras filas tal como se guardarán
}

const celda = (v: unknown) => (v === true ? 'Sí' : v === false ? 'No' : v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v))
type Archivo = { nombre: string; hash: string; filas: Record<string, string>[] }

const CATALOGOS = [
  { id: 'servicios_telecom', nombre: 'Servicios de telecomunicaciones', admin: false },
  { id: 'lineas_flota', nombre: 'Líneas de flota', admin: false },
  { id: 'partidas', nombre: 'Partidas de presupuesto', admin: false },
  { id: 'proveedores', nombre: 'Proveedores (maestro)', admin: true },
  { id: 'cuentas_proveedor', nombre: 'Cuentas de proveedor', admin: true },
  { id: 'cuentas_contables', nombre: 'Cuentas contables', admin: true },
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

  const listo = archivo && resultado && resultado.errores.length === 0 && !resultado.importado
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
      <p className="nota">Separado por comas o punto y coma, en UTF-8. Montos con punto decimal (1,500.00). Fechas AAAA-MM-DD o DD/MM/AAAA. Primero se revisa el archivo; nada se guarda hasta confirmar.</p>

      {ocupado && <p role="status">Revisando…</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {archivo && resultado && (
        <>
          {resultado.importado
            ? <p className="ok" role="status">Se importaron {resultado.filas} filas de «{archivo.nombre}». Quedan en la bitácora.</p>
            : resultado.errores.length > 0
              ? <p className="error" role="alert">{resultado.errores.length} fila(s) con errores en «{archivo.nombre}». Corrija el archivo y vuelva a elegirlo; no se guardó nada.</p>
              : <p className="ok" role="status">{resultado.filas} filas revisadas sin errores. Revise la muestra y confirme.</p>}

          {resultado.errores.length > 0 && (
            <table>
              <thead><tr><th>Fila</th><th>Error</th></tr></thead>
              <tbody>
                {resultado.errores.map((e) => <tr key={e.fila + e.mensaje}><td>{e.fila || '—'}</td><td>{e.mensaje}</td></tr>)}
              </tbody>
            </table>
          )}

          {listo && (
            <>
              <p className="nota">Así se guardarán (fechas, montos y estados ya convertidos). Revise sobre todo las fechas: se leen como día/mes/año.</p>
              <div className="desplazable">
                <table>
                  <thead><tr><th>Fila</th>{Object.keys(resultado.muestra?.[0] ?? {}).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {(resultado.muestra ?? []).map((f, i) => (
                      <tr key={i}><td>{i + 2}</td>{Object.values(f).map((v, j) => <td key={j}>{celda(v)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {archivo.filas.length > 10 && <p className="nota">Se muestran 10 de {archivo.filas.length} filas.</p>}
              <button type="button" disabled={ocupado} onClick={() => enviar(archivo, true)}>Confirmar importación de {resultado.filas} filas</button>
            </>
          )}
        </>
      )}
    </section>
  )
}
