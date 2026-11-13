import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal, dinero } from './supabase'
import { aCsv, descargar } from './csv'

// Pantalla genérica de un catálogo: lista con búsqueda, alta, edición y baja con motivo.
// Cada módulo la configura en modulos.ts. Los permisos reales los aplica la base (RLS).

export type Fila = Record<string, unknown> & { id: string; activo: boolean; baja_motivo?: string | null }

export type Campo = {
  k: string
  label: string
  tipo?: 'texto' | 'numero' | 'fecha' | 'si_no' | 'opciones' | 'ref' | 'lista'
  opciones?: string[]
  // filtrarPor: lista dependiente (p. ej. departamentos del área elegida en el campo area_id).
  // valor: columna que se guarda (por defecto el id; la cuenta contable guarda su código).
  // filtro: qué filas de la tabla se ofrecen (p. ej. sin las cuentas inactivas).
  ref?: {
    tabla: string; select?: string; etiqueta: (f: Fila) => string; global?: boolean; filtrarPor?: { campo: string; columna: string }
    valor?: string; filtro?: (f: Fila) => boolean
  }
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
  agrupar?: string[] // campos para agrupar la lista, de mayor a menor (área → departamento)
}

// Agrupa filas por una etiqueta, en orden alfabético; las vacías van a «(sin dato)».
export function agruparPor<T>(filas: T[], etiqueta: (f: T) => string): [string, T[]][] {
  const grupos = new Map<string, T[]>()
  for (const f of filas) {
    const k = etiqueta(f).trim() || '(sin dato)'
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'))
}

type Valores = Record<string, string | boolean>


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

// Opciones de una lista con referencia, en orden alfabético. Un valor guardado que no está en el catálogo
// (p. ej. un código de cuenta importado o una cuenta que pasó a inactiva) se conserva como opción para no perderlo.
export function opcionesRef(c: Campo, filas: Fila[], form: Valores) {
  const ref = c.ref!
  const col = ref.valor ?? 'id'
  const ofrecidas = filas
    .filter((r) => (!ref.filtrarPor || r[ref.filtrarPor.columna] === form[ref.filtrarPor.campo]) && (!ref.filtro || ref.filtro(r)))
    .map((r) => ({ valor: String(r[col]), etiqueta: ref.etiqueta(r) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }))
  const actual = String(form[c.k] ?? '')
  if (actual && !ofrecidas.some((o) => o.valor === actual)) {
    const r = filas.find((x) => String(x[col]) === actual)
    ofrecidas.unshift({ valor: actual, etiqueta: r ? `${ref.etiqueta(r)} (no disponible)` : ref.valor ? `${actual} (no está en el catálogo)` : '(dado de baja)' })
  }
  return ofrecidas.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)
}

// Listas para los campos con referencia (proveedor, cuenta, área…), activas y de la empresa.
export async function cargarRefs(m: Modulo, empresa: string): Promise<Record<string, Fila[]>> {
  const listas = await Promise.all(m.campos.filter((c) => c.ref).map(async (c) => {
    const r = await leerTodo<Fila>((desde, hasta) => {
      let q = supabase.from(c.ref!.tabla).select(c.ref!.select ?? '*').eq('activo', true)
      if (!c.ref!.global) q = q.eq('empresa_id', empresa)
      return q.order('id').range(desde, hasta)
    })
    return [c.k, r.data] as const
  }))
  return Object.fromEntries(listas)
}

