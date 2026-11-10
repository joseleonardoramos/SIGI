import { useEffect, useState } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal, dinero } from './supabase'
import { aCsv, descargar } from './csv'
import { Formulario, type Fila } from './Catalogo'
import { MODULOS, ESTATUS_TELECOM } from './modulos'
import { Barra, Cabecera, Indicadores, Mensajes, Paginador, RIESGO, botonAcento, botonBorde, control, entero, etiqueta, h2, miles, paginaValida, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Telecomunicaciones, reconstruida a partir de design/Telecom.dc.html con datos reales.
// Alta y edición usan el formulario genérico del módulo (modulos.ts); la base valida y guarda la bitácora.

export type Servicio = Fila & {
  empresa_id: string; sucursal: string; ciudad: string | null; tipo: string; detalle: string; velocidad: string | null
  moneda: string; monto: number; circuito: string | null; cuenta_contable: string | null; estatus: string
  vence: string | null; comentarios: string | null
  proveedores: { nombre: string } | null; cuentas_proveedor: { numero: string } | null
}

const TIPOS = ['Internet', 'Telefonía', 'Metro Ethernet', 'Internet Móvil']
const TONO: Record<string, [string, string]> = {
  'Activo': ['#E7F5EF', '#075B3F'], 'En renegociación': ['#FFF4D6', '#6B4A00'], 'Upgrade solicitado': ['#E6EEF7', '#1D3557'],
  'Migración a SIP': ['#E6EEF7', '#1D3557'], 'Baja programada': ['#FBE9DF', '#8A3A12'],
}
const tono = (estatus: string): [string, string] => TONO[estatus] ?? ['#EEF1F4', '#3A4552']
const POR_PAGINA = 20
const SIN_FILTRO = { q: '', sucursal: '', tipo: '', proveedor: '', cuenta: '', moneda: '', estatus: '' }
const nombreProveedor = (s: Servicio) => s.proveedores?.nombre ?? ''

// Costo mensual en RD$: US$ a la tasa vigente; sin tasa registrada, los US$ no se suman (null).
export const enRD = (s: Pick<Servicio, 'moneda' | 'monto'>, tasaUSD: number | null) =>
  s.moneda === 'US$' ? (tasaUSD ? Number(s.monto) * tasaUSD : null) : Number(s.monto)

// Una sucursal tiene respaldo si cuenta con dos o más accesos a internet (fijo o móvil).
export const tieneRespaldo = (servicios: Pick<Servicio, 'tipo'>[]) =>
  servicios.filter((s) => s.tipo === 'Internet' || s.tipo === 'Internet Móvil').length >= 2

export default function Telecom({ empresas, empresa, setEmpresa, puedeEscribir, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  puedeEscribir: boolean
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cuentas, setCuentas] = useState<Set<string>>(new Set()) // empresa|código de cuentas contables vigentes
  const [tasa, setTasa] = useState<{ tasa: number; desde: string } | null>(null)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [f, setF] = useState(SIN_FILTRO)
  const [verBajas, setVerBajas] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [formulario, setFormulario] = useState<{ fila: Servicio | null } | null>(null) // null = cerrado
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const todas = co === 'all'
  const hoy = fechaLocal()
  useEffect(() => { if (empresa && co !== 'all') setCo(empresa) }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    const de = <T,>(tabla: string, columnas: string, soloActivos = true) => leerTodo<T>((d, h) => {
      let q = supabase.from(tabla).select(columnas)
      if (soloActivos) q = q.eq('activo', true)
      if (!todas) q = q.eq('empresa_id', co)
      return q.order('id').range(d, h)
    })
    const [s, c, t] = await Promise.all([
      de<Servicio>('servicios_telecom', '*, proveedores!servicios_telecom_proveedor_id_fkey(nombre), cuentas_proveedor!servicios_telecom_cuenta_proveedor_id_fkey(numero)', false),
      de<{ empresa_id: string; codigo: string; estado: string }>('cuentas_contables', 'empresa_id, codigo, estado'),
      supabase.from('tasas_cambio').select('tasa, vigente_desde').eq('activo', true).eq('moneda', 'US$').lte('vigente_desde', hoy)
        .order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
    ])
    const fallo = s.error ?? c.error ?? t.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    setServicios(s.data)
    setCuentas(new Set(c.data.filter((x) => x.estado !== 'Inactiva').map((x) => `${x.empresa_id}|${x.codigo}`)))
    setTasa(t.data ? { tasa: Number(t.data.tasa), desde: t.data.vigente_desde } : null)
  }
  useEffect(() => { cargar() }, [co]) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: string) => {
    setCo(id); setF(SIN_FILTRO); setPagina(0); setAbiertas(new Set()); setFormulario(null); setMsg('')
    if (id !== 'all') setEmpresa(id)
  }
  const filtrar = (cambio: Partial<typeof SIN_FILTRO>) => { setF({ ...SIN_FILTRO, ...cambio }); setPagina(0) }
  const emp = empresas.find((e) => e.id === co)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const usd = tasa?.tasa ?? null
  const rd = (s: Servicio) => enRD(s, usd) ?? 0
  const cuentaValida = (s: Servicio) => !!s.cuenta_contable && cuentas.has(`${s.empresa_id}|${s.cuenta_contable}`)

  async function cambiarEstado(s: Servicio) {
    setError('')
    let cambios: Record<string, unknown> = { activo: true }
    if (s.activo) {
      const motivo = window.prompt('Motivo de la baja (el servicio se conserva en el historial):')
      if (!motivo?.trim()) return
      cambios = { activo: false, baja_motivo: motivo.trim() }
    }
    const { error } = await supabase.from('servicios_telecom').update(cambios).eq('id', s.id)
    if (error) setError(await mensajeError(error))
    else { setMsg(s.activo ? 'Servicio dado de baja; se conserva en el historial.' : 'Servicio reactivado.'); cargar() }
  }

  const abrir = (fila: Servicio | null) => { setMsg(''); setError(''); setFormulario({ fila }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  // Indicadores y tableros: solo servicios activos.
  const activos = servicios.filter((s) => s.activo)
  const total = activos.reduce((a, s) => a + rd(s), 0)
  const enDolares = activos.filter((s) => s.moneda === 'US$')
  const enGestion = activos.filter((s) => s.estatus !== 'Activo')
  const sinCuenta = activos.filter((s) => !cuentaValida(s))
  const limite = fechaLocal(new Date(Date.now() + 90 * 864e5))
  const vencen = activos.filter((s) => s.vence && s.vence >= hoy && s.vence <= limite)
  const sucursales = Object.values(activos.reduce<Record<string, { clave: string; empresa_id: string; nombre: string; ciudad: string; svcs: Servicio[] }>>((acc, s) => {
    const clave = `${s.empresa_id}|${s.sucursal}`
    acc[clave] ??= { clave, empresa_id: s.empresa_id, nombre: s.sucursal, ciudad: s.ciudad ?? '', svcs: [] }
    acc[clave].svcs.push(s)
    return acc
  }, {})).map((x) => ({ ...x, costo: x.svcs.reduce((a, s) => a + rd(s), 0), respaldo: tieneRespaldo(x.svcs) }))
    .sort((a, b) => b.costo - a.costo)
  const conRespaldo = sucursales.filter((x) => x.respaldo).length
  const proveedores = new Set(activos.map(nombreProveedor).filter(Boolean))

  const kpis = [
    { label: 'Servicios', value: String(activos.length), sub: `${sucursales.length} ubicaciones · ${proveedores.size} proveedores` },
    { label: 'Costo mensual (RD$)', value: `${(total / 1e6).toFixed(2)} M`, sub: usd ? `US$ a ${usd.toFixed(2)} (vigente desde ${tasa!.desde})` : enDolares.length ? 'Sin tasa US$: los US$ no se suman' : 'Todo en RD$', color: 'var(--primario)' },
    { label: 'Contratos en US$', value: String(enDolares.length), sub: `US$ ${dinero(enDolares.reduce((a, s) => a + Number(s.monto), 0))} / mes` },
    { label: 'Sucursales con respaldo', value: `${conRespaldo} / ${sucursales.length}`, sub: `${sucursales.length - conRespaldo} con enlace único` },
    { label: 'Servicios en gestión', value: String(enGestion.length), sub: `${miles(enGestion.reduce((a, s) => a + rd(s), 0))} K RD$ / mes` },
    { label: 'Vencen en 90 días', value: String(vencen.length), sub: `Hasta ${limite}`, color: 'var(--riesgo)' },
    { label: 'Sin cuenta contable válida', value: String(sinCuenta.length), sub: sinCuenta.length ? 'No se imputan hasta corregir' : 'Todo clasificado', color: sinCuenta.length ? 'var(--riesgo)' : 'var(--ahorro-tinta)' },
  ]

  const porTipo = TIPOS.map((t) => {
    const del = activos.filter((s) => s.tipo === t)
    return { tipo: t, n: del.length, costo: del.reduce((a, s) => a + rd(s), 0) }
  }).filter((g) => g.n > 0)
  const maxTipo = Math.max(1, ...porTipo.map((g) => g.costo))

  const porEstatus = [...new Set(enGestion.map((s) => s.estatus))].map((st) => {
    const del = enGestion.filter((s) => s.estatus === st)
    return { nombre: st, n: del.length, costo: del.reduce((a, s) => a + rd(s), 0), color: tono(st), elegir: () => filtrar({ estatus: st }) }
  })
  if (sinCuenta.length) porEstatus.push({ nombre: 'Sin cuenta contable válida', n: sinCuenta.length, costo: sinCuenta.reduce((a, s) => a + rd(s), 0), color: RIESGO, elegir: () => filtrar({ cuenta: '__ninguna' }) })
  const maxSucursal = Math.max(1, ...sucursales.map((x) => x.costo))

  // Listado completo con filtros.
  const termino = f.q.trim().toLowerCase()
  const listado = servicios.filter((s) => (verBajas || s.activo) &&
    (!f.sucursal || s.sucursal === f.sucursal) && (!f.tipo || s.tipo === f.tipo) && (!f.proveedor || nombreProveedor(s) === f.proveedor) &&
    (!f.cuenta || (f.cuenta === '__ninguna' ? !cuentaValida(s) : s.cuenta_contable === f.cuenta)) &&
    (!f.moneda || s.moneda === f.moneda) && (!f.estatus || s.estatus === f.estatus) &&
    (!termino || [s.sucursal, s.ciudad, nombreProveedor(s), s.cuentas_proveedor?.numero, s.cuenta_contable, s.circuito, s.detalle, s.tipo, s.comentarios]
      .join(' ').toLowerCase().includes(termino)))
    .sort((a, b) => a.sucursal.localeCompare(b.sucursal, 'es') || a.tipo.localeCompare(b.tipo, 'es'))
  const pag = paginaValida(pagina, listado.length, POR_PAGINA)
  const unicos = (v: (string | null | undefined)[]) => [...new Set(v.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'es'))

  function exportar() {
    const encabezado = ['Empresa', 'Sucursal', 'Ubicación', 'Proveedor', 'Cuenta proveedor', 'Cuenta contable', 'No. circuito', 'Estatus', 'Detalle', 'Tipo', 'Velocidad', 'Moneda', 'Monto', 'Monto RD$', 'Vence', 'Comentarios', 'Estado del registro']
    descargar(`telecomunicaciones-${hoy}.csv`, aCsv(encabezado, listado.map((s) => [
      nombreEmpresa(s.empresa_id), s.sucursal, s.ciudad, nombreProveedor(s), s.cuentas_proveedor?.numero, s.cuenta_contable, s.circuito, s.estatus,
      s.detalle, s.tipo, s.velocidad, s.moneda, Number(s.monto), enRD(s, usd), s.vence, s.comentarios, s.activo ? 'Activo' : `Baja: ${s.baja_motivo ?? ''}`,
    ])))
  }

  const celdaCuenta = (s: Servicio) => {
    const ok = cuentaValida(s)
    const texto = ok ? s.cuenta_contable : s.cuenta_contable ? `${s.cuenta_contable} · revisar` : 'Sin cuenta · revisar'
    return <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 7px', borderRadius: 4, background: ok ? 'var(--suave)' : RIESGO[0], color: ok ? 'var(--tinta)' : RIESGO[1] }}>{texto}</span>
  }
  const acciones = (s: Servicio) => (
    <td className="acciones">
      {puedeEscribir && s.activo && <button className="secundario" onClick={() => abrir(s)}>Editar</button>}
      {esAdmin && <button className="secundario" onClick={() => cambiarEstado(s)}>{s.activo ? 'Dar de baja' : 'Reactivar'}</button>}
    </td>
  )
  const celdasServicio = (s: Servicio) => (
    <>
      <td style={{ fontWeight: 600 }}>{nombreProveedor(s)}</td>
      <td className="mono">{s.cuentas_proveedor?.numero}</td>
      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{celdaCuenta(s)}</td>
      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{s.circuito}</td>
      <td><span style={pastilla(tono(s.estatus))}>{s.estatus}</span></td>
      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{s.detalle}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{s.tipo}</td>
      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{s.velocidad}</td>
      <td className="mono">{s.moneda}</td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>${dinero(Number(s.monto))}</td>
      <td style={{ color: 'var(--tenue)', minWidth: 220 }}>{s.comentarios}{!s.activo && ` · Baja: ${s.baja_motivo ?? ''}`}</td>
      {acciones(s)}
    </>
  )
  const encabezadoServicio = ['Proveedor', 'Cuenta proveedor', 'Cuenta contable', 'No. circuito', 'Estatus', 'Detalle', 'Tipo', 'Velocidad', 'Moneda', 'Monto', 'Comentarios', '']
  const columnasSucursal = '32px minmax(200px, 2fr) 110px minmax(140px, 1fr) 90px 130px 160px 110px'

  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo="Telecomunicaciones" titulo="Telecomunicaciones" empresas={empresas} co={co} elegir={elegir} ir={ir}
        subtitulo={`Internet, Telefonía, Metro Ethernet e Internet Móvil · Montos mensuales en moneda del contrato · Totales en RD$${usd ? ` a ${usd.toFixed(2)}` : ''} · Corte ${hoy}`}
        crear={puedeEscribir && !formulario ? { texto: 'Crear servicio', onClick: () => abrir(null) } : undefined} />
      <Mensajes msg={msg} error={error} />

      {formulario && (
        <Formulario key={formulario.fila?.id ?? 'nuevo'} m={MODULOS.telecom} empresa={formulario.fila?.empresa_id ?? co} fila={formulario.fila}
          titulo={formulario.fila ? `Editar servicio · ${formulario.fila.sucursal} · ${formulario.fila.detalle}` : `Nuevo servicio · ${emp?.nombre ?? ''}`}
          onGuardado={(texto) => { setMsg(texto); setFormulario(null); cargar() }} onCancelar={() => setFormulario(null)} />
      )}

      <Indicadores etiqueta="Indicadores de telecomunicaciones" kpis={kpis} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <section aria-labelledby="h-tipo" style={{ ...tarjeta, flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-tipo" style={h2}>Costo mensual por tipo de servicio</h2>
            <span style={tenue}>RD$ miles · cantidad de servicios · clic para filtrar</span>
          </div>
          {porTipo.map((g) => <Barra key={g.tipo} nombre={g.tipo} detalle={String(g.n)} valor={miles(g.costo)} ancho={(g.costo / maxTipo) * 100} onClick={() => filtrar({ tipo: g.tipo })} />)}
          {porTipo.length === 0 && <span style={tenue}>Sin servicios activos.</span>}
        </section>
        <section aria-labelledby="h-ges" style={{ ...tarjeta, flex: '1 1 340px', minWidth: 0, gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-ges" style={h2}>Servicios en gestión y calidad de datos</h2>
            <span style={tenue}>Clic en una tarjeta para filtrar el listado completo</span>
          </div>
          {porEstatus.map((s) => (
            <button key={s.nombre} onClick={s.elegir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 44, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--borde)', background: 'var(--suave)', color: 'var(--tinta)', fontSize: 14, textAlign: 'left' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ ...pastilla(s.color), padding: '3px 8px' }}>{s.n}</span>{s.nombre}</span>
              <span className="mono" style={{ fontSize: 13 }}>{entero(s.costo)} RD$ / mes</span>
            </button>
          ))}
          {porEstatus.length === 0 && <span style={tenue}>Todos los servicios están activos y con cuenta contable válida.</span>}
        </section>
      </div>

      <section aria-labelledby="h-suc" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2 id="h-suc" style={h2}>Dashboard por sucursal</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={tenue}>{sucursales.length} ubicaciones · total RD$ {entero(total)} / mes</span>
            <button style={botonBorde} onClick={() => setAbiertas(new Set(sucursales.map((x) => x.clave)))}>Expandir todo</button>
            <button style={botonBorde} onClick={() => setAbiertas(new Set())}>Contraer</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: columnasSucursal, gap: 8, padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--tenue)', borderBottom: '1px solid var(--borde)' }}>
              <span /><span>Sucursal</span><span>Empresa</span><span>Ubicación</span><span style={{ textAlign: 'right' }}>Servicios</span><span style={{ textAlign: 'right' }}>Costo mensual RD$</span><span>Peso en el costo</span><span>Respaldo</span>
            </div>
            {sucursales.map((x) => {
              const abierta = abiertas.has(x.clave)
              const nGestion = x.svcs.filter((s) => s.estatus !== 'Activo').length
              const nSinCuenta = x.svcs.filter((s) => !cuentaValida(s)).length
              const marcas = (nGestion ? `  · ${nGestion} en gestión` : '') + (nSinCuenta ? `  · ${nSinCuenta} sin cuenta contable` : '')
              return (
                <div key={x.clave} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--pista)' }}>
                  <button aria-expanded={abierta} onClick={() => { const n = new Set(abiertas); if (abierta) n.delete(x.clave); else n.add(x.clave); setAbiertas(n) }}
                    style={{ display: 'grid', gridTemplateColumns: columnasSucursal, gap: 8, alignItems: 'center', padding: 12, minHeight: 48, border: 'none', borderRadius: 0, background: abierta ? 'var(--suave)' : '#FFFFFF', color: 'var(--tinta)', fontSize: 14, fontWeight: 400, textAlign: 'left', width: '100%' }}>
                    <span className="mono" aria-hidden="true" style={{ color: 'var(--tenue)' }}>{abierta ? '▾' : '▸'}</span>
                    <span style={{ fontWeight: 600 }}>{x.nombre}<span style={{ fontWeight: 400, color: 'var(--riesgo)', fontSize: 12 }}>{marcas}</span></span>
                    <span style={tenue}>{nombreEmpresa(x.empresa_id)}</span>
                    <span style={tenue}>{x.ciudad}</span>
                    <span className="mono" style={{ textAlign: 'right' }}>{x.svcs.length}</span>
                    <span className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{dinero(x.costo)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, height: 8, background: 'var(--pista)', borderRadius: 4, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(x.costo / maxSucursal) * 100}%`, background: 'var(--primario2)' }} /></span>
                      <span className="mono" style={{ fontSize: 12, width: 44, textAlign: 'right' }}>{total ? `${((x.costo / total) * 100).toFixed(1)}%` : '—'}</span>
                    </span>
                    <span style={{ fontSize: 13, color: x.respaldo ? 'var(--tenue)' : 'var(--riesgo)' }}>{x.respaldo ? 'Sí' : 'Enlace único'}</span>
                  </button>
                  {abierta && (
                    <div style={{ padding: '4px 12px 16px 52px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--suave)' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ background: '#FFFFFF', border: '1px solid var(--pista)', minWidth: 1360 }}>
                          <thead><tr>{encabezadoServicio.map((h, i) => <th key={i} className={h === 'Monto' ? 'num' : undefined}>{h}</th>)}</tr></thead>
                          <tbody>{x.svcs.map((s) => <tr key={s.id}>{celdasServicio(s)}</tr>)}</tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button className="enlace" onClick={() => filtrar({ sucursal: x.nombre })} style={{ color: 'var(--enlace)', fontSize: 13, fontWeight: 600 }}>Ver esta sucursal en el listado completo →</button>
                        <button onClick={() => ir('gastos')} style={botonAcento}>Registrar gasto →</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {sucursales.length === 0 && <p style={{ ...tenue, padding: 16, textAlign: 'center', margin: 0 }}>Sin servicios activos.</p>}
          </div>
        </div>
      </section>

      <section aria-labelledby="h-all" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2 id="h-all" style={h2}>Todos los servicios de telecomunicaciones</h2>
          <span className="mono" style={tenue}>{listado.length} servicios · RD$ {entero(listado.filter((s) => s.activo).reduce((a, s) => a + rd(s), 0))} / mes</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={etiqueta}>Buscar<input type="search" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPagina(0) }} placeholder="Circuito, cuenta, detalle…" style={{ ...control, width: 220, padding: '0 12px' }} /></label>
          {([
            ['Sucursal', 'sucursal', unicos(servicios.map((s) => s.sucursal)), 'Todas', 180],
            ['Tipo', 'tipo', TIPOS, 'Todos', 150],
            ['Proveedor', 'proveedor', unicos(servicios.map(nombreProveedor)), 'Todos', 120],
            ['Moneda', 'moneda', ['RD$', 'US$'], 'Todas', 100],
            ['Estatus', 'estatus', unicos([...ESTATUS_TELECOM, ...servicios.map((s) => s.estatus)]), 'Todos', 160],
          ] as const).map(([label, k, opciones, todos, ancho]) => (
            <label key={k} style={etiqueta}>{label}
              <select value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setPagina(0) }} style={{ ...control, minWidth: ancho }}>
                <option value="">{todos}</option>{opciones.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          ))}
          <label style={etiqueta}>Cuenta contable
            <select value={f.cuenta} onChange={(e) => { setF({ ...f, cuenta: e.target.value }); setPagina(0) }} style={{ ...control, minWidth: 150 }}>
              <option value="">Todas</option>
              {unicos(servicios.filter(cuentaValida).map((s) => s.cuenta_contable)).map((o) => <option key={o}>{o}</option>)}
              <option value="__ninguna">Sin cuenta válida</option>
            </select>
          </label>
          <button style={botonBorde} onClick={() => filtrar({})}>Limpiar filtros</button>
          <label className="casilla" style={{ fontSize: 13 }}><input type="checkbox" checked={verBajas} onChange={(e) => { setVerBajas(e.target.checked); setPagina(0) }} /> Mostrar dados de baja</label>
          <button style={botonBorde} onClick={exportar} disabled={listado.length === 0}>Exportar CSV</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 1720 }}>
            <thead><tr><th>Sucursal</th><th>Ubicación</th>{encabezadoServicio.map((h, i) => <th key={i} className={h === 'Monto' ? 'num' : undefined}>{h}</th>)}</tr></thead>
            <tbody>
              {listado.slice(pag * POR_PAGINA, pag * POR_PAGINA + POR_PAGINA).map((s) => (
                <tr key={s.id} className={s.activo ? '' : 'inactivo'}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{s.sucursal} {todas && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--tenue)' }}>· {nombreEmpresa(s.empresa_id)}</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.ciudad}</td>
                  {celdasServicio(s)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {listado.length === 0 && <p style={{ ...tenue, margin: 0, padding: 16, textAlign: 'center', fontSize: 14 }}>Ningún servicio coincide con los filtros.</p>}
        <Paginador total={listado.length} pagina={pag} porPagina={POR_PAGINA} setPagina={setPagina} />
        <span style={{ fontSize: 12, color: 'var(--tenue)' }}>
          Cuenta del proveedor y cuenta contable son dimensiones distintas. Una cuenta contable que no está vigente en el catálogo de la empresa (por ejemplo «CANCELADO») se marca para revisión y no se imputa hasta corregirse.
        </span>
      </section>
    </div>
  )
}
