import { useEffect, useState } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal, dinero } from './supabase'
import { aCsv, descargar } from './csv'
import { Formulario, type Fila } from './Catalogo'
import { MODULOS } from './modulos'
import { cuentasVigentes, diasEntre, enRD, fechaCorta, sumarDias, tasaVigenteUSD } from './comun'
import { Barra, Cabecera, Indicadores, Mensajes, RIESGO, botonAcento, botonBorde, control, entero, etiqueta, h2, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Software y suscripciones, reconstruida a partir de design/Software.dc.html con datos reales.
// El precio unitario es mensual: costo anual = contratadas × precio × 12, convertido a RD$.

export type Producto = Fila & {
  empresa_id: string; nombre: string; tipo: string; unidad: string; contratadas: number; asignadas: number; precio_unitario: number
  moneda: string; periodicidad: string; inicio: string; vence: string | null; renovacion: string; preaviso_dias: number; cuenta_contable: string | null
  proveedores: { nombre: string } | null; cuentas_proveedor: { numero: string } | null
}

const TIPOS: [string, string][] = [['SaaS', 'software como servicio'], ['PaaS', 'plataforma administrada'], ['IaaS', 'infraestructura en nube'], ['Licencia', 'derecho de uso y soporte'], ['Certificado', 'SSL y dominios']]
const TONO_TIPO: Record<string, [string, string]> = { SaaS: ['#1D3557', '#FFFFFF'], PaaS: ['#5B84B1', '#FFFFFF'], IaaS: ['#A9C1DA', '#131A22'], Licencia: ['#807451', '#FFFFFF'], Certificado: ['#d6cda5', '#262727'] }
const AVISO: [string, string] = ['#FFF4D6', '#6B4A00']
const EN_PLAZO: [string, string] = ['#E7F5EF', '#075B3F']
const SITUACIONES = [['ren', 'Renueva en 90 días'], ['libres', 'Más de 10 % sin asignar'], ['sincuenta', 'Sin cuenta contable']]
const SIN_FILTRO = { q: '', tipo: '', proveedor: '', sit: '' }
const columnas = '32px minmax(200px, 2fr) 100px minmax(150px, 1.2fr) 90px 60px 60px 60px 120px 130px 120px 130px'

// Renovación: plazo para cancelar = vencimiento − preaviso del contrato, y el aviso que corresponde hoy.
export function renovacion(p: Pick<Producto, 'vence' | 'preaviso_dias' | 'renovacion'>, hoy: string) {
  if (!p.vence) return null
  const plazo = sumarDias(p.vence, -Number(p.preaviso_dias))
  const dPlazo = diasEntre(hoy, plazo)
  const [aviso, tono]: [string, [string, string]] =
    dPlazo < 0 && p.renovacion === 'Automática' ? ['Renueva sola · plazo vencido', RIESGO]
      : dPlazo < 0 ? ['Gestionar renovación ya', RIESGO]
        : dPlazo <= 30 ? [`Decidir antes del ${fechaCorta(plazo).slice(0, 6)}`, AVISO]
          : ['En plazo', EN_PLAZO]
  return { dVence: diasEntre(hoy, p.vence), plazo, dPlazo, aviso, tono }
}

export const libres = (p: Pick<Producto, 'contratadas' | 'asignadas'>) => Number(p.contratadas) - Number(p.asignadas)
// Más del 10 % sin asignar (solo cuenta si hay más de una unidad contratada).
export const muchasLibres = (p: Pick<Producto, 'contratadas' | 'asignadas'>) => Number(p.contratadas) > 1 && libres(p) / Number(p.contratadas) > 0.1

export default function Software({ empresas, empresa, setEmpresa, puedeEscribir, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  puedeEscribir: boolean
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [productos, setProductos] = useState<Producto[]>([])
  const [cuentas, setCuentas] = useState<Set<string>>(new Set())
  const [tasa, setTasa] = useState<{ tasa: number; desde: string } | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [f, setF] = useState(SIN_FILTRO)
  const [verBajas, setVerBajas] = useState(false)
  const [formulario, setFormulario] = useState<{ fila: Producto | null } | null>(null) // null = cerrado
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const todas = co === 'all'
  const hoy = fechaLocal()
  useEffect(() => { if (empresa && co !== 'all') setCo(empresa) }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    const [p, c, t] = await Promise.all([
      leerTodo<Producto>((d, h) => {
        let q = supabase.from('productos_software').select('*, proveedores!productos_software_proveedor_id_fkey(nombre), cuentas_proveedor!productos_software_cuenta_proveedor_id_fkey(numero)')
        if (!todas) q = q.eq('empresa_id', co)
        return q.order('id').range(d, h)
      }),
      cuentasVigentes(co),
      tasaVigenteUSD(hoy),
    ])
    const fallo = p.error ?? c.error ?? t.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    setProductos(p.data)
    setCuentas(c.cuentas)
    setTasa(t.tasa)
  }
  useEffect(() => { cargar() }, [co]) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: string) => {
    setCo(id); setF(SIN_FILTRO); setAbiertos(new Set()); setFormulario(null); setMsg('')
    if (id !== 'all') setEmpresa(id)
  }
  const emp = empresas.find((e) => e.id === co)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const proveedor = (p: Producto) => p.proveedores?.nombre ?? ''
  const usd = tasa?.tasa ?? null
  const mensual = (p: Producto) => Number(p.contratadas) * Number(p.precio_unitario)
  const anualRD = (p: Producto) => enRD(p.moneda, mensual(p) * 12, usd) ?? 0
  const cuentaValida = (p: Producto) => !!p.cuenta_contable && cuentas.has(`${p.empresa_id}|${p.cuenta_contable}`)
  const porConsumo = (p: Producto) => p.unidad === 'Consumo'
  const abrir = (fila: Producto | null) => { setMsg(''); setError(''); setFormulario({ fila }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  async function cambiarEstado(p: Producto) {
    setError('')
    let cambios: Record<string, unknown> = { activo: true }
    if (p.activo) {
      const motivo = window.prompt('Motivo de la baja (el producto se conserva en el historial):')
      if (!motivo?.trim()) return
      cambios = { activo: false, baja_motivo: motivo.trim() }
    }
    const { error } = await supabase.from('productos_software').update(cambios).eq('id', p.id)
    if (error) setError(await mensajeError(error))
    else { setMsg(p.activo ? 'Producto dado de baja; se conserva en el historial.' : 'Producto reactivado.'); cargar() }
  }

  // Indicadores: productos activos.
  const activos = productos.filter((p) => p.activo)
  const licencias = activos.filter((p) => !porConsumo(p))
  const suma = (ls: Producto[], v: (p: Producto) => number) => ls.reduce((a, p) => a + v(p), 0)
  const total = suma(activos, anualRD)
  const enDolares = activos.filter((p) => p.moneda === 'US$')
  const contratadas = suma(licencias, (p) => Number(p.contratadas))
  const asignadas = suma(licencias, (p) => Number(p.asignadas))
  const costoLibres = suma(licencias, (p) => enRD(p.moneda, libres(p) * Number(p.precio_unitario) * 12, usd) ?? 0)
  const ren90 = activos.filter((p) => { const r = renovacion(p, hoy); return r && r.dVence >= 0 && r.dVence <= 90 })
  const sinCuenta = activos.filter((p) => !cuentaValida(p)).length
  const kpis = [
    { label: 'Costo anual (RD$)', value: `${(total / 1e6).toFixed(2)} M`, sub: `US$ ${entero(suma(enDolares, (p) => mensual(p) * 12))} · ${activos.length} productos${enDolares.length && !usd ? ' · sin tasa US$' : ''}`, color: 'var(--primario)' },
    { label: 'Licencias contratadas', value: contratadas.toLocaleString('en-US'), sub: 'Usuarios, equipos, certificados y dominios' },
    { label: 'Asignadas', value: asignadas.toLocaleString('en-US'), sub: contratadas ? `${((asignadas / contratadas) * 100).toFixed(1)} % de uso` : '—' },
    { label: 'Sin asignar', value: String(contratadas - asignadas), sub: `RD$ ${entero(costoLibres)} al año`, color: 'var(--riesgo)' },
    { label: 'Renovaciones 90 días', value: String(ren90.length), sub: `RD$ ${entero(suma(ren90, anualRD))} en juego` },
    { label: 'Sin cuenta contable', value: String(sinCuenta), sub: sinCuenta ? 'Revisar contra el catálogo' : 'Todo clasificado', color: sinCuenta ? 'var(--riesgo)' : 'var(--ahorro-tinta)' },
  ]

  const porTipo = TIPOS.map(([tipo, pista]) => {
    const del = activos.filter((p) => p.tipo === tipo)
    return { tipo, pista, n: del.length, costo: suma(del, anualRD) }
  }).filter((g) => g.n > 0)
  const maxTipo = Math.max(1, ...porTipo.map((g) => g.costo))
  const proximas = activos.map((p) => ({ p, r: renovacion(p, hoy) }))
    .filter((x): x is { p: Producto; r: NonNullable<ReturnType<typeof renovacion>> } => !!x.r && x.r.dVence >= 0 && x.r.dVence <= 120)
    .sort((a, b) => a.r.dVence - b.r.dVence)

  // Inventario con filtros.
  const situaciones = (p: Producto) => {
    const r = renovacion(p, hoy)
    return [r && r.dVence <= 90 && 'ren', muchasLibres(p) && 'libres', !cuentaValida(p) && 'sincuenta'].filter(Boolean)
  }
  const termino = f.q.trim().toLowerCase()
  const lista = productos.filter((p) => (verBajas || p.activo) && (!f.tipo || p.tipo === f.tipo) && (!f.proveedor || proveedor(p) === f.proveedor) &&
    (!f.sit || situaciones(p).includes(f.sit)) &&
    (!termino || [p.nombre, proveedor(p), p.cuentas_proveedor?.numero, p.tipo, p.cuenta_contable].join(' ').toLowerCase().includes(termino)))
    .sort((a, b) => anualRD(b) - anualRD(a))

  function exportar() {
    const encabezado = ['Empresa', 'Producto', 'Tipo', 'Proveedor', 'Cuenta proveedor', 'Unidad', 'Contratadas', 'Asignadas', 'Libres', 'Precio unitario mensual', 'Moneda', 'Costo anual RD$', 'Periodicidad', 'Inicio', 'Vence', 'Renovación', 'Preaviso (días)', 'Cuenta contable', 'Estado del registro']
    descargar(`software-${hoy}.csv`, aCsv(encabezado, lista.map((p) => [
      nombreEmpresa(p.empresa_id), p.nombre, p.tipo, proveedor(p), p.cuentas_proveedor?.numero, p.unidad, p.contratadas, p.asignadas, libres(p),
      Number(p.precio_unitario), p.moneda, enRD(p.moneda, mensual(p) * 12, usd), p.periodicidad, p.inicio, p.vence, p.renovacion, p.preaviso_dias,
      p.cuenta_contable, p.activo ? 'Activo' : `Baja: ${p.baja_motivo ?? ''}`,
    ])))
  }

  const derecha = { textAlign: 'right' } as const
  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo="Software y suscripciones" titulo="Software y suscripciones" empresas={empresas} co={co} elegir={elegir} ir={ir}
        subtitulo={`SaaS, PaaS, IaaS, licencias y certificados · Precios mensuales en moneda del contrato · Totales en RD$${usd ? ` a ${usd.toFixed(2)}` : ''} · Hoy ${fechaCorta(hoy)}`}
        crear={puedeEscribir && !formulario ? { texto: '+ Nuevo software / suscripción', onClick: () => abrir(null) } : undefined} />
      <Mensajes msg={msg} error={error} />

      {formulario && (
        <Formulario key={formulario.fila?.id ?? 'nuevo'} m={MODULOS.software} empresa={formulario.fila?.empresa_id ?? co} fila={formulario.fila}
          titulo={formulario.fila ? `Editar ${formulario.fila.nombre}` : `Nuevo software o suscripción · ${emp?.nombre ?? ''}`}
          onGuardado={(texto) => { setMsg(texto); setFormulario(null); cargar() }} onCancelar={() => setFormulario(null)} />
      )}

      <Indicadores etiqueta="Indicadores de software" kpis={kpis} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <section aria-labelledby="h-tipo" style={{ ...tarjeta, flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-tipo" style={h2}>Costo anual por tipo</h2>
            <span style={tenue}>RD$ M · clic para filtrar el inventario</span>
          </div>
          {porTipo.map((g) => <Barra key={g.tipo} nombre={g.tipo} detalle={`${g.n} productos · ${g.pista}`} valor={(g.costo / 1e6).toFixed(2)} ancho={(g.costo / maxTipo) * 100}
            onClick={() => setF({ ...SIN_FILTRO, tipo: f.tipo === g.tipo ? '' : g.tipo })} />)}
          {porTipo.length === 0 && <span style={tenue}>Sin productos activos.</span>}
        </section>
        <section aria-labelledby="h-ren" style={{ ...tarjeta, flex: '1 1 380px', minWidth: 0, gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-ren" style={h2}>Renovaciones próximas · 120 días</h2>
            <span style={tenue}>Plazo de cancelación = vencimiento − preaviso del contrato</span>
          </div>
          {proximas.map(({ p, r }) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--pista)' }}>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 44 }}>
                <b className="mono" style={{ fontSize: 18 }}>{p.vence!.slice(8, 10)}</b><span style={{ fontSize: 11, color: 'var(--tenue)' }}>{fechaCorta(p.vence!).slice(3, 6)}</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{p.nombre}</b>
                <span style={{ fontSize: 12, color: 'var(--tenue)' }}>{nombreEmpresa(p.empresa_id)} · {p.renovacion} · RD$ {entero(anualRD(p))} / año</span>
              </span>
              <span style={pastilla(r.tono)}>{r.aviso}</span>
            </div>
          ))}
          {proximas.length === 0 && <span style={tenue}>Nada vence en los próximos 120 días.</span>}
        </section>
      </div>

      <section aria-labelledby="h-inv" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-inv" style={h2}>Inventario de software y suscripciones</h2>
            <span style={tenue}>Expanda un producto para ver su vigencia, plazo de cancelación y costo de las unidades libres</span>
          </div>
          <span className="mono" style={tenue}>{lista.length} productos · RD$ {entero(suma(lista.filter((p) => p.activo), anualRD))} / año</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={etiqueta}>Buscar<input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Producto, proveedor, cuenta…" style={{ ...control, width: 220, padding: '0 12px' }} /></label>
          <label style={etiqueta}>Tipo
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} style={{ ...control, minWidth: 140 }}>
              <option value="">Todos</option>{TIPOS.map(([t]) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label style={etiqueta}>Proveedor
            <select value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} style={{ ...control, minWidth: 200 }}>
              <option value="">Todos</option>{[...new Set(productos.map(proveedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label style={etiqueta}>Situación
            <select value={f.sit} onChange={(e) => setF({ ...f, sit: e.target.value })} style={{ ...control, minWidth: 200 }}>
              <option value="">Todas</option>{SITUACIONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button style={botonBorde} onClick={() => setF(SIN_FILTRO)}>Limpiar filtros</button>
          <label className="casilla" style={{ fontSize: 13 }}><input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Mostrar dados de baja</label>
          <button style={botonBorde} onClick={exportar} disabled={lista.length === 0}>Exportar CSV</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1300, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: columnas, gap: 8, padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--tenue)', borderBottom: '1px solid var(--borde)' }}>
              <span /><span>Producto · empresa</span><span>Tipo</span><span>Proveedor · cuenta</span><span>Unidad</span><span style={derecha}>Contr.</span><span style={derecha}>Asig.</span>
              <span style={derecha}>Libres</span><span style={derecha}>Precio unit.</span><span style={derecha}>Costo anual RD$</span><span>Renueva</span><span>Cuenta contable</span>
            </div>
            {lista.map((p) => {
              const abierto = abiertos.has(p.id)
              const r = renovacion(p, hoy)
              const consumo = porConsumo(p)
              const colorRen = r && r.dPlazo < 0 ? 'var(--riesgo)' : r && r.dVence <= 90 ? AVISO[1] : 'var(--tenue)'
              const factor = p.moneda === 'US$' ? usd : 1
              return (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--pista)', opacity: p.activo ? 1 : 0.6 }}>
                  <button aria-expanded={abierto} onClick={() => { const n = new Set(abiertos); if (abierto) n.delete(p.id); else n.add(p.id); setAbiertos(n) }}
                    style={{ display: 'grid', gridTemplateColumns: columnas, gap: 8, alignItems: 'center', padding: 12, minHeight: 52, border: 'none', borderRadius: 0, background: abierto ? 'var(--suave)' : '#FFFFFF', color: 'var(--tinta)', fontSize: 14, fontWeight: 400, textAlign: 'left', width: '100%' }}>
                    <span className="mono" aria-hidden="true" style={{ color: 'var(--tenue)' }}>{abierto ? '▾' : '▸'}</span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}><b>{p.nombre}</b><span style={{ fontSize: 12, color: 'var(--tenue)' }}>{nombreEmpresa(p.empresa_id)}{!p.activo && ` · Baja: ${p.baja_motivo ?? ''}`}</span></span>
                    <span><span style={{ ...pastilla(TONO_TIPO[p.tipo] ?? ['#EEF1F4', '#3A4552']), padding: '3px 8px' }}>{p.tipo}</span></span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}><span>{proveedor(p)}</span><span className="mono" style={{ fontSize: 12, color: 'var(--tenue)' }}>{p.cuentas_proveedor?.numero}</span></span>
                    <span style={{ fontSize: 13 }}>{p.unidad}</span>
                    <span className="mono" style={derecha}>{consumo ? '—' : p.contratadas}</span>
                    <span className="mono" style={derecha}>{consumo ? '—' : p.asignadas}</span>
                    <span className="mono" style={{ ...derecha, color: muchasLibres(p) ? 'var(--riesgo)' : 'var(--tenue)' }}>{consumo ? '—' : libres(p)}</span>
                    <span className="mono" style={derecha}>{p.moneda} {dinero(Number(p.precio_unitario))}</span>
                    <span className="mono" style={{ ...derecha, fontWeight: 600 }}>{entero(anualRD(p))}</span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="mono">{p.vence ? fechaCorta(p.vence) : p.periodicidad}</span>
                      <span style={{ fontSize: 11, color: colorRen }}>{r ? (r.dVence < 0 ? 'vencido' : `en ${r.dVence} días`) : 'sin vencimiento'}</span>
                    </span>
                    <span><span className="mono" style={{ fontSize: 12, fontWeight: 600, padding: '3px 7px', borderRadius: 4, background: cuentaValida(p) ? 'var(--suave)' : AVISO[0], color: cuentaValida(p) ? 'var(--tinta)' : AVISO[1] }}>
                      {cuentaValida(p) ? p.cuenta_contable : p.cuenta_contable ? `${p.cuenta_contable} · revisar` : 'Por definir'}
                    </span></span>
                  </button>
                  {abierto && (
                    <div style={{ padding: '8px 12px 16px 52px', background: 'var(--suave)', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: 13, background: '#FFFFFF', border: '1px solid var(--pista)', borderRadius: 8, padding: 14, flex: '1 1 420px' }}>
                        <span style={{ color: 'var(--tenue)' }}>Moneda · periodicidad</span><span className="mono">{p.moneda} · {p.periodicidad}</span>
                        <span style={{ color: 'var(--tenue)' }}>Vigencia</span><span className="mono">{fechaCorta(p.inicio)} → {p.vence ? fechaCorta(p.vence) : 'sin vencimiento'}</span>
                        <span style={{ color: 'var(--tenue)' }}>Modalidad · preaviso</span><span className="mono">{p.renovacion} · {Number(p.preaviso_dias) ? `${p.preaviso_dias} días` : '—'}</span>
                        <span style={{ color: 'var(--tenue)' }}>Plazo de cancelación</span>
                        <span className="mono" style={{ color: colorRen }}>{r ? `${fechaCorta(r.plazo)}${r.dPlazo < 0 ? ' · vencido' : ` · en ${r.dPlazo} días`}` : 'No aplica'}</span>
                        <span style={{ color: 'var(--tenue)' }}>Costo por nuevo ingreso</span>
                        <span className="mono">{consumo ? 'No aplica' : factor ? `RD$ ${entero(Number(p.precio_unitario) * factor)} / mes por ${p.unidad.toLowerCase()}` : `${p.moneda} ${dinero(Number(p.precio_unitario))} / mes (sin tasa US$)`}</span>
                        <span style={{ color: 'var(--tenue)' }}>Costo de unidades libres</span>
                        <span className="mono" style={{ color: muchasLibres(p) ? 'var(--riesgo)' : undefined }}>{consumo ? '—' : `RD$ ${entero(enRD(p.moneda, libres(p) * Number(p.precio_unitario) * 12, usd) ?? 0)} / año`}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {puedeEscribir && p.activo && <button style={botonBorde} onClick={() => abrir(p)}>Editar producto</button>}
                        {esAdmin && <button style={botonBorde} onClick={() => cambiarEstado(p)}>{p.activo ? 'Dar de baja' : 'Reactivar'}</button>}
                        <button style={botonAcento} onClick={() => ir('gastos')}>Registrar compra o renovación →</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {lista.length === 0 && <p style={{ ...tenue, margin: 0, padding: 16, textAlign: 'center', fontSize: 14 }}>Ningún producto coincide con los filtros.</p>}
        <span style={{ fontSize: 12, color: 'var(--tenue)' }}>
          SaaS: software como servicio · PaaS: plataforma administrada · IaaS: infraestructura en la nube · Licencia: derecho de uso con soporte · Certificado: SSL y dominios. La cuenta contable se valida contra el catálogo de la empresa.
        </span>
      </section>
    </div>
  )
}
