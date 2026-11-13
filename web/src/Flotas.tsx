import { Fragment, useEffect, useState } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal, dinero } from './supabase'
import { aCsv, descargar } from './csv'
import { Formulario, type Fila } from './Catalogo'
import { MODULOS } from './modulos'
import { Barra, Cabecera, Indicadores, Mensajes, Paginador, botonAcento, botonBorde, control, entero, etiqueta, h2, monto, Multi, pasa, paginaValida, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Flotas móviles, reconstruida a partir de design/Flotas.dc.html con datos reales.
// La base guarda un solo «estado»; de él salen el Status del proveedor y la Alerta SIGI del diseño.

export type Linea = Fila & {
  empresa_id: string; numero: string; sim: string | null; usuario: string | null; area_id: string; departamento_id: string
  datos: boolean; cantidad: string | null; costo_mensual: number; estado: string; fecha_alta: string; fecha_cambiazo: string | null
  areas: { nombre: string } | null; departamentos: { nombre: string } | null
  cuentas_proveedor: { numero: string; proveedores: { nombre: string } | null } | null
}

const ALERTAS = ['Sin alerta', 'Sin uso 90 días', 'Cambiazo elegible', 'Cancelada']
const TONO: Record<string, [string, string]> = {
  'Sin alerta': ['#EEF1F4', '#3E4A58'], 'Sin uso 90 días': ['#FBE9DF', '#8A3A12'], 'Cambiazo elegible': ['#E6EEF7', '#1D3557'], 'Cancelada': ['#EEEEEE', '#4D4D4D'],
}
const TONO_PROVEEDOR: Record<string, [string, string]> = { ACTIVE: ['#E7F5EF', '#075B3F'], SUSPENDED: ['#EEF1F4', '#3E4A58'], CANCELLED: ['#EEEEEE', '#4D4D4D'] }
const COLORES_PLAN = ['var(--primario)', 'var(--primario2)', 'var(--primario3)', 'var(--riesgo)']
const MESES_CAMBIAZO = 33
const POR_PAGINA = 20
const POR_DEPARTAMENTO = 12
const SIN_FILTRO: { q: string; area: string[]; dept: string[]; datos: string[]; proveedor: string[]; ps: string[]; alerta: string[] } =
  { q: '', area: [], dept: [], datos: [], proveedor: [], ps: [], alerta: [] }

// Meses completos entre dos fechas AAAA-MM-DD.
export function mesesEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
}

// Status reportado por el proveedor.
export const statusProveedor = (estado: string) => (estado === 'Suspendida' ? 'SUSPENDED' : estado === 'Cancelada' ? 'CANCELLED' : 'ACTIVE')

// Alerta SIGI: «Sin uso 90 días» la marca quien registra (no hay datos de consumo);
// «Cambiazo elegible» además se calcula: 33 meses o más desde el último cambiazo o la creación.
export function alerta(l: Pick<Linea, 'estado' | 'fecha_alta' | 'fecha_cambiazo'>, hoy: string): string {
  if (l.estado === 'Cancelada' || l.estado === 'Sin uso 90 días') return l.estado
  if (l.estado === 'Cambiazo elegible' || mesesEntre(l.fecha_cambiazo ?? l.fecha_alta, hoy) >= MESES_CAMBIAZO) return 'Cambiazo elegible'
  return 'Sin alerta'
}

export const plan = (l: Pick<Linea, 'datos' | 'cantidad'>) => (l.datos ? `Datos SI · ${l.cantidad?.trim() || 'sin cantidad'}` : 'Datos NO · solo voz')

