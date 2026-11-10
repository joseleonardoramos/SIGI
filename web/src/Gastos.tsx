import { useEffect, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { supabase, mensajeError, fechaLocal, leerTodo, dinero } from './supabase'
import { fechaCorta } from './comun'
import { Cabecera, Mensajes, botonAcento, botonBorde, control, entero, etiqueta, h2, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Gastos y evidencias, reconstruida a partir de design/Gastos.dc.html con datos reales.
// Todo pasa por las funciones de la base (registrar_compromiso, registrar_movimiento, reversar_movimiento),
// que bloquean la partida y validan saldo, NCF y montos.

type Gasto = { id: string; empresa_id: string; codigo: string; origen: string; descripcion: string; moneda: string; tasa: number; partida_id: string | null; proveedor_id: string | null; cuenta_proveedor_id: string | null; cuenta_contable: string | null; creado_en: string }
export type Paso = { id: string; gasto_id: string; tipo: string; fecha: string; monto: number; documento: string | null; ncf: string | null; metodo_pago: string | null; referencia_bancaria: string | null; fuera_presupuesto_motivo: string | null; nota: string | null; reversado: boolean; creado_en: string }
type Evidencia = { id: string; paso_id: string; nombre: string; ruta_storage: string }
type Opcion = { id: string; etiqueta: string }
type Accion = 'Factura' | 'Pago' | 'Compromiso'

const hoy = () => fechaLocal()
const NUEVO = { codigo: '', origen: 'Partida', descripcion: '', partida: '', proveedor: '', cuenta: '', moneda: 'RD$', monto: '', fecha: hoy(), documento: '', motivo: '' }
const MOV = { monto: '', fecha: hoy(), documento: '', ncf: '', metodo: 'Transferencia', referencia: '', motivo: '', proveedor: '' }
const ORIGENES = ['Partida', 'Software', 'Telecom', 'Flotas']
const ESTADOS = ['Comprometido', 'Facturado parcial', 'Facturado', 'Pagado parcial', 'Pagado']
const TONO: Record<string, [string, string]> = {
  'Comprometido': ['#E6EEF7', '#1D3557'], 'Facturado parcial': ['#FFF4D6', '#6B4A00'], 'Facturado': ['#FFF4D6', '#6B4A00'], 'Pagado parcial': ['#E6EEF7', '#1D3557'], 'Pagado': ['#E7F5EF', '#075B3F'],
}
const COLOR_PASO: Record<string, string> = { Compromiso: '#5B84B1', Factura: '#C8642A', Pago: '#0B7A55', Evidencia: '#8E99A8', Reverso: '#8A3A12' }
const columnas = '28px 110px minmax(220px, 2fr) 90px minmax(180px, 1.4fr) 120px 120px 120px 120px 150px'
const derecha: CSSProperties = { textAlign: 'right' }

// Totales vigentes de un gasto: sin reversos ni movimientos reversados. Una factura mayor que el compromiso lo amplía.
export function totales(pasos: Pick<Paso, 'tipo' | 'monto' | 'reversado'>[]) {
  const suma = (t: string) => pasos.filter((p) => p.tipo === t && !p.reversado).reduce((a, p) => a + Number(p.monto), 0)
  const inv = suma('Factura')
  return { com: Math.max(suma('Compromiso'), inv), inv, paid: suma('Pago') }
}
export function estado({ com, inv, paid }: { com: number; inv: number; paid: number }) {
  if (inv > 0 && paid >= inv && inv >= com) return 'Pagado'
  if (paid > 0) return 'Pagado parcial'
  if (inv > 0 && inv >= com) return 'Facturado'
  if (inv > 0) return 'Facturado parcial'
  return 'Comprometido'
}
// Lo que falta revisar antes del cierre: facturas y pagos vigentes sin documento adjunto.
export function alertas(pasos: Pick<Paso, 'id' | 'tipo' | 'reversado'>[], conEvidencia: Set<string>) {
  const sin = (t: string) => pasos.some((p) => p.tipo === t && !p.reversado && !conEvidencia.has(p.id))
  return [sin('Factura') && 'Factura sin evidencia', sin('Pago') && 'Pago sin evidencia'].filter((x): x is string => !!x)
}

export default function Gastos({ empresas, empresa, setEmpresa, puedeEscribir, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  puedeEscribir: boolean
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [pasos, setPasos] = useState<Paso[]>([])
  const [evidencias, setEvidencias] = useState<Evidencia[]>([])
  const [marcas, setMarcas] = useState<Record<string, boolean>>({})
  const [partidas, setPartidas] = useState<(Opcion & { abierta: boolean; empresa_id: string })[]>([])
  const [proveedores, setProveedores] = useState<Opcion[]>([])
  const [cuentas, setCuentas] = useState<(Opcion & { proveedor_id: string })[]>([])
  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState(NUEVO)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion | null>(null) // el formulario del movimiento solo aparece al elegir una acción
  const [mov, setMov] = useState(MOV)
  const [kf, setKf] = useState('') // filtro desde un indicador
  const [f, setF] = useState({ q: '', origen: '', estado: '' })
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const todas = co === 'all'
  useEffect(() => { if (empresa && co !== 'all') setCo(empresa) }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    type FilaPartida = { id: string; empresa_id: string; codigo: string; nombre: string; presupuestos_versiones: { ejercicio: string; estado: string } | null }
    const de = <T,>(tabla: string, columnas: string, activos = true) => leerTodo<T>((d, h) => {
      let q = supabase.from(tabla).select(columnas)
      if (activos) q = q.eq('activo', true)
      if (!todas) q = q.eq('empresa_id', co)
      return q.order('id').range(d, h)
    })
    const [g, p, ev, m, pa, pr, cu] = await Promise.all([
      de<Gasto>('gastos', 'id, empresa_id, codigo, origen, descripcion, moneda, tasa, partida_id, proveedor_id, cuenta_proveedor_id, cuenta_contable, creado_en'),
      de<Paso>('gasto_pasos', 'id, gasto_id, tipo, fecha, monto, documento, ncf, metodo_pago, referencia_bancaria, fuera_presupuesto_motivo, nota, reversado, creado_en'),
      de<Evidencia>('evidencias', 'id, paso_id, nombre, ruta_storage'),
      leerTodo<{ entidad_id: string; marcado: boolean }>((d, h) => {
        let q = supabase.from('marcas_vigentes').select('entidad_id, marcado').eq('entidad', 'gastos')
        if (!todas) q = q.eq('empresa_id', co)
        return q.order('entidad_id').range(d, h)
      }),
      de<FilaPartida>('partidas', 'id, empresa_id, codigo, nombre, presupuestos_versiones!partidas_version_id_fkey(ejercicio, estado)'),
      leerTodo<{ id: string; nombre: string }>((d, h) => supabase.from('proveedores').select('id, nombre').eq('activo', true).order('nombre').order('id').range(d, h)),
      de<{ id: string; numero: string; proveedor_id: string }>('cuentas_proveedor', 'id, numero, proveedor_id'),
    ])
    const fallo = g.error ?? p.error ?? ev.error ?? m.error ?? pa.error ?? pr.error ?? cu.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    setGastos(g.data)
    setPasos(p.data)
    setEvidencias(ev.data)
    setMarcas(Object.fromEntries(m.data.map((x) => [x.entidad_id, x.marcado])))
    setPartidas(pa.data.map((x) => ({ id: x.id, empresa_id: x.empresa_id, abierta: x.presupuestos_versiones?.estado !== 'Cerrado', etiqueta: `${x.codigo} · ${x.nombre} (${x.presupuestos_versiones?.ejercicio ?? ''})` })))
    setProveedores(pr.data.map((x) => ({ id: x.id, etiqueta: x.nombre })))
    setCuentas(cu.data.map((x) => ({ id: x.id, etiqueta: x.numero, proveedor_id: x.proveedor_id })))
  }
  useEffect(() => { setAbierto(null); setCreando(false); setAccion(null); cargar() }, [co]) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: string) => { setCo(id); setKf(''); setMsg(''); if (id !== 'all') setEmpresa(id) }
  const emp = empresas.find((e) => e.id === co)
  const moneda = (todas ? empresas[0] : emp)?.moneda_reporte ?? 'RD$'
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''

  async function ejecutar(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setError('')
    setMsg('')
    const { error } = await fn()
    if (error) { setError(await mensajeError(error)); return false }
    setMsg(ok)
    await cargar()
    return true
  }

  async function crear(e: FormEvent) {
    e.preventDefault()
    const listo = await ejecutar(() => supabase.rpc('registrar_compromiso', {
      p_empresa: co, p_codigo: nuevo.codigo, p_origen: nuevo.origen, p_descripcion: nuevo.descripcion,
      p_monto: Number(nuevo.monto.replace(/,/g, '')), p_fecha: nuevo.fecha, p_moneda: nuevo.moneda,
      p_partida: nuevo.partida || null, p_proveedor: nuevo.proveedor || null, p_cuenta_proveedor: nuevo.cuenta || null,
      p_documento: nuevo.documento || null, p_motivo_fuera: nuevo.motivo || null,
    }), 'Gasto registrado con su compromiso.')
    if (listo) { setNuevo({ ...NUEVO, fecha: nuevo.fecha }); setCreando(false) }
  }

  async function agregarMovimiento(e: FormEvent) {
    e.preventDefault()
    if (!accion) return
    const listo = await ejecutar(() => supabase.rpc('registrar_movimiento', {
      p_gasto: abierto, p_tipo: accion, p_monto: Number(mov.monto.replace(/,/g, '')), p_fecha: mov.fecha,
      p_documento: mov.documento || null, p_ncf: mov.ncf || null, p_metodo_pago: accion === 'Pago' ? mov.metodo || null : null,
      p_referencia_bancaria: mov.referencia || null, p_motivo_fuera: mov.motivo || null, p_proveedor: mov.proveedor || null,
    }), { Factura: 'Factura registrada: la partida aumenta su ejecutado.', Pago: 'Pago registrado.', Compromiso: 'Compromiso ampliado.' }[accion])
    if (listo) { setMov(MOV); setAccion(null) }
  }

  async function reversar(p: Paso) {
    const motivo = window.prompt(`Motivo para reversar ${p.tipo.toLowerCase()} de ${dinero(Number(p.monto))}:`)
    if (!motivo?.trim()) return
    await ejecutar(() => supabase.rpc('reversar_movimiento', { p_paso: p.id, p_motivo: motivo.trim() }), 'Movimiento reversado; el original se conserva.')
  }

  async function marcarDireccion(g: Gasto) {
    await ejecutar(() => supabase.from('marcas_direccion').insert({ empresa_id: g.empresa_id, entidad: 'gastos', entidad_id: g.id, marcado: !marcas[g.id] }),
      marcas[g.id] ? 'Marca de Dirección retirada.' : 'Marcado como aprobado por Dirección.')
  }

  async function subirEvidencia(g: Gasto, paso: Paso, e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    const ruta = `${g.empresa_id}/${g.id}/${paso.id}/${Date.now()}-${archivo.name.replace(/[^\w.-]+/g, '_')}`
    setError('')
    const subida = await supabase.storage.from('evidencias').upload(ruta, archivo, { contentType: archivo.type })
    if (subida.error) { setError(`No se pudo subir: ${subida.error.message} (PDF, PNG o JPG de hasta 10 MB).`); return }
    await ejecutar(() => supabase.from('evidencias').insert({
      empresa_id: g.empresa_id, paso_id: paso.id, ruta_storage: ruta, nombre: archivo.name, tipo_mime: archivo.type, tamano_bytes: archivo.size,
    }), 'Evidencia agregada.')
  }

  async function verEvidencia(ev: Evidencia) {
    const { data, error } = await supabase.storage.from('evidencias').createSignedUrl(ev.ruta_storage, 120)
    if (error) setError(await mensajeError(error))
    else window.open(data.signedUrl, '_blank', 'noopener')
  }

  // Cada gasto con sus pasos, totales, estado y alertas.
  const conEvidencia = new Set(evidencias.map((e) => e.paso_id))
  const nombre = (lista: Opcion[], id: string | null) => lista.find((x) => x.id === id)?.etiqueta ?? ''
  const filas = gastos.map((g) => {
    const ps = pasos.filter((p) => p.gasto_id === g.id).sort((a, b) => a.creado_en.localeCompare(b.creado_en))
    const t = totales(ps)
    return { g, ps, t, est: estado(t), al: alertas(ps, conEvidencia) }
  }).sort((a, b) => b.g.creado_en.localeCompare(a.g.creado_en))
  type FilaGasto = (typeof filas)[number]
  const enReporte = (x: FilaGasto, v: number) => v * Number(x.g.tasa)
  const suma = (v: (x: FilaGasto) => number) => filas.reduce((a, x) => a + enReporte(x, v(x)), 0)
  const porPagar = suma((x) => x.t.inv - x.t.paid)
  const conAlerta = filas.filter((x) => x.al.length).length
  const kpis: [string, string, string, string, string?][] = [
    ['', 'Gastos registrados', String(filas.length), `Importes en ${moneda} a la tasa registrada`],
    ['com', 'Comprometido pendiente', entero(suma((x) => x.t.com - x.t.inv)), 'Reservado en la partida, sin factura', 'var(--primario)'],
    ['inv', 'Facturado (ejecutado)', entero(suma((x) => x.t.inv)), 'Ya descuenta del disponible'],
    ['paid', 'Pagado', entero(suma((x) => x.t.paid)), 'No vuelve a descontar', 'var(--ahorro-tinta)'],
    ['due', 'Por pagar', entero(porPagar), 'Facturas pendientes de pago', porPagar > 0 ? 'var(--riesgo)' : 'var(--tenue)'],
    ['flag', 'Sin evidencia', String(conAlerta), 'Revisar antes del cierre', conAlerta ? 'var(--riesgo)' : 'var(--ahorro-tinta)'],
  ]
  const pasaKpi = (x: FilaGasto) => !kf || (kf === 'com' && x.t.com > x.t.inv) || (kf === 'inv' && x.t.inv > 0) || (kf === 'paid' && x.t.paid > 0) || (kf === 'due' && x.t.inv > x.t.paid) || (kf === 'flag' && x.al.length > 0)
  const termino = f.q.trim().toLowerCase()
  const lista = filas.filter((x) => pasaKpi(x) && (!f.origen || x.g.origen === f.origen) && (!f.estado || x.est === f.estado) &&
    (!termino || [x.g.codigo, x.g.descripcion, nombre(proveedores, x.g.proveedor_id), ...x.ps.flatMap((p) => [p.documento, p.ncf, p.referencia_bancaria])].join(' ').toLowerCase().includes(termino)))

  const partidasEmpresa = partidas.filter((p) => p.abierta && p.empresa_id === co)
  const campo = (label: string, input: ReactNode, ancho = false) => <label style={{ ...etiqueta, ...(ancho ? { gridColumn: 'span 2' } : {}) }}>{label}{input}</label>
  const entrada = (valor: string, cambiar: (v: string) => void, props: Record<string, unknown> = {}) =>
    <input value={valor} onChange={(e) => cambiar(e.target.value)} style={control} {...props} />

  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo="Gastos y evidencias" titulo="Gastos y evidencias" empresas={empresas} co={co} elegir={elegir} ir={ir}
        subtitulo={`Compromiso → factura → pago, con sus documentos · Cada paso actualiza la ejecución de la partida · Importes en ${moneda} a la tasa registrada`}
        crear={puedeEscribir && !creando ? { texto: '+ Registrar gasto', onClick: () => { setNuevo({ ...NUEVO, fecha: hoy() }); setMsg(''); setError(''); setCreando(true) } } : undefined} />
      <Mensajes msg={msg} error={error} />

      <section aria-label="Indicadores de gasto" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {kpis.map(([k, label, value, sub, color]) => (
          <button key={label} onClick={() => setKf(kf === k ? '' : k)} aria-pressed={kf === k && k !== ''}
            style={{ background: '#FFFFFF', border: kf === k && k ? '2px solid var(--boton-activo)' : '1px solid var(--borde)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', color: 'var(--tinta)', fontWeight: 400 }}>
            <span style={{ fontSize: 13, color: 'var(--tenue)', fontWeight: 600 }}>{label}</span>
            <span className="mono" style={{ fontSize: 24, fontWeight: 600, color: color ?? 'var(--tinta)' }}>{value}</span>
            <span style={{ fontSize: 12, color: 'var(--tenue)' }}>{sub}</span>
          </button>
        ))}
      </section>

      {creando && (
        <form onSubmit={crear} aria-labelledby="h-nuevo" style={{ ...tarjeta, border: '2px solid var(--acento)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 id="h-nuevo" style={h2}>Registrar gasto · {emp?.nombre}</h2>
            <button type="button" aria-label="Cerrar formulario" onClick={() => setCreando(false)} style={{ ...botonBorde, width: 40, padding: 0, fontSize: 16 }}>×</button>
          </div>
          {[
            ['¿Qué se compra?', <>
              {campo('Código *', entrada(nuevo.codigo, (v) => setNuevo({ ...nuevo, codigo: v }), { required: true }))}
              {campo('Módulo', <select value={nuevo.origen} onChange={(e) => setNuevo({ ...nuevo, origen: e.target.value })} style={control}>{ORIGENES.map((o) => <option key={o}>{o}</option>)}</select>)}
              {campo('Descripción *', entrada(nuevo.descripcion, (v) => setNuevo({ ...nuevo, descripcion: v }), { required: true, placeholder: 'Renovación certificado SSL 2027' }), true)}
            </>],
            ['Proveedor e imputación', <>
              {campo('Proveedor (del maestro)', <select value={nuevo.proveedor} onChange={(e) => setNuevo({ ...nuevo, proveedor: e.target.value, cuenta: '' })} style={control}>
                <option value="">—</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}</select>)}
              {campo('Cuenta de proveedor', <select value={nuevo.cuenta} onChange={(e) => setNuevo({ ...nuevo, cuenta: e.target.value })} style={control}>
                <option value="">—</option>{cuentas.filter((c) => c.proveedor_id === nuevo.proveedor).map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}</select>)}
              {campo('Partida presupuestaria', <select value={nuevo.partida} onChange={(e) => setNuevo({ ...nuevo, partida: e.target.value })} style={control}>
                <option value="">Sin partida (fuera de presupuesto)</option>{partidasEmpresa.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}</select>, true)}
            </>],
            ['Primer documento: orden de compra o contrato', <>
              {campo('Número de documento', entrada(nuevo.documento, (v) => setNuevo({ ...nuevo, documento: v }), { placeholder: 'OC-0000' }))}
              {campo('Fecha *', entrada(nuevo.fecha, (v) => setNuevo({ ...nuevo, fecha: v }), { type: 'date', required: true }))}
              {campo('Moneda', <select value={nuevo.moneda} onChange={(e) => setNuevo({ ...nuevo, moneda: e.target.value })} style={control}><option>RD$</option><option>US$</option></select>)}
              {campo('Monto comprometido *', entrada(nuevo.monto, (v) => setNuevo({ ...nuevo, monto: v }), { required: true, inputMode: 'decimal' }))}
              {campo('Motivo si queda fuera de presupuesto', entrada(nuevo.motivo, (v) => setNuevo({ ...nuevo, motivo: v })), true)}
            </>],
          ].map(([leyenda, campos]) => (
            <fieldset key={String(leyenda)} style={{ border: '1px solid var(--pista)', borderRadius: 10, padding: 14, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              <legend style={{ fontSize: 13, fontWeight: 600, padding: '0 6px' }}>{leyenda}</legend>
              {campos}
            </fieldset>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button type="submit" style={{ ...botonAcento, height: 44 }}>Registrar</button>
            <button type="button" style={{ ...botonBorde, height: 44 }} onClick={() => setCreando(false)}>Cancelar</button>
            <span style={{ fontSize: 12, color: 'var(--tenue)' }}>Si supera el disponible de la partida, se rechaza salvo que indique el motivo. Las evidencias se adjuntan a cada paso, después de registrarlo. ¿El proveedor no está? Créelo en Catálogos → Proveedores.</span>
          </div>
        </form>
      )}

      <section aria-labelledby="h-lista" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-lista" style={h2}>Gastos registrados</h2>
            <span style={tenue}>{lista.length} de {filas.length} gastos · expanda uno para ver su historial y registrar el siguiente paso</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <label style={etiqueta}>Buscar<input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Descripción, documento, NCF…" style={{ ...control, width: 220 }} /></label>
            <label style={etiqueta}>Módulo<select value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })} style={{ ...control, minWidth: 130 }}><option value="">Todos</option>{ORIGENES.map((o) => <option key={o}>{o}</option>)}</select></label>
            <label style={etiqueta}>Estado<select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} style={{ ...control, minWidth: 170 }}><option value="">Todos</option>{ESTADOS.map((o) => <option key={o}>{o}</option>)}</select></label>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1260, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: columnas, gap: 8, padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--tenue)', borderBottom: '1px solid var(--borde)' }}>
              <span /><span>Código</span><span>Gasto · empresa</span><span>Módulo</span><span>Proveedor · partida</span>
              <span style={derecha}>Comprometido</span><span style={derecha}>Facturado</span><span style={derecha}>Pagado</span><span style={derecha}>Por pagar</span><span>Estado</span>
            </div>
            {lista.map(({ g, ps, t, est, al }) => {
              const abiertoAqui = abierto === g.id
              const partida = nombre(partidas, g.partida_id)
              const pendienteFacturar = t.com - t.inv
              const pendientePagar = t.inv - t.paid
              const acciones: [Accion, string, boolean][] = [['Factura', 'Registrar factura', true], ['Pago', 'Marcar pagado', pendientePagar > 0], ['Compromiso', 'Ampliar compromiso', true]]
              return (
                <div key={g.id} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--pista)' }}>
                  <button aria-expanded={abiertoAqui} onClick={() => { setAbierto(abiertoAqui ? null : g.id); setAccion(null); setMov(MOV) }}
                    style={{ display: 'grid', gridTemplateColumns: columnas, gap: 8, alignItems: 'center', padding: 12, minHeight: 52, border: 'none', borderRadius: 0, background: abiertoAqui ? 'var(--suave)' : '#FFFFFF', color: 'var(--tinta)', fontSize: 14, fontWeight: 400, textAlign: 'left', width: '100%' }}>
                    <span className="mono" aria-hidden="true" style={{ color: 'var(--tenue)' }}>{abiertoAqui ? '▾' : '▸'}</span>
                    <span className="mono" style={{ fontSize: 13 }}>{g.codigo}</span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}><b>{g.descripcion}</b><span style={{ fontSize: 12, color: 'var(--tenue)' }}>{nombreEmpresa(g.empresa_id)}{marcas[g.id] ? ' · Aprobado por Dirección' : ''}</span></span>
                    <span style={{ fontSize: 13 }}>{g.origen}</span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}><span>{nombre(proveedores, g.proveedor_id) || '—'}</span><span className="mono" style={{ fontSize: 12, color: 'var(--tenue)' }}>{partida || (g.partida_id ? '(presupuesto cerrado)' : 'Fuera de presupuesto')}</span></span>
                    <span className="mono" style={derecha}>{g.moneda} {dinero(t.com)}</span>
                    <span className="mono" style={derecha}>{g.moneda} {dinero(t.inv)}</span>
                    <span className="mono" style={derecha}>{g.moneda} {dinero(t.paid)}</span>
                    <span className="mono" style={{ ...derecha, color: pendientePagar > 0 ? 'var(--riesgo)' : 'var(--tenue)' }}>{g.moneda} {dinero(pendientePagar)}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <span style={pastilla(TONO[est])}>{est}</span>
                      {al.length > 0 && <span style={{ fontSize: 11, color: '#8A3A12' }}>{al.join(' · ')}</span>}
                    </span>
                  </button>
                  {abiertoAqui && (
                    <div style={{ padding: '12px 12px 18px 40px', background: 'var(--suave)', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{ ...tarjeta, flex: '2 1 560px', padding: 16, gap: 10 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                          <b style={{ fontSize: 13 }}>Historial y evidencias</b>
                          {esAdmin
                            ? <button onClick={() => marcarDireccion(g)} aria-pressed={!!marcas[g.id]} style={{ ...botonBorde, height: 36, background: marcas[g.id] ? '#E7F5EF' : '#FFFFFF', color: marcas[g.id] ? '#075B3F' : 'var(--tinta)' }}>
                                {marcas[g.id] ? 'Aprobado por Dirección (quitar)' : 'Marcar aprobado por Dirección'}</button>
                            : marcas[g.id] && <span style={pastilla(['#E7F5EF', '#075B3F'])}>Aprobado por Dirección</span>}
                          <span style={{ fontSize: 12, color: 'var(--tenue)' }}>Solo el Administrador. Informativo: no bloquea registros.</span>
                        </div>
                        {ps.map((p) => {
                          const evs = evidencias.filter((e) => e.paso_id === p.id)
                          const detalle = p.tipo === 'Compromiso' ? `Orden / contrato ${p.documento ?? '—'}` : p.tipo === 'Factura' ? `Factura ${p.documento ?? ''}${p.ncf ? ` · NCF ${p.ncf}` : ''}`
                            : p.tipo === 'Pago' ? `${p.metodo_pago ?? 'Pago'}${p.referencia_bancaria ? ` · ref. ${p.referencia_bancaria}` : ''}` : p.nota ?? p.tipo
                          return (
                            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '110px minmax(180px, 1fr) 130px 110px', gap: 8, alignItems: 'start', padding: '8px 0', borderTop: '1px solid var(--pista)', fontSize: 13, opacity: p.reversado ? 0.55 : 1 }}>
                              <b style={{ color: COLOR_PASO[p.tipo], textDecoration: p.reversado ? 'line-through' : undefined }}>{p.tipo}</b>
                              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span>{detalle}{p.reversado && ' · Reversado'}</span>
                                {p.fuera_presupuesto_motivo && <span style={{ fontSize: 12, color: 'var(--riesgo)' }}>Fuera de presupuesto: {p.fuera_presupuesto_motivo}</span>}
                                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                  {evs.map((ev) => <button key={ev.id} className="enlace" onClick={() => verEvidencia(ev)} style={{ fontSize: 12 }}>{ev.nombre}</button>)}
                                  {!evs.length && (p.tipo === 'Factura' || p.tipo === 'Pago') && !p.reversado && <span style={{ fontSize: 12, color: '#8A3A12' }}>Sin evidencia adjunta</span>}
                                  {puedeEscribir && p.tipo !== 'Reverso' && <label className="subir">+ Adjuntar<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => subirEvidencia(g, p, e)} /></label>}
                                </span>
                              </span>
                              <span className="mono" style={derecha}>{Number(p.monto) ? `${g.moneda} ${dinero(Number(p.monto))}` : ''}</span>
                              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                                <span className="mono">{fechaCorta(p.fecha)}</span>
                                {puedeEscribir && !p.reversado && p.tipo !== 'Reverso' && <button className="secundario" onClick={() => reversar(p)}>Reversar</button>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ ...tarjeta, flex: '1 1 340px', padding: 16, gap: 10 }}>
                        <b style={{ fontSize: 13 }}>Siguiente paso</b>
                        {puedeEscribir && (
                          <div role="group" aria-label="Acción" style={{ display: 'flex', flexWrap: 'wrap', border: '1px solid var(--borde)', borderRadius: 8, overflow: 'hidden', alignSelf: 'flex-start' }}>
                            {acciones.map(([k, label, habilitada]) => (
                              <button key={k} disabled={!habilitada} aria-pressed={accion === k} onClick={() => { setAccion(accion === k ? null : k); setMov({ ...MOV, fecha: hoy(), monto: k === 'Factura' && pendienteFacturar > 0 ? String(pendienteFacturar) : k === 'Pago' && pendientePagar > 0 ? String(pendientePagar) : '' }) }}
                                style={{ height: 38, padding: '0 12px', border: 'none', borderRadius: 0, fontSize: 13, fontWeight: 600, background: accion === k ? 'var(--boton-activo)' : '#FFFFFF', color: accion === k ? '#FFFFFF' : 'var(--tinta)' }}>{label}</button>
                            ))}
                          </div>
                        )}
                        {puedeEscribir && accion && (
                          <form onSubmit={agregarMovimiento} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                            {campo(`Monto (${g.moneda}) *`, entrada(mov.monto, (v) => setMov({ ...mov, monto: v }), { required: true, inputMode: 'decimal' }))}
                            {campo('Fecha *', entrada(mov.fecha, (v) => setMov({ ...mov, fecha: v }), { type: 'date', required: true }))}
                            {accion === 'Factura' && <>
                              {campo('No. factura', entrada(mov.documento, (v) => setMov({ ...mov, documento: v }), { placeholder: 'F-0000' }))}
                              {campo('NCF / e-CF *', entrada(mov.ncf, (v) => setMov({ ...mov, ncf: v }), { required: true, placeholder: 'B0100000001' }))}
                              {!g.proveedor_id && campo('Proveedor de la factura *', <select required value={mov.proveedor} onChange={(e) => setMov({ ...mov, proveedor: e.target.value })} style={control}>
                                <option value="">—</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}</select>)}
                            </>}
                            {accion === 'Pago' && <>
                              {campo('Forma de pago', <select value={mov.metodo} onChange={(e) => setMov({ ...mov, metodo: e.target.value })} style={control}>
                                {['Transferencia', 'Cheque', 'Tarjeta corporativa', 'Efectivo'].map((o) => <option key={o}>{o}</option>)}</select>)}
                              {campo('Referencia bancaria', entrada(mov.referencia, (v) => setMov({ ...mov, referencia: v }), { placeholder: 'TRX-000000' }))}
                            </>}
                            {accion === 'Compromiso' && campo('Orden o contrato', entrada(mov.documento, (v) => setMov({ ...mov, documento: v })))}
                            {accion !== 'Pago' && campo('Motivo si excede el presupuesto', entrada(mov.motivo, (v) => setMov({ ...mov, motivo: v })), true)}
                            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                              <button type="submit" style={botonAcento}>{{ Factura: 'Registrar factura', Pago: 'Registrar pago', Compromiso: 'Ampliar compromiso' }[accion]}</button>
                              <button type="button" style={botonBorde} onClick={() => setAccion(null)}>Cancelar</button>
                            </div>
                            <span style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--tenue)' }}>Después de registrarlo, adjunte el documento con «+ Adjuntar» en el historial.</span>
                          </form>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 14px', fontSize: 13, borderTop: '1px solid var(--pista)', paddingTop: 10 }}>
                          <span style={{ color: 'var(--tenue)' }}>Cuenta proveedor</span><span className="mono">{nombre(cuentas, g.cuenta_proveedor_id) || '—'}</span>
                          <span style={{ color: 'var(--tenue)' }}>Cuenta contable</span><span className="mono">{g.cuenta_contable || 'Por definir'}</span>
                          <span style={{ color: 'var(--tenue)' }}>Moneda · tasa</span><span className="mono">{g.moneda} · {Number(g.tasa).toFixed(4)}</span>
                          <span style={{ color: 'var(--tenue)' }}>Por facturar</span><span className="mono">{g.moneda} {dinero(Math.max(0, pendienteFacturar))}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {lista.length === 0 && <p style={{ ...tenue, margin: 0, padding: 16, textAlign: 'center', fontSize: 14 }}>No hay gastos con estos filtros.</p>}
        <span style={{ fontSize: 12, color: 'var(--tenue)' }}>
          Reglas: la factura libera solo la porción del compromiso que cubre y cuenta como ejecutado; el pago no vuelve a disminuir el disponible. Nada se borra: las correcciones se hacen con reverso y quedan en el historial.
        </span>
      </section>
    </div>
  )
}
