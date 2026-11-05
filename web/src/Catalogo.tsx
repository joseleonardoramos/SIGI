import { useEffect, useState, type FormEvent } from 'react'
import { supabase, mensajeError, leerTodo } from './supabase'

// Pantalla genérica de un catálogo: lista con búsqueda, alta, edición y baja con motivo.
// Cada módulo la configura en modulos.ts. Los permisos reales los aplica la base (RLS).

export type Fila = Record<string, unknown> & { id: string; activo: boolean; baja_motivo?: string | null }

export type Campo = {
  k: string
  label: string
  tipo?: 'texto' | 'numero' | 'fecha' | 'si_no' | 'opciones' | 'ref' | 'lista'
  opciones?: string[]
  ref?: { tabla: string; select?: string; etiqueta: (f: Fila) => string; global?: boolean }
  obligatorio?: boolean
  oculto?: boolean // no se muestra en la lista
  defecto?: string | boolean
}

export type Modulo = {
  id: string
  titulo: string
  tabla: string
  global?: boolean // sin empresa (proveedores, tasas)
  soloAdmin?: boolean // solo el Administrador registra y edita
  campos: Campo[]
  orden: { k: string; asc?: boolean }
  total?: { k: string; label: string; si?: (f: Fila) => boolean }
  extra?: { cargar: (empresa: string) => Promise<Record<string, Record<string, unknown>>>; columnas: { k: string; label: string }[] }
  nota?: string
}

type Valores = Record<string, string | boolean>

const numero = (v: unknown) => Number(v).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function vacio(m: Modulo): Valores {
  return Object.fromEntries(m.campos.map((c) => [c.k, c.defecto ?? (c.tipo === 'si_no' ? false : '')]))
}

function desdeFila(m: Modulo, f: Fila): Valores {
  return Object.fromEntries(m.campos.map((c) => {
    const v = f[c.k]
    if (c.tipo === 'si_no') return [c.k, Boolean(v)]
    if (c.tipo === 'lista') return [c.k, ((v as string[] | null) ?? []).join('; ')]
    return [c.k, v == null ? '' : String(v)]
  }))
}

// Convierte el formulario en datos para la base; devuelve el primer error de validación si lo hay.
export function aDatos(m: Modulo, v: Valores): { datos?: Record<string, unknown>; error?: string } {
  const datos: Record<string, unknown> = {}
  for (const c of m.campos) {
    const crudo = v[c.k]
    if (c.tipo === 'si_no') { datos[c.k] = Boolean(crudo); continue }
    const t = String(crudo ?? '').trim()
    if (!t) {
      if (c.obligatorio) return { error: `Falta «${c.label}».` }
      datos[c.k] = c.tipo === 'lista' ? [] : null
      continue
    }
    if (c.tipo === 'numero') {
      const n = Number(t.replace(/,/g, ''))
      if (!Number.isFinite(n)) return { error: `«${c.label}» debe ser un número.` }
      datos[c.k] = n
    } else if (c.tipo === 'lista') {
      datos[c.k] = t.split(';').map((s) => s.trim()).filter(Boolean)
    } else {
      datos[c.k] = t
    }
  }
  return { datos }
}