export default function Flotas({ empresas, empresa, setEmpresa, puedeEscribir, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  puedeEscribir: boolean
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [lineas, setLineas] = useState<Linea[]>([])
  const [areasAbiertas, setAreasAbiertas] = useState<Set<string>>(new Set())
  const [deptosAbiertos, setDeptosAbiertos] = useState<Set<string>>(new Set())
  const [f, setF] = useState(SIN_FILTRO)
  const [verBajas, setVerBajas] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [formulario, setFormulario] = useState<{ fila: Linea | null } | null>(null) // null = cerrado
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const todas = co === 'all'
  const hoy = fechaLocal()
  useEffect(() => { if (empresa && co !== 'all') setCo(empresa) }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    const { data, error } = await leerTodo<Linea>((d, h) => {
      let q = supabase.from('lineas_flota').select('*, areas!lineas_flota_area_id_empresa_id_fkey(nombre), departamentos!lineas_flota_departamento_id_area_id_fkey(nombre), cuentas_proveedor!lineas_flota_cuenta_proveedor_id_fkey(numero, proveedores(nombre))')
      if (!todas) q = q.eq('empresa_id', co)
      return q.order('id').range(d, h)
    })
    if (error) { setError(await mensajeError(error)); return }
    setLineas(data)
  }
  useEffect(() => { cargar() }, [co]) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: string) => {
    setCo(id); setF(SIN_FILTRO); setPagina(0); setAreasAbiertas(new Set()); setDeptosAbiertos(new Set()); setFormulario(null); setMsg('')
    if (id !== 'all') setEmpresa(id)
  }
  const filtrar = (cambio: Partial<typeof SIN_FILTRO>) => { setF({ ...SIN_FILTRO, ...cambio }); setPagina(0) }
  const emp = empresas.find((e) => e.id === co)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const area = (l: Linea) => l.areas?.nombre ?? '(sin área)'
  const depto = (l: Linea) => l.departamentos?.nombre ?? '(sin departamento)'
  const proveedor = (l: Linea) => l.cuentas_proveedor?.proveedores?.nombre ?? ''
  const abrir = (fila: Linea | null) => { setMsg(''); setError(''); setFormulario({ fila }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const alternar = (conjunto: Set<string>, clave: string, set: (s: Set<string>) => void) => { const n = new Set(conjunto); if (n.has(clave)) n.delete(clave); else n.add(clave); set(n) }

  async function cambiarEstado(l: Linea) {
    setError('')
    let cambios: Record<string, unknown> = { activo: true }
    if (l.activo) {
      const motivo = window.prompt('Motivo de la baja del registro (para cancelar una línea use el estado «Cancelada»):')
      if (!motivo?.trim()) return
      cambios = { activo: false, baja_motivo: motivo.trim() }
    }
    const { error } = await supabase.from('lineas_flota').update(cambios).eq('id', l.id)
    if (error) setError(await mensajeError(error))
    else { setMsg(l.activo ? 'Registro dado de baja; se conserva en el historial.' : 'Registro reactivado.'); cargar() }
  }

  // Indicadores y tableros: líneas vigentes (registro activo y no canceladas).
  const vigentes = lineas.filter((l) => l.activo && l.estado !== 'Cancelada')
  const suma = (ls: Linea[]) => ls.reduce((a, l) => a + Number(l.costo_mensual), 0)
  const conAlerta = (ls: Linea[], a: string) => ls.filter((l) => alerta(l, hoy) === a)
  const total = suma(vigentes)
  const suspendidas = vigentes.filter((l) => l.estado === 'Suspendida').length
  const sinUso = conAlerta(vigentes, 'Sin uso 90 días')
  const kpis = [
    { label: 'Líneas en flota', value: String(vigentes.length), sub: `${vigentes.length - suspendidas} ACTIVE · ${suspendidas} SUSPENDED` },
    { label: 'Costo mensual (RD$)', value: monto(total), sub: `${entero(vigentes.length ? total / vigentes.length : 0)} promedio por línea`, color: 'var(--primario)' },
    { label: 'Sin uso 90 días', value: String(sinUso.length), sub: `Potencial ${entero(suma(sinUso) * 12)} anuales`, color: 'var(--riesgo)' },
    { label: 'Cambiazos elegibles', value: String(conAlerta(vigentes, 'Cambiazo elegible').length), sub: `${MESES_CAMBIAZO} meses o más desde el último cambiazo` },
  ]

  const agrupar = (ls: Linea[], clave: (l: Linea) => string) => {
    const m = new Map<string, Linea[]>()
    for (const l of ls) m.set(clave(l), [...(m.get(clave(l)) ?? []), l])
    return [...m.entries()]
  }
  const porArea = agrupar(vigentes, (l) => `${l.empresa_id}|${l.area_id}`).map(([clave, ls]) => ({ clave, ls, costo: suma(ls) })).sort((a, b) => b.costo - a.costo)
  const maxArea = Math.max(1, ...porArea.map((a) => a.costo))
  const planes = agrupar(vigentes, plan).map(([nombre, ls]) => ({ nombre, n: ls.length })).sort((a, b) => b.n - a.n)

  // Listado completo con filtros.
  const termino = f.q.trim().toLowerCase()
  const listado = lineas.filter((l) => (verBajas || l.activo) &&
    pasa(f.area, area(l)) && pasa(f.dept, depto(l)) && pasa(f.datos, l.datos ? 'SI' : 'NO') &&
    pasa(f.proveedor, proveedor(l)) && pasa(f.ps, statusProveedor(l.estado)) && pasa(f.alerta, alerta(l, hoy)) &&
    (!termino || [l.numero, l.usuario, l.sim, l.cuentas_proveedor?.numero, proveedor(l), area(l), depto(l)].join(' ').toLowerCase().includes(termino)))
    .sort((a, b) => area(a).localeCompare(area(b), 'es') || depto(a).localeCompare(depto(b), 'es') || a.numero.localeCompare(b.numero))
  const pag = paginaValida(pagina, listado.length, POR_PAGINA)
  const unicos = (v: string[]) => [...new Set(v.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

  function exportar() {
    const encabezado = ['Empresa', 'Cuenta proveedor', 'Proveedor', 'Número', 'Fecha creación', 'Tarjeta SIM', 'Status', 'Nombre', 'Área', 'Departamento', 'Datos', 'Cantidad', 'Precio', 'Fecha cambiazo', 'Alerta SIGI', 'Estado del registro']
    descargar(`flotas-${hoy}.csv`, aCsv(encabezado, listado.map((l) => [
      nombreEmpresa(l.empresa_id), l.cuentas_proveedor?.numero, proveedor(l), l.numero, l.fecha_alta, l.sim, statusProveedor(l.estado), l.usuario,
      area(l), depto(l), l.datos ? 'SI' : 'NO', l.cantidad, Number(l.costo_mensual), l.fecha_cambiazo, alerta(l, hoy), l.activo ? 'Activo' : `Baja: ${l.baja_motivo ?? ''}`,
    ])))
  }

  const encabezado = ['Cuenta proveedor', 'Número', 'Fecha creación', 'Tarjeta SIM', 'Status', 'Nombre', 'Área', 'Departamento', 'Datos', 'Cantidad', 'Precio', 'Fecha cambiazo', 'Alerta SIGI', '']
  const filaLinea = (l: Linea, conEmpresa = false) => {
    const ps = statusProveedor(l.estado)
    const al = alerta(l, hoy)
    return (
      <tr key={l.id} className={l.activo ? '' : 'inactivo'}>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{l.cuentas_proveedor?.numero} <span style={{ fontSize: 11, color: 'var(--tenue)' }}>{proveedor(l)}{conEmpresa && ` · ${nombreEmpresa(l.empresa_id)}`}</span></td>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{l.numero}</td>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{l.fecha_alta}</td>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{l.sim}</td>
        <td><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', padding: '3px 7px', borderRadius: 4, background: TONO_PROVEEDOR[ps][0], color: TONO_PROVEEDOR[ps][1] }}>{ps}</span></td>
        <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{l.usuario}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{area(l)}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{depto(l)}</td>
        <td className="mono">{l.datos ? 'SI' : 'NO'}</td>
        <td className="mono">{l.cantidad}</td>
        <td className="num" style={{ whiteSpace: 'nowrap' }}>${dinero(Number(l.costo_mensual))}</td>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{l.fecha_cambiazo}</td>
        <td><span style={pastilla(TONO[al])}>{al}</span>{!l.activo && <span className="nota"> Baja: {l.baja_motivo}</span>}</td>
        <td className="acciones">
          {puedeEscribir && l.activo && <button className="secundario" onClick={() => abrir(l)}>Editar</button>}
          {esAdmin && <button className="secundario" onClick={() => cambiarEstado(l)}>{l.activo ? 'Dar de baja' : 'Reactivar'}</button>}
        </td>
      </tr>
    )
  }
  const columnas = '32px minmax(200px, 2fr) 110px 70px 120px 110px 90px 90px 110px'
  const celdasResumen = (ls: Linea[]) => {
    const n = conAlerta(ls, 'Sin uso 90 días').length
    return (
      <>
        <span className="mono" style={{ textAlign: 'right' }}>{ls.length}</span>
        <span className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{entero(suma(ls))}</span>
        <span className="mono" style={{ textAlign: 'right' }}>{entero(suma(ls) / ls.length)}</span>
        <span className="mono" style={{ textAlign: 'right', color: n ? 'var(--riesgo)' : 'var(--tenue)' }}>{n}</span>
        <span className="mono" style={{ textAlign: 'right' }}>{conAlerta(ls, 'Cambiazo elegible').length}</span>
      </>
    )
  }

  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo="Flotas móviles" titulo="Gestión de flotas" empresas={empresas} co={co} elegir={elegir} ir={ir}
        subtitulo={`Líneas, SIM, asignaciones, planes de datos y cambiazos · Precios mensuales en RD$ · Corte ${hoy}`}
        crear={puedeEscribir && !formulario ? { texto: 'Nueva línea', onClick: () => abrir(null) } : undefined} />
      <Mensajes msg={msg} error={error} />

      {formulario && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Formulario key={formulario.fila?.id ?? 'nueva'} m={MODULOS.flotas} empresa={formulario.fila?.empresa_id ?? co} fila={formulario.fila}
            titulo={formulario.fila ? `Editar línea ${formulario.fila.numero}` : `Nueva línea · ${emp?.nombre ?? ''}`}
            onGuardado={(texto) => { setMsg(texto); setFormulario(null); cargar() }} onCancelar={() => setFormulario(null)} />
          <span style={{ fontSize: 12, color: 'var(--tenue)' }}>Para dar de baja una línea, cambie el estado a «Cancelada». No se borra: queda registrada en el listado.</span>
        </div>
      )}

      <Indicadores etiqueta="Indicadores de flota" kpis={kpis} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <section aria-labelledby="h-area" style={{ ...tarjeta, flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-area" style={h2}>Costo mensual por área</h2>
            <span style={tenue}>RD$ por mes · líneas asignadas</span>
          </div>
          {porArea.map((a) => <Barra key={a.clave} nombre={`${area(a.ls[0])}${todas ? ` · ${nombreEmpresa(a.ls[0].empresa_id)}` : ''}`} detalle={`${a.ls.length} líneas`} valor={monto(a.costo)} ancho={(a.costo / maxArea) * 100} />)}
          {porArea.length === 0 && <span style={tenue}>Sin líneas vigentes.</span>}
        </section>
        <section aria-labelledby="h-plan" style={{ ...tarjeta, flex: '1 1 380px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-plan" style={h2}>Líneas por plan de datos</h2>
            <span style={tenue}>Datos SI / NO y cantidad contratada</span>
          </div>
          {planes.length > 0 && (
            <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden' }}>
              {planes.map((p, i) => <div key={p.nombre} title={p.nombre} style={{ width: `${(p.n / vigentes.length) * 100}%`, background: COLORES_PLAN[i % COLORES_PLAN.length] }} />)}
            </div>
          )}
          {planes.map((p, i) => (
            <div key={p.nombre} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, background: COLORES_PLAN[i % COLORES_PLAN.length], borderRadius: 2 }} />{p.nombre}</span>
              <span className="mono">{p.n} líneas</span>
            </div>
          ))}
        </section>
      </div>

      <section aria-labelledby="h-dash" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-dash" style={h2}>Dashboard por área y departamento</h2>
            <span style={tenue}>Expanda un área para ver sus departamentos y un departamento para ver sus líneas</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={botonBorde} onClick={() => setAreasAbiertas(new Set(porArea.map((a) => a.clave)))}>Expandir áreas</button>
            <button style={botonBorde} onClick={() => { setAreasAbiertas(new Set()); setDeptosAbiertos(new Set()) }}>Contraer</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 920, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: columnas, gap: 8, padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--tenue)', borderBottom: '1px solid var(--borde)' }}>
              <span /><span>Área / departamento</span><span>Empresa</span><span style={{ textAlign: 'right' }}>Líneas</span><span style={{ textAlign: 'right' }}>Costo mensual</span>
              <span style={{ textAlign: 'right' }}>Prom. / línea</span><span style={{ textAlign: 'right' }}>Sin uso</span><span style={{ textAlign: 'right' }}>Cambiazo</span><span>Peso</span>
            </div>
            {porArea.map((a) => {
              const abierta = areasAbiertas.has(a.clave)
              const deptos = agrupar(a.ls, depto).sort(([x], [y]) => x.localeCompare(y, 'es'))
              return (
                <div key={a.clave} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--pista)' }}>
                  <button aria-expanded={abierta} onClick={() => alternar(areasAbiertas, a.clave, setAreasAbiertas)}
                    style={{ display: 'grid', gridTemplateColumns: columnas, gap: 8, alignItems: 'center', padding: 12, minHeight: 48, border: 'none', borderRadius: 0, background: abierta ? 'var(--suave)' : '#FFFFFF', color: 'var(--tinta)', fontSize: 14, fontWeight: 400, textAlign: 'left', width: '100%' }}>
                    <span className="mono" aria-hidden="true" style={{ color: 'var(--tenue)' }}>{abierta ? '▾' : '▸'}</span>
                    <span style={{ fontWeight: 700 }}>{area(a.ls[0])} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--tenue)' }}>· {deptos.length} departamentos</span></span>
                    <span style={tenue}>{nombreEmpresa(a.ls[0].empresa_id)}</span>
                    {celdasResumen(a.ls)}
                    <span style={{ display: 'block', height: 8, background: 'var(--pista)', borderRadius: 4, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(a.costo / maxArea) * 100}%`, background: 'var(--primario2)' }} /></span>
                  </button>
                  {abierta && (
                    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--suave)' }}>
                      {deptos.map(([nombre, dl]) => {
                        const clave = `${a.clave}|${nombre}`
                        const abierto = deptosAbiertos.has(clave)
                        return (
                          <Fragment key={clave}>
                            <div style={{ borderTop: '1px solid var(--pista)' }}>
                              <button aria-expanded={abierto} onClick={() => alternar(deptosAbiertos, clave, setDeptosAbiertos)}
                                style={{ display: 'grid', gridTemplateColumns: columnas, gap: 8, alignItems: 'center', padding: '10px 12px 10px 36px', minHeight: 44, border: 'none', borderRadius: 0, background: 'transparent', color: 'var(--tinta)', fontSize: 14, fontWeight: 400, textAlign: 'left', width: '100%' }}>
                                <span className="mono" aria-hidden="true" style={{ color: 'var(--tenue)' }}>{abierto ? '▾' : '▸'}</span>
                                <span>{nombre}</span>
                                <span />
                                {celdasResumen(dl)}
                                <span style={{ fontSize: 12, color: 'var(--tenue)' }}>{unicos(dl.map(plan)).map((p) => p.replace('Datos ', '')).join(' / ')}</span>
                              </button>
                            </div>
                            {abierto && (
                              <div style={{ padding: '4px 12px 14px 68px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ overflowX: 'auto' }}>
                                  <table style={{ background: '#FFFFFF', border: '1px solid var(--pista)', minWidth: 1420 }}>
                                    <thead><tr>{encabezado.map((h, i) => <th key={i} className={h === 'Precio' ? 'num' : undefined}>{h}</th>)}</tr></thead>
                                    <tbody>{dl.slice(0, POR_DEPARTAMENTO).map((l) => filaLinea(l))}</tbody>
                                  </table>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  <button className="enlace" onClick={() => filtrar({ area: [area(a.ls[0])], dept: [nombre] })} style={{ color: 'var(--enlace)', fontSize: 13, fontWeight: 600 }}>
                                    {dl.length > POR_DEPARTAMENTO ? `Ver las ${dl.length} líneas en el listado completo →` : 'Ver en el listado completo →'}
                                  </button>
                                  <button onClick={() => ir('gastos')} style={botonAcento}>Registrar gasto →</button>
                                </div>
                              </div>
                            )}
                          </Fragment>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {porArea.length === 0 && <p style={{ ...tenue, padding: 16, textAlign: 'center', margin: 0 }}>Sin líneas vigentes.</p>}
          </div>
        </div>
      </section>

      <section aria-labelledby="h-all" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2 id="h-all" style={h2}>Todas las líneas de flota</h2>
          <span className="mono" style={tenue}>{listado.length} líneas · RD$ {entero(suma(listado.filter((l) => l.activo && l.estado !== 'Cancelada')))} / mes sin canceladas</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={etiqueta}>Buscar<input type="search" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPagina(0) }} placeholder="Número, nombre, SIM, cuenta…" style={{ ...control, width: 220, padding: '0 12px' }} /></label>
          {([
            ['Área', 'area', unicos(lineas.map(area)), 'Todas', 150],
            ['Departamento', 'dept', unicos(lineas.filter((l) => pasa(f.area, area(l))).map(depto)), 'Todos', 180],
            ['Datos', 'datos', ['SI', 'NO'], 'Todos', 100],
            ['Proveedor', 'proveedor', unicos(lineas.map(proveedor)), 'Todos', 120],
            ['Status', 'ps', ['ACTIVE', 'SUSPENDED', 'CANCELLED'], 'Todos', 130],
            ['Alerta SIGI', 'alerta', ALERTAS, 'Todas', 170],
          ] as const).map(([label, k, opciones, todos, ancho]) => (
            <Multi key={k} label={label} opciones={opciones} valor={f[k]} todos={todos} ancho={ancho}
              cambiar={(v) => { setF({ ...f, [k]: v, ...(k === 'area' ? { dept: [] } : {}) }); setPagina(0) }} />
          ))}
          <button style={botonBorde} onClick={() => filtrar({})}>Limpiar filtros</button>
          <label className="casilla" style={{ fontSize: 13 }}><input type="checkbox" checked={verBajas} onChange={(e) => { setVerBajas(e.target.checked); setPagina(0) }} /> Mostrar dados de baja</label>
          <button style={botonBorde} onClick={exportar} disabled={listado.length === 0}>Exportar CSV</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 1560 }}>
            <thead><tr>{encabezado.map((h, i) => <th key={i} className={h === 'Precio' ? 'num' : undefined}>{h}</th>)}</tr></thead>
            <tbody>{listado.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA).map((l) => filaLinea(l, todas))}</tbody>
          </table>
        </div>
        {listado.length === 0 && <p style={{ ...tenue, margin: 0, padding: 16, textAlign: 'center', fontSize: 14 }}>Ninguna línea coincide con los filtros.</p>}
        <Paginador total={listado.length} pagina={pag} porPagina={POR_PAGINA} setPagina={setPagina} />
        <span style={{ fontSize: 12, color: 'var(--tenue)' }}>
          Status es el estado reportado por el proveedor; Alerta SIGI se calcula: «Sin uso 90 días» se registra en el estado de la línea y «Cambiazo elegible» se marca a los {MESES_CAMBIAZO} meses del último cambiazo o de la creación.
        </span>
      </section>
    </div>
  )
}