// Alta (fila nula) o edición de un registro del módulo. Valida con aDatos; la base decide los permisos.
export function Formulario({ m, empresa, fila, titulo, onGuardado, onCancelar }: {
  m: Modulo
  empresa: string
  fila: Fila | null
  titulo?: string
  onGuardado: (mensaje: string) => void
  onCancelar: () => void
}) {
  const [form, setForm] = useState<Valores>(() => (fila ? desdeFila(m, fila) : vacio(m)))
  const [refs, setRefs] = useState<Record<string, Fila[]>>({})
  const [error, setError] = useState('')
  useEffect(() => { cargarRefs(m, empresa).then(setRefs) }, [m, empresa])

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const { datos, error: invalido } = aDatos(m, form)
    if (!datos) { setError(invalido!); return }
    const { error } = fila
      ? await supabase.from(m.tabla).update(datos).eq('id', fila.id)
      : await supabase.from(m.tabla).insert(m.global ? datos : { ...datos, empresa_id: empresa })
    if (error) { setError(await mensajeError(error)); return }
    onGuardado(fila ? 'Cambios guardados; el valor anterior queda en la bitácora.' : 'Registro creado.')
  }

  return (
    <form className="tarjeta fila" onSubmit={guardar}>
      {titulo && <h3 style={{ gridColumn: '1 / -1', margin: 0 }}>{titulo}</h3>}
      {m.campos.map((c) => (
        <label key={c.k} className={c.tipo === 'texto' || !c.tipo ? 'ancho' : ''}>
          {c.label}{c.obligatorio && ' *'}
          {c.tipo === 'si_no' ? (
            <input type="checkbox" checked={Boolean(form[c.k])} onChange={(e) => setForm({ ...form, [c.k]: e.target.checked })} />
          ) : c.tipo === 'opciones' || c.tipo === 'ref' ? (
            <select value={String(form[c.k])} onChange={(e) => setForm({
              ...form,
              [c.k]: e.target.value,
              // Al cambiar el campo principal se limpian los que dependen de él.
              ...Object.fromEntries(m.campos.filter((x) => x.ref?.filtrarPor?.campo === c.k).map((x) => [x.k, ''])),
            })}>
              <option value="">—</option>
              {c.tipo === 'opciones'
                // Un valor guardado que no está en la lista (p. ej. importado) se conserva como opción.
                ? [...new Set([...c.opciones!, ...(form[c.k] ? [String(form[c.k])] : [])])].map((o) => <option key={o}>{o}</option>)
                : opcionesRef(c, refs[c.k] ?? [], form)}
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
      {error && <p className="error" role="alert" style={{ gridColumn: '1 / -1' }}>{error}</p>}
      <button type="submit">{fila ? 'Guardar cambios' : 'Agregar'}</button>
      <button type="button" className="secundario" onClick={onCancelar}>Cancelar</button>
    </form>
  )
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
  const [editando, setEditando] = useState<Fila | null>(null)
  const [buscar, setBuscar] = useState('')
  const [verBajas, setVerBajas] = useState(false)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState(false) // formulario visible
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
    setRefs(await cargarRefs(m, empresa))
    if (m.extra) setExtra(await m.extra.cargar(empresa))
  }

  useEffect(() => {
    setEditando(null); setAbierto(false); setMsg(''); setError(''); setBuscar('')
  }, [m])
  useEffect(() => { cargar() }, [m, empresa, verBajas]) // eslint-disable-line react-hooks/exhaustive-deps

  function mostrar(c: Campo, f: Fila): string {
    const v = f[c.k]
    if (v == null || v === '') return ''
    if (c.tipo === 'si_no') return v ? 'Sí' : 'No'
    if (c.tipo === 'lista') return (v as string[]).join('; ')
    if (c.tipo === 'numero') return dinero(v)
    if (c.tipo === 'ref') {
      const r = refs[c.k]?.find((x) => x[c.ref!.valor ?? 'id'] === v)
      // Por código (cuenta contable): se muestra el código aunque ya no esté en el catálogo.
      return r ? c.ref!.etiqueta(r) : c.ref!.valor ? String(v) : '(dado de baja)'
    }
    return String(v)
  }

  // El formulario solo se muestra al presionar Crear o Editar.
  function cerrar() { setEditando(null); setAbierto(false) }

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
  function totalTexto(grupo: Fila[]): string {
    const totales: Record<string, number> = {}
    for (const f of grupo) {
      if (!m.total || !f.activo || !(m.total.si?.(f) ?? true)) continue
      const moneda = String(f.moneda ?? '')
      totales[moneda] = (totales[moneda] ?? 0) + Number(f[m.total.k] ?? 0)
    }
    return Object.entries(totales).map(([moneda, v]) => `${moneda ? `${moneda} ` : ''}${dinero(v)}`).join(' · ') || dinero(0)
  }
  const total = totalTexto(lista)
  const columnas = visibles.length + (m.extra?.columnas.length ?? 0) + 1

  function exportar() {
    const encabezado = [...visibles.map((c) => c.label), ...(m.extra?.columnas.map((c) => c.label) ?? []), 'Estado del registro']
    const datos = lista.map((f) => [
      ...visibles.map((c) => (c.tipo === 'numero' ? f[c.k] : mostrar(c, f))), // números sin formato, para Excel
      ...(m.extra?.columnas.map((c) => extra[f.id]?.[c.k]) ?? []),
      f.activo ? 'Activo' : `Baja: ${f.baja_motivo ?? ''}`,
    ])
    descargar(`${m.id}-${fechaLocal()}.csv`, aCsv(encabezado, datos))
  }

  const filaDatos = (f: Fila) => (
    <tr key={f.id} className={f.activo ? '' : 'inactivo'}>
      {visibles.map((c) => <td key={c.k} className={c.tipo === 'numero' ? 'num' : ''}>{mostrar(c, f)}</td>)}
      {m.extra?.columnas.map((c) => {
        const v = extra[f.id]?.[c.k]
        return <td key={c.k} className={`num${Number(v) < 0 ? ' negativo' : ''}`}>{v == null ? '' : dinero(v)}</td>
      })}
      <td className="acciones">
        {!f.activo && <span className="nota">Baja: {f.baja_motivo}</span>}
        {escribe && f.activo && (
          <button className="secundario" onClick={() => { setEditando(f); setMsg(''); setAbierto(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Editar</button>
        )}
        {esAdmin && <button className="secundario" onClick={() => cambiarEstado(f)}>{f.activo ? 'Dar de baja' : 'Reactivar'}</button>}
      </td>
    </tr>
  )

  // Grupos expandibles (sucursal; área → departamento → líneas), con conteo y subtotal.
  function filasAgrupadas(grupo: Fila[], niveles: string[], ruta: string): ReactNode[] {
    if (niveles.length === 0) return grupo.map(filaDatos)
    const campo = m.campos.find((c) => c.k === niveles[0])!
    return agruparPor(grupo, (f) => mostrar(campo, f)).flatMap(([nombre, filasGrupo]) => {
      const clave = `${ruta}/${nombre}`
      const abierto = abiertos.has(clave)
      return [
        <tr key={clave} className={`grupo nivel-${ruta.split('/').length - 1}`}>
          <td colSpan={columnas}>
            <button className="enlace" aria-expanded={abierto} onClick={() => {
              const s = new Set(abiertos)
              if (abierto) s.delete(clave); else s.add(clave)
              setAbiertos(s)
            }}>{abierto ? '▾' : '▸'} {campo.label}: {nombre}</button>
            <span className="nota"> · {filasGrupo.length} registro(s){m.total && ` · ${totalTexto(filasGrupo)}`}</span>
          </td>
        </tr>,
        ...(abierto ? filasAgrupadas(filasGrupo, niveles.slice(1), clave) : []),
      ]
    })
  }

  return (
    <section>
      <h2>{m.titulo}</h2>
      {m.nota && <p className="nota">{m.nota}</p>}

      {escribe && !abierto && (
        <button type="button" onClick={() => { setEditando(null); setMsg(''); setError(''); setAbierto(true) }}>Crear</button>
      )}
      {escribe && abierto && (
        <Formulario key={editando?.id ?? 'nuevo'} m={m} empresa={empresa} fila={editando}
          onGuardado={(texto) => { setMsg(texto); cerrar(); cargar() }} onCancelar={cerrar} />
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && !error && <p className="ok" role="status">{msg}</p>}

      <div className="fila-controles">
        <label className="buscar">Buscar<input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} /></label>
        <label className="casilla"><input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Mostrar dados de baja</label>
        <span className="nota">{lista.length} registro(s){m.total && ` · ${m.total.label}: ${total}`}</span>
        <button type="button" className="secundario" onClick={exportar} disabled={lista.length === 0}>Exportar CSV</button>
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
            {m.agrupar ? filasAgrupadas(lista, m.agrupar, '') : lista.map(filaDatos)}
            {lista.length === 0 && <tr><td colSpan={columnas}>Sin registros.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