export default function Catalogo({ modulo: m, empresa, puedeEscribir, esAdmin }: {
  modulo: Modulo
  empresa: string
  puedeEscribir: boolean
  esAdmin: boolean
}) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [refs, setRefs] = useState<Record<string, Fila[]>>({})
  const [extra, setExtra] = useState<Record<string, Record<string, unknown>>>({})
  const [form, setForm] = useState<Valores>(() => vacio(m))
  const [editando, setEditando] = useState<string | null>(null)
  const [buscar, setBuscar] = useState('')
  const [verBajas, setVerBajas] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const escribe = puedeEscribir && (!m.soloAdmin || esAdmin)

  async function cargar() {
    const { data, error } = await leerTodo<Fila>((desde, hasta) => {
      let q = supabase.from(m.tabla).select('*')
      if (!m.global) q = q.eq('empresa_id', empresa)
      if (!verBajas) q = q.eq('activo', true)
      return q.order(m.orden.k, { ascending: m.orden.asc ?? true }).order('id').range(desde, hasta)
    })
    if (error) { setError(await mensajeError(error)); return }
    setFilas(data)

    const conRef = m.campos.filter((c) => c.ref)
    const listas = await Promise.all(conRef.map(async (c) => {
      const r = await leerTodo<Fila>((desde, hasta) => {
        let q = supabase.from(c.ref!.tabla).select(c.ref!.select ?? '*').eq('activo', true)
        if (!c.ref!.global) q = q.eq('empresa_id', empresa)
        return q.order('id').range(desde, hasta)
      })
      return [c.k, r.data] as const
    }))
    setRefs(Object.fromEntries(listas))
    if (m.extra) setExtra(await m.extra.cargar(empresa))
  }

  useEffect(() => {
    setForm(vacio(m)); setEditando(null); setMsg(''); setError(''); setBuscar('')
  }, [m])
  useEffect(() => { cargar() }, [m, empresa, verBajas]) // eslint-disable-line react-hooks/exhaustive-deps

  function mostrar(c: Campo, f: Fila): string {
    const v = f[c.k]
    if (v == null || v === '') return ''
    if (c.tipo === 'si_no') return v ? 'Sí' : 'No'
    if (c.tipo === 'lista') return (v as string[]).join('; ')
    if (c.tipo === 'numero') return numero(v)
    if (c.tipo === 'ref') {
      const r = refs[c.k]?.find((x) => x.id === v)
      return r ? c.ref!.etiqueta(r) : '(dado de baja)'
    }
    return String(v)
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const { datos, error: invalido } = aDatos(m, form)
    if (!datos) { setError(invalido!); return }
    const { error } = editando
      ? await supabase.from(m.tabla).update(datos).eq('id', editando)
      : await supabase.from(m.tabla).insert(m.global ? datos : { ...datos, empresa_id: empresa })
    if (error) { setError(await mensajeError(error)); return }
    setMsg(editando ? 'Cambios guardados; el valor anterior queda en la bitácora.' : 'Registro creado.')
    setForm(vacio(m))
    setEditando(null)
    cargar()
  }

  async function cambiarEstado(f: Fila) {
    setError('')
    let cambios: Record<string, unknown> = { activo: true }
    if (f.activo) {
      const motivo = window.prompt('Motivo de la baja (el registro se conserva en el historial):')
      if (!motivo?.trim()) return
      cambios = { activo: false, baja_motivo: motivo.trim() }
    }
    const { error } = await supabase.from(m.tabla).update(cambios).eq('id', f.id)
    if (error) setError(await mensajeError(error))
    else { setMsg(f.activo ? 'Dado de baja; se conserva en el historial.' : 'Reactivado.'); cargar() }
  }

  const visibles = m.campos.filter((c) => !c.oculto)
  const termino = buscar.trim().toLowerCase()
  const lista = termino
    ? filas.filter((f) => visibles.some((c) => mostrar(c, f).toLowerCase().includes(termino)))
    : filas
  // Un total por moneda: sumar RD$ y US$ juntos no tiene sentido.
  const totales: Record<string, number> = {}
  if (m.total) {
    for (const f of lista) {
      if (!f.activo || !(m.total.si?.(f) ?? true)) continue
      const moneda = String(f.moneda ?? '')
      totales[moneda] = (totales[moneda] ?? 0) + Number(f[m.total.k] ?? 0)
    }
  }
  const total = Object.entries(totales).map(([moneda, v]) => `${moneda ? `${moneda} ` : ''}${numero(v)}`).join(' · ') || numero(0)

  return (
    <section>
      <h2>{m.titulo}</h2>
      {m.nota && <p className="nota">{m.nota}</p>}

      {escribe && (
        <form className="tarjeta fila" onSubmit={guardar}>
          {m.campos.map((c) => (
            <label key={c.k} className={c.tipo === 'texto' || !c.tipo ? 'ancho' : ''}>
              {c.label}{c.obligatorio && ' *'}
              {c.tipo === 'si_no' ? (
                <input type="checkbox" checked={Boolean(form[c.k])} onChange={(e) => setForm({ ...form, [c.k]: e.target.checked })} />
              ) : c.tipo === 'opciones' || c.tipo === 'ref' ? (
                <select value={String(form[c.k])} onChange={(e) => setForm({ ...form, [c.k]: e.target.value })}>
                  <option value="">—</option>
                  {c.tipo === 'opciones'
                    ? c.opciones!.map((o) => <option key={o}>{o}</option>)
                    : (refs[c.k] ?? []).map((r) => <option key={r.id} value={r.id}>{c.ref!.etiqueta(r)}</option>)}
                </select>
              ) : (
                <input
                  type={c.tipo === 'fecha' ? 'date' : 'text'}
                  inputMode={c.tipo === 'numero' ? 'decimal' : undefined}
                  value={String(form[c.k])}
                  placeholder={c.tipo === 'lista' ? 'Separados por ;' : undefined}
                  onChange={(e) => setForm({ ...form, [c.k]: e.target.value })}
                />
              )}
            </label>
          ))}
          <button type="submit">{editando ? 'Guardar cambios' : 'Agregar'}</button>
          {editando && <button type="button" className="secundario" onClick={() => { setEditando(null); setForm(vacio(m)) }}>Cancelar</button>}
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && !error && <p className="ok" role="status">{msg}</p>}

      <div className="fila-controles">
        <label className="buscar">Buscar<input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} /></label>
        <label className="casilla"><input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Mostrar dados de baja</label>
        <span className="nota">{lista.length} registro(s){m.total && ` · ${m.total.label}: ${total}`}</span>
      </div>

      <div className="desplazable">
        <table>
          <thead>
            <tr>
              {visibles.map((c) => <th key={c.k}>{c.label}</th>)}
              {m.extra?.columnas.map((c) => <th key={c.k}>{c.label}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id} className={f.activo ? '' : 'inactivo'}>
                {visibles.map((c) => <td key={c.k} className={c.tipo === 'numero' ? 'num' : ''}>{mostrar(c, f)}</td>)}
                {m.extra?.columnas.map((c) => {
                  const v = extra[f.id]?.[c.k]
                  return <td key={c.k} className={`num${Number(v) < 0 ? ' negativo' : ''}`}>{v == null ? '' : numero(v)}</td>
                })}
                <td className="acciones">
                  {!f.activo && <span className="nota">Baja: {f.baja_motivo}</span>}
                  {escribe && f.activo && (
                    <button className="secundario" onClick={() => { setEditando(f.id); setForm(desdeFila(m, f)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Editar</button>
                  )}
                  {esAdmin && <button className="secundario" onClick={() => cambiarEstado(f)}>{f.activo ? 'Dar de baja' : 'Reactivar'}</button>}
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={visibles.length + (m.extra?.columnas.length ?? 0) + 1}>Sin registros.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
