import { useEffect, useState } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal, dinero } from './supabase'
import { aCsv, descargar } from './csv'

// Compara dos versiones de presupuesto de la empresa por categoría (presupuesto y ejecutado).
type Version = { id: string; ejercicio: string; numero: number; estado: string }
type Saldo = { version_id: string; categoria: string; presupuesto: number; ejecutado: number }
type Suma = { presupuesto: number; ejecutado: number }

const nombre = (v?: Version) => (v ? `${v.ejercicio} · v${v.numero} (${v.estado})` : '')

// Suma por categoría de una versión.
export function porCategoria(saldos: Saldo[], version: string): Record<string, Suma> {
  const r: Record<string, Suma> = {}
  for (const s of saldos.filter((x) => x.version_id === version)) {
    const t = (r[s.categoria] ??= { presupuesto: 0, ejecutado: 0 })
    t.presupuesto += Number(s.presupuesto)
    t.ejecutado += Number(s.ejecutado)
  }
  return r
}

export default function Comparar({ empresa, moneda }: { empresa: string; moneda: string }) {
  const [versiones, setVersiones] = useState<Version[]>([])
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('presupuestos_versiones').select('id, ejercicio, numero, estado').eq('empresa_id', empresa).eq('activo', true)
        .order('ejercicio', { ascending: false }).order('numero', { ascending: false }),
      leerTodo<Saldo>((d, h) => supabase.from('saldo_partidas').select('version_id, categoria, presupuesto, ejecutado')
        .eq('empresa_id', empresa).order('partida_id').range(d, h)),
    ]).then(async ([v, s]) => {
      const fallo = v.error ?? s.error
      if (fallo) { setError(await mensajeError(fallo)); return }
      const lista = (v.data ?? []) as Version[]
      setVersiones(lista)
      setSaldos(s.data)
      // Por defecto: la vigente (o la más reciente) contra la anterior.
      const vigente = lista.find((x) => x.estado === 'Vigente') ?? lista[0]
      setB(vigente?.id ?? '')
      setA(lista.find((x) => x.id !== vigente?.id)?.id ?? '')
    })
  }, [empresa])

  const sa = porCategoria(saldos, a)
  const sb = porCategoria(saldos, b)
  const categorias = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort((x, y) => x.localeCompare(y, 'es'))
  const cero = { presupuesto: 0, ejecutado: 0 }
  const filas = categorias.map((c) => {
    const x = sa[c] ?? cero, y = sb[c] ?? cero
    return { c, x, y, dif: y.presupuesto - x.presupuesto }
  })
  const suma = (k: 'x' | 'y', campo: keyof Suma) => filas.reduce((s, f) => s + f[k][campo], 0)
  const pct = (dif: number, base: number) => (base ? `${((dif / base) * 100).toFixed(1)} %` : '—')
  const va = versiones.find((v) => v.id === a), vb = versiones.find((v) => v.id === b)

  function exportar() {
    descargar(`comparacion-presupuesto-${fechaLocal()}.csv`, aCsv(
      ['Categoría', `Presupuesto ${nombre(va)}`, `Ejecutado ${nombre(va)}`, `Presupuesto ${nombre(vb)}`, `Ejecutado ${nombre(vb)}`, 'Variación presupuesto'],
      filas.map((f) => [f.c, f.x.presupuesto, f.x.ejecutado, f.y.presupuesto, f.y.ejecutado, f.dif]),
    ))
  }

  return (
    <section>
      <h2>Comparar versiones</h2>
      <p className="nota">Presupuesto y ejecutado por categoría, en {moneda}. La variación es la segunda versión menos la primera.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="tarjeta fila">
        <label>Versión base
          <select value={a} onChange={(e) => setA(e.target.value)}>{versiones.map((v) => <option key={v.id} value={v.id}>{nombre(v)}</option>)}</select>
        </label>
        <label>Comparar con
          <select value={b} onChange={(e) => setB(e.target.value)}>{versiones.map((v) => <option key={v.id} value={v.id}>{nombre(v)}</option>)}</select>
        </label>
        <button type="button" className="secundario" onClick={exportar} disabled={filas.length === 0}>Exportar CSV</button>
      </div>
      {versiones.length < 2 && <p className="nota">Hace falta al menos dos versiones de presupuesto para comparar.</p>}
      <div className="desplazable">
        <table>
          <thead>
            <tr><th>Categoría</th><th>Presupuesto base</th><th>Ejecutado base</th><th>Presupuesto comparado</th><th>Ejecutado comparado</th><th>Variación</th><th>%</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.c}>
                <td>{f.c}</td>
                <td className="num">{dinero(f.x.presupuesto)}</td>
                <td className="num">{dinero(f.x.ejecutado)}</td>
                <td className="num">{dinero(f.y.presupuesto)}</td>
                <td className="num">{dinero(f.y.ejecutado)}</td>
                <td className={`num${f.dif < 0 ? ' negativo' : ''}`}>{dinero(f.dif)}</td>
                <td className="num">{pct(f.dif, f.x.presupuesto)}</td>
              </tr>
            ))}
            {filas.length > 0 && (
              <tr className="total">
                <td>Total</td>
                <td className="num">{dinero(suma('x', 'presupuesto'))}</td>
                <td className="num">{dinero(suma('x', 'ejecutado'))}</td>
                <td className="num">{dinero(suma('y', 'presupuesto'))}</td>
                <td className="num">{dinero(suma('y', 'ejecutado'))}</td>
                <td className="num">{dinero(suma('y', 'presupuesto') - suma('x', 'presupuesto'))}</td>
                <td className="num">{pct(suma('y', 'presupuesto') - suma('x', 'presupuesto'), suma('x', 'presupuesto'))}</td>
              </tr>
            )}
            {filas.length === 0 && <tr><td colSpan={7}>Sin partidas en estas versiones.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
