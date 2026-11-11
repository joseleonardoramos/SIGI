import { Fragment, useEffect, useState, type CSSProperties } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal, dinero } from './supabase'
import { aCsv, descargar } from './csv'
import { Formulario, type Fila } from './Catalogo'
import { MODULOS } from './modulos'
import { etiquetaMes, mesesDelEjercicio, programar, transcurrido } from './panelDatos'
import { fechaCorta } from './comun'
import { ahorroDe, type Iniciativa } from './ahorro'
import { Cabecera, DadosDeBaja, Mensajes, botonAcento, botonBorde, control, entero, etiqueta, h2, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Presupuesto y control de ejecución, reconstruida a partir de design/Presupuestos.dc.html con datos reales.
// Por empresa: cada empresa tiene sus versiones. Los saldos salen de la vista saldo_partidas.
// Ahorro neto y proyección de cierre con la regla única de ahorro.ts: se miden por empresa y ejercicio, no por partida
// (las iniciativas no están ligadas a una partida); por partida y categoría se muestra el exceso. No hay reservas: Reservado = 0.

type Version = { id: string; ejercicio: string; numero: number; estado: string; escenario: string }
type Partida = Fila & { version_id: string; codigo: string; nombre: string; categoria: string; cuenta_contable: string | null; centro_costo_codigo: string | null; distribucion: string; monto: number }
type Saldo = { partida_id: string; version_id: string; categoria: string; presupuesto: number; comprometido: number; ejecutado: number; disponible: number }
type Movimiento = { id: string; tipo: string; fecha: string; monto: number; documento: string | null; ncf: string | null; referencia_bancaria: string | null; reversado: boolean; creado_en: string; gastos: { codigo: string; partida_id: string | null; tasa: number } | null }

const ESTADO: Record<string, [string, string]> = { Vigente: ['#E7F5EF', '#075B3F'], Borrador: ['#FFF4D6', '#6B4A00'], Cerrado: ['#EEF1F4', '#3E4A58'] }
const TIPO_MOV: Record<string, [string, string]> = { Compromiso: ['#E6EEF7', '#1D3557'], Factura: ['#FFF4D6', '#6B4A00'], Pago: ['#E7F5EF', '#075B3F'], Reverso: ['#FBE9DF', '#8A3A12'] }
const der: CSSProperties = { textAlign: 'right' }
const millones = (v: number) => (v / 1e6).toFixed(2)
const pct = (v: number, base: number) => (base ? `${((v / base) * 100).toFixed(1)} %` : '—')

// Saldo de una partida: el comprometido pendiente es lo comprometido aún sin facturar; el exceso, lo que supera el presupuesto.
export function cifras(s: Pick<Saldo, 'presupuesto' | 'comprometido' | 'ejecutado' | 'disponible'>) {
  const presupuesto = Number(s.presupuesto), ejecutado = Number(s.ejecutado), disponible = Number(s.disponible)
  return { presupuesto, ejecutado, disponible, pendiente: Math.max(Number(s.comprometido) - ejecutado, 0), exceso: Math.max(-disponible, 0) }
}
type Cifras = ReturnType<typeof cifras>
export const sumar = (lista: Cifras[]) => lista.reduce((a, c) => ({
  presupuesto: a.presupuesto + c.presupuesto, ejecutado: a.ejecutado + c.ejecutado, disponible: a.disponible + c.disponible,
  pendiente: a.pendiente + c.pendiente, exceso: a.exceso + c.exceso,
}), { presupuesto: 0, ejecutado: 0, disponible: 0, pendiente: 0, exceso: 0 })

export default function Presupuestos({ empresas, empresa, setEmpresa, puedeEscribir, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  puedeEscribir: boolean
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [versiones, setVersiones] = useState<Version[]>([])
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [bajas, setBajas] = useState<Partida[]>([]) // partidas dadas de baja (se conservan)
  const [saldos, setSaldos] = useState<Record<string, Saldo>>({})
  const [tipos, setTipos] = useState<Record<string, string>>({}) // cuenta contable → OPEX/CAPEX
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [iniciativas, setIniciativas] = useState<Iniciativa[]>([])
  const [inicioMes, setInicioMes] = useState(1)
  const [version, setVersion] = useState('')
  const [comparar, setComparar] = useState('')
  const [tipoF, setTipoF] = useState('')
  const [elegida, setElegida] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<{ fila: Partida | null } | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const hoy = fechaLocal()

  async function cargar() {
    if (!empresa) return
    const de = <T,>(tabla: string, columnas: string, orden = 'id') => leerTodo<T>((d, h) => supabase.from(tabla).select(columnas).eq('empresa_id', empresa).order(orden).range(d, h))
    const [e, v, p, s, c, m, i] = await Promise.all([
      supabase.from('empresas').select('inicio_ejercicio_mes').eq('id', empresa).maybeSingle(),
      supabase.from('presupuestos_versiones').select('id, ejercicio, numero, estado, escenario').eq('empresa_id', empresa).eq('activo', true)
        .order('ejercicio', { ascending: false }).order('numero', { ascending: false }),
      leerTodo<Partida>((d, h) => supabase.from('partidas').select('*').eq('empresa_id', empresa).order('codigo').order('id').range(d, h)),
      de<Saldo>('saldo_partidas', 'partida_id, version_id, categoria, presupuesto, comprometido, ejecutado, disponible', 'partida_id'),
      de<{ codigo: string; tipo: string }>('cuentas_contables', 'codigo, tipo'),
      supabase.from('gasto_pasos').select('id, tipo, fecha, monto, documento, ncf, referencia_bancaria, reversado, creado_en, gastos!gasto_pasos_gasto_id_fkey(codigo, partida_id, tasa)')
        .eq('empresa_id', empresa).eq('activo', true).in('tipo', ['Compromiso', 'Factura', 'Pago', 'Reverso']).order('creado_en', { ascending: false }).limit(300),
      de<Iniciativa>('iniciativas_ahorro', 'empresa_id, modulo, palanca, linea_base, costo_nuevo, fecha_efectiva, estado, activo'),
    ])
    const fallo = e.error ?? v.error ?? p.error ?? s.error ?? c.error ?? m.error ?? i.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    const lista = (v.data ?? []) as Version[]
    setInicioMes(e.data?.inicio_ejercicio_mes ?? 1)
    setVersiones(lista)
    setPartidas(p.data.filter((x) => x.activo))
    setBajas(p.data.filter((x) => !x.activo))
    setSaldos(Object.fromEntries(s.data.map((x) => [x.partida_id, x])))
    setTipos(Object.fromEntries(c.data.map((x) => [x.codigo, x.tipo])))
    setMovimientos((m.data ?? []) as unknown as Movimiento[])
    setIniciativas(i.data)
    // Por defecto: la vigente (o la más reciente), comparada con la anterior.
    setVersion((actual) => (lista.some((x) => x.id === actual) ? actual : (lista.find((x) => x.estado === 'Vigente') ?? lista[0])?.id ?? ''))
  }
  useEffect(() => { setComparar(''); setElegida(null); setFormulario(null); cargar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  const emp = empresas.find((e) => e.id === empresa)
  const moneda = emp?.moneda_reporte ?? 'RD$'
  const ver = versiones.find((x) => x.id === version)
  const vcmp = versiones.find((x) => x.id === comparar)
  const etiquetaVersion = (x?: Version) => (x ? `${x.ejercicio} · v${x.numero}` : '')
  const cifrasDe = (p: Partida) => cifras(saldos[p.id] ?? { presupuesto: p.monto, comprometido: 0, ejecutado: 0, disponible: p.monto })
  const tipoDe = (p: Partida) => (p.cuenta_contable && tipos[p.cuenta_contable]) || 'OPEX'
  const deVersion = (id: string) => partidas.filter((p) => p.version_id === id)
  const meses = ver ? mesesDelEjercicio(ver.ejercicio, inicioMes) : []
  const periodo = (x: Version) => { const ms = mesesDelEjercicio(x.ejercicio, inicioMes); return `${etiquetaMes(ms[0])} ${ms[0].anio} – ${etiquetaMes(ms[11])} ${ms[11].anio}` }

  // Ahorro neto de una versión: iniciativas de la empresa prorrateadas a su ejercicio, menos sus excesos.
  const ahorroVersion = (x: Version) => {
    const a = ahorroDe(iniciativas, () => mesesDelEjercicio(x.ejercicio, inicioMes))
    const t = sumar(deVersion(x.id).map(cifrasDe))
    return { ...a, neto: a.R + a.G - t.exceso, proyeccion: t.presupuesto - (a.R + a.G - t.exceso) }
  }
  const actuales = deVersion(version)
  const total = sumar(actuales.map(cifrasDe))
  const ahorroSel = ver ? ahorroVersion(ver) : { R: 0, G: 0, neto: 0, proyeccion: 0 }
  const visibles = actuales.filter((p) => !tipoF || tipoDe(p) === tipoF)
  const excedidas = actuales.filter((p) => cifrasDe(p).exceso > 0)
  const sel = actuales.find((p) => p.id === elegida) ?? actuales[0]

  // Comparación por categoría entre la versión elegida y otra.
  const porCategoria = (id: string) => {
    const r: Record<string, Cifras> = {}
    for (const p of deVersion(id)) r[p.categoria] = sumar([r[p.categoria] ?? sumar([]), cifrasDe(p)])
    return r
  }
  const ca = porCategoria(version), cb = comparar ? porCategoria(comparar) : {}
  const categorias = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].sort((a, b) => a.localeCompare(b, 'es'))
  const tiposCategoria = (c: string) => [...new Set(partidas.filter((p) => p.categoria === c).map(tipoDe))].join(' / ')

  const movsVersion = movimientos.filter((m) => m.gastos?.partida_id && actuales.some((p) => p.id === m.gastos!.partida_id)).slice(0, 12)
  const partidaDe = (id: string | null | undefined) => partidas.find((p) => p.id === id)

  function exportar() {
    const enc = ['Código', 'Partida', 'Categoría', 'Cuenta contable', 'Tipo', 'Distribución', `Presupuesto ${moneda}`, 'Reservado', 'Comprometido pendiente', 'Ejecutado', 'Disponible', 'Exceso']
    descargar(`presupuesto-${ver?.ejercicio ?? ''}-v${ver?.numero ?? ''}${tipoF ? `-${tipoF}` : ''}-${hoy}.csv`, aCsv(enc, visibles.map((p) => {
      const c = cifrasDe(p)
      return [p.codigo, p.nombre, p.categoria, p.cuenta_contable, tipoDe(p), p.distribucion, c.presupuesto, 0, c.pendiente, c.ejecutado, c.disponible, c.exceso]
    })))
  }

  const moduloPartida = { ...MODULOS.partidas, campos: MODULOS.partidas.campos.map((c) => (c.k === 'version_id' ? { ...c, defecto: version } : c)) }
  const abrir = (fila: Partida | null) => { setMsg(''); setError(''); setFormulario({ fila }) }
  async function reactivar(p: Partida) {
    const { error } = await supabase.from('partidas').update({ activo: true }).eq('id', p.id)
    if (error) setError(await mensajeError(error)); else { setMsg(`Partida ${p.codigo} reactivada.`); cargar() }
  }
  async function darDeBaja(p: Partida) {
    const motivo = window.prompt(`Motivo de la baja de la partida ${p.codigo} (se conserva en el historial):`)
    if (!motivo?.trim()) return
    const { error } = await supabase.from('partidas').update({ activo: false, baja_motivo: motivo.trim() }).eq('id', p.id)
    if (error) setError(await mensajeError(error)); else { setMsg('Partida dada de baja; se conserva en el historial.'); cargar() }
  }

  // Calculadora de la partida elegida: programado a la fecha según su distribución contra lo ejecutado.
  const calc = sel && (() => {
    const c = cifrasDe(sel)
    const programa = programar(c.presupuesto, sel.distribucion, meses)
    const avance = meses.length ? transcurrido(meses, hoy) : 0
    const mesesCompletos = Math.floor(avance * 12)
    const programado = programa.slice(0, mesesCompletos).reduce((a, v) => a + v, 0)
    return [
      ['Presupuesto', dinero(c.presupuesto)], ['Comprometido pendiente', dinero(c.pendiente)], ['Ejecutado', dinero(c.ejecutado)],
      ['Disponible', dinero(c.disponible)], ['Consumido', pct(c.presupuesto - c.disponible, c.presupuesto)],
      [`Programado a la fecha (${mesesCompletos} de 12 meses)`, dinero(programado)], ['Desvío ejecutado vs. programado', dinero(c.ejecutado - programado)],
    ]
  })()

  const tabla: CSSProperties = { minWidth: 1100 }
  return (
    <div data-tema={emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo="Presupuestos" titulo="Presupuesto y control de ejecución" empresas={empresas} co={empresa} elegir={setEmpresa} ir={ir} consolidado={false}
        subtitulo={ver ? <>Presupuesto {ver.ejercicio} · {periodo(ver)} · Versión {ver.numero} · <b>{ver.estado}</b> · {moneda}</> : 'Sin versiones de presupuesto: créelas en Presupuesto → Versiones.'}
        crear={puedeEscribir ? { texto: '+ Registrar gasto', onClick: () => ir('gastos') } : undefined} />
      <Mensajes msg={msg} error={error} />

      <section aria-label="Selección de ejercicio" style={{ ...tarjeta, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, padding: '14px 16px' }}>
        <label style={etiqueta}>Año fiscal y versión
          <select value={version} onChange={(e) => { setVersion(e.target.value); setElegida(null); setFormulario(null) }} style={{ ...control, minWidth: 220 }}>
            {versiones.map((x) => <option key={x.id} value={x.id}>{etiquetaVersion(x)} · {x.estado}</option>)}
          </select>
        </label>
        <label style={etiqueta}>Comparar con
          <select value={comparar} onChange={(e) => setComparar(e.target.value)} style={{ ...control, minWidth: 220 }}>
            <option value="">Sin comparación</option>{versiones.filter((x) => x.id !== version).map((x) => <option key={x.id} value={x.id}>{etiquetaVersion(x)} · {x.estado}</option>)}
          </select>
        </label>
        {meses.length > 0 && <span style={tenue}>Calendario fiscal {emp?.nombre}: {etiquetaMes(meses[0])} – {etiquetaMes(meses[11])}</span>}
      </section>

      <section aria-labelledby="h-port" style={tarjeta}>
        <h2 id="h-port" style={h2}>Portafolio presupuestario · {emp?.nombre}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Presupuesto</th><th>Período</th><th>Versión</th><th>Estado</th><th style={der}>Presupuesto</th><th style={der}>Ejecutado</th><th style={der}>% ejec.</th><th style={der}>Ahorro neto</th><th style={der}>Proyección</th><th></th></tr></thead>
            <tbody>
              {versiones.map((x) => {
                const t = sumar(deVersion(x.id).map(cifrasDe))
                return (
                  <tr key={x.id} style={{ background: x.id === version ? 'var(--suave)' : undefined }}>
                    <td>{x.ejercicio} · {x.escenario}</td><td className="mono">{periodo(x)}</td><td className="mono">v{x.numero}</td>
                    <td><span style={pastilla(ESTADO[x.estado] ?? ESTADO.Cerrado)}>{x.estado}</span></td>
                    <td className="num">{dinero(t.presupuesto)}</td><td className="num">{dinero(t.ejecutado)}</td><td className="num">{pct(t.ejecutado, t.presupuesto)}</td>
                    <td className="num" style={{ color: 'var(--ahorro-tinta)' }}>{dinero(ahorroVersion(x).neto)}</td>
                    <td className="num">{dinero(ahorroVersion(x).proyeccion)}</td>
                    <td className="acciones">{x.id !== version && <button className="secundario" onClick={() => { setVersion(x.id); setElegida(null) }}>Ver</button>}</td>
                  </tr>
                )
              })}
              {versiones.length === 0 && <tr><td colSpan={10} style={tenue}>Sin versiones. <button className="enlace" onClick={() => ir('versiones')}>Crear una versión →</button></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {ver && <>
        <section aria-label="Saldo del ejercicio" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {([['', 'Presupuesto', total.presupuesto], ['−', 'Reservado', 0], ['−', 'Comprometido pendiente', total.pendiente], ['−', 'Ejecutado', total.ejecutado], ['=', 'Disponible', total.disponible]] as const).map(([op, label, v]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 150px' }}>
              {op && <span className="mono" aria-hidden="true" style={{ fontSize: 22, color: 'var(--tenue)' }}>{op}</span>}
              <div style={{ background: '#FFFFFF', border: '1px solid var(--borde)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 12, color: 'var(--tenue)', fontWeight: 600 }}>{label}</span>
                <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: label === 'Disponible' && v < 0 ? 'var(--riesgo)' : label === 'Disponible' ? 'var(--ahorro-tinta)' : 'var(--tinta)' }}>{millones(v)} M</span>
              </div>
            </div>
          ))}
          <div style={{ background: 'var(--ahorro-fondo)', border: '1px solid var(--ahorro-suave)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
            <span style={{ fontSize: 12, color: 'var(--ahorro-tinta)', fontWeight: 700 }}>Proyección de cierre</span>
            <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ahorro-tinta)' }}>{millones(ahorroSel.proyeccion)} M</span>
            <span style={{ fontSize: 11, color: 'var(--ahorro-tinta)' }}>Vigente − ahorro neto {millones(ahorroSel.neto)} (realizado {millones(ahorroSel.R)} + en gestión {millones(ahorroSel.G)} − excesos {millones(total.exceso)}) · <button className="enlace" onClick={() => ir('ahorros')} style={{ fontSize: 11 }}>Ahorros →</button></span>
          </div>
        </section>

        {vcmp && (
          <section aria-labelledby="h-cmp" style={tarjeta}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="h-cmp" style={h2}>Comparación {etiquetaVersion(ver)} vs. {etiquetaVersion(vcmp)}</h2>
              <span style={tenue}>Por categoría, en {moneda} millones. La variación es la versión elegida menos la comparada. <button className="enlace" onClick={() => ir('comparar')} style={{ fontSize: 13 }}>Exportar la comparación →</button></span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 900 }}>
                <thead>
                  <tr><th></th><th colSpan={3} style={{ textAlign: 'center' }}>{etiquetaVersion(ver)}</th><th colSpan={3} style={{ textAlign: 'center' }}>{etiquetaVersion(vcmp)}</th><th colSpan={2} style={{ textAlign: 'center' }}>Variación</th></tr>
                  <tr><th>Categoría</th><th style={der}>Presupuesto</th><th style={der}>Ejecutado</th><th style={der}>Exceso</th><th style={der}>Presupuesto</th><th style={der}>Ejecutado</th><th style={der}>Exceso</th><th style={der}>Δ presupuesto</th><th style={der}>Δ ejecutado</th></tr>
                </thead>
                <tbody>
                  {categorias.map((c) => {
                    const a = ca[c] ?? sumar([]), b = cb[c] ?? sumar([])
                    const dB = a.presupuesto - b.presupuesto, dE = a.ejecutado - b.ejecutado
                    return (
                      <tr key={c}>
                        <td>{c} <span style={{ fontSize: 11, color: 'var(--tenue)' }}>{tiposCategoria(c)}</span></td>
                        <td className="num">{millones(a.presupuesto)}</td><td className="num">{millones(a.ejecutado)}</td><td className="num">{millones(a.exceso)}</td>
                        <td className="num">{millones(b.presupuesto)}</td><td className="num">{millones(b.ejecutado)}</td><td className="num">{millones(b.exceso)}</td>
                        <td className="num" style={{ color: dB > 0 ? 'var(--riesgo)' : dB < 0 ? 'var(--ahorro-tinta)' : undefined }}>{dB > 0 ? '+' : ''}{millones(dB)}</td>
                        <td className="num">{dE > 0 ? '+' : ''}{millones(dE)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section aria-labelledby="h-exp" style={tarjeta}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="h-exp" style={h2}>Gastos hasta la ejecución · {etiquetaVersion(ver)}</h2>
              <span style={tenue}>Por partida: presupuesto → reservado → comprometido → ejecutado → disponible, con su exceso · {moneda}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div role="group" aria-label="Tipo de gasto" style={{ display: 'flex', border: '1px solid var(--borde)', borderRadius: 8, overflow: 'hidden' }}>
                {[['', 'Todos'], ['OPEX', 'OPEX'], ['CAPEX', 'CAPEX']].map(([k, label]) => (
                  <button key={label} aria-pressed={tipoF === k} onClick={() => setTipoF(k)}
                    style={{ height: 40, padding: '0 14px', border: 'none', borderRadius: 0, fontSize: 13, fontWeight: 600, background: tipoF === k ? 'var(--boton-activo)' : '#FFFFFF', color: tipoF === k ? '#FFFFFF' : 'var(--tinta)' }}>{label}</button>
                ))}
              </div>
              {puedeEscribir && !formulario && ver.estado !== 'Cerrado' && <button style={botonAcento} onClick={() => abrir(null)}>+ Nueva partida</button>}
              <button style={botonBorde} onClick={exportar} disabled={visibles.length === 0}>Exportar {tipoF || 'todo'} (CSV)</button>
            </div>
          </div>
          {formulario && (
            <Formulario key={formulario.fila?.id ?? 'nueva'} m={moduloPartida} empresa={empresa} fila={formulario.fila}
              titulo={formulario.fila ? `Editar partida ${formulario.fila.codigo}` : `Nueva partida · ${etiquetaVersion(ver)}`}
              onGuardado={(t) => { setMsg(t); setFormulario(null); cargar() }} onCancelar={() => setFormulario(null)} />
          )}
          {excedidas.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 8, background: '#FBE9DF', color: '#8A3A12', fontSize: 13 }}>
              <b>{excedidas.length} partida(s) superan su presupuesto: quedan registradas como fuera de presupuesto.</b>
              {excedidas.map((p) => <span key={p.id}>{p.codigo} · {p.nombre} · exceso {moneda} {dinero(cifrasDe(p).exceso)}</span>)}
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={tabla}>
              <thead><tr><th>Partida</th><th>Cuenta</th><th>Tipo</th><th style={der}>Presupuesto</th><th style={der}>Reservado</th><th style={der}>Comprometido</th><th style={der}>Ejecutado</th><th style={der}>Disponible</th><th style={der}>Exceso</th><th>Consumo</th><th></th></tr></thead>
              <tbody>
                {visibles.map((p) => {
                  const c = cifrasDe(p)
                  const consumo = c.presupuesto ? Math.min((c.presupuesto - c.disponible) / c.presupuesto, 1.5) : 0
                  return (
                    <tr key={p.id} onClick={() => setElegida(p.id)} style={{ cursor: 'pointer', background: sel?.id === p.id ? 'var(--suave)' : undefined }}>
                      <td><span style={{ display: 'flex', flexDirection: 'column' }}><span className="mono" style={{ fontSize: 12, color: 'var(--tenue)' }}>{p.codigo}</span><span style={{ fontWeight: 600 }}>{p.nombre}</span></span></td>
                      <td className="mono">{p.cuenta_contable ?? '—'}</td>
                      <td><span style={{ ...pastilla(tipoDe(p) === 'CAPEX' ? ['var(--primario2)', '#FFFFFF'] : ['var(--primario)', '#FFFFFF']), padding: '2px 7px', fontSize: 11 }}>{tipoDe(p)}</span></td>
                      <td className="num">{dinero(c.presupuesto)}</td><td className="num">0.00</td><td className="num">{dinero(c.pendiente)}</td><td className="num">{dinero(c.ejecutado)}</td>
                      <td className="num" style={{ color: c.disponible < 0 ? 'var(--riesgo)' : undefined }}>{dinero(c.disponible)}</td>
                      <td className="num" style={{ color: c.exceso ? 'var(--riesgo)' : 'var(--tenue)' }}>{c.exceso ? `(${dinero(c.exceso)})` : '—'}</td>
                      <td style={{ minWidth: 110 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ flex: 1, height: 8, background: 'var(--pista)', borderRadius: 4, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.min(consumo, 1) * 100}%`, background: consumo > 1 ? 'var(--riesgo)' : 'var(--primario2)' }} /></span>
                          <span className="mono" style={{ fontSize: 11 }}>{(consumo * 100).toFixed(0)}%</span>
                        </span>
                      </td>
                      <td className="acciones" onClick={(e) => e.stopPropagation()}>
                        {puedeEscribir && ver.estado !== 'Cerrado' && <button className="secundario" onClick={() => abrir(p)}>Editar</button>}
                        {esAdmin && <button className="secundario" onClick={() => darDeBaja(p)}>Dar de baja</button>}
                      </td>
                    </tr>
                  )
                })}
                {visibles.length === 0 && <tr><td colSpan={11} style={tenue}>Esta versión no tiene partidas{tipoF ? ` ${tipoF}` : ''}.</td></tr>}
              </tbody>
            </table>
          </div>
          {esAdmin && <DadosDeBaja filas={bajas.filter((p) => p.version_id === version)} nombre={(p) => `${p.codigo} · ${p.nombre}`} reactivar={reactivar} />}
          <span style={{ fontSize: 12, color: 'var(--tenue)' }}>Exceso = lo que la partida supera su presupuesto. El ahorro se mide con las iniciativas de la empresa (Ahorros) y la proyección de cierre está arriba, en el saldo del ejercicio. Haga clic en una partida para verla en la calculadora.</span>
        </section>

        <section aria-labelledby="h-mat" style={tarjeta}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-mat" style={h2}>Programación mensual · {etiquetaVersion(ver)}</h2>
            <span style={tenue}>{moneda} miles · según la distribución de cada partida · «—» = sin programación (distinto de 0)</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 1200 }}>
              <thead><tr><th>Partida</th><th>Distribución</th>{meses.map((m) => <th key={`${m.anio}-${m.mes}`} style={der}>{etiquetaMes(m)}</th>)}<th style={der}>Anual</th></tr></thead>
              <tbody>
                {actuales.map((p) => {
                  const prog = programar(Number(p.monto), p.distribucion, meses)
                  return (
                    <tr key={p.id}>
                      <td><span className="mono" style={{ fontSize: 12, color: 'var(--tenue)' }}>{p.codigo}</span> {p.nombre}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{p.distribucion}</td>
                      {prog.map((v, i) => <td key={i} className="num" style={{ color: v ? undefined : 'var(--tenue)' }}>{v ? entero(v / 1000) : '—'}</td>)}
                      <td className="num" style={{ fontWeight: 600 }}>{entero(Number(p.monto) / 1000)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <section aria-labelledby="h-mov" style={{ ...tarjeta, flex: '2 1 560px', minWidth: 0 }}>
            <h2 id="h-mov" style={h2}>Movimientos presupuestarios recientes · {etiquetaVersion(ver)}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Partida</th><th>Gasto · documento</th><th style={der}>Importe {moneda}</th></tr></thead>
                <tbody>
                  {movsVersion.map((m) => (
                    <tr key={m.id} style={{ opacity: m.reversado ? 0.55 : 1 }}>
                      <td className="mono">{fechaCorta(m.fecha)}</td>
                      <td><span style={pastilla(TIPO_MOV[m.tipo] ?? TIPO_MOV.Compromiso)}>{m.tipo}{m.reversado ? ' · reversado' : ''}</span></td>
                      <td className="mono">{partidaDe(m.gastos?.partida_id)?.codigo}</td>
                      <td>{m.gastos?.codigo}{(m.documento || m.ncf || m.referencia_bancaria) && ` · ${m.documento ?? m.ncf ?? m.referencia_bancaria}`}</td>
                      <td className="num">{dinero(Number(m.monto) * Number(m.gastos?.tasa ?? 1))}</td>
                    </tr>
                  ))}
                  {movsVersion.length === 0 && <tr><td colSpan={5} style={tenue}>Sin movimientos en esta versión.</td></tr>}
                </tbody>
              </table>
            </div>
            <button className="enlace" onClick={() => ir('gastos')} style={{ alignSelf: 'flex-start', fontSize: 13, color: 'var(--enlace)', fontWeight: 600 }}>Ver gastos →</button>
          </section>
          <section aria-labelledby="h-calc" style={{ ...tarjeta, flex: '1 1 320px' }}>
            <h2 id="h-calc" style={h2}>Calculadora de partida{sel ? ` · ${sel.codigo}` : ''}</h2>
            {sel && calc ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 14px', fontSize: 13 }}>
                <span style={{ gridColumn: '1 / -1', fontWeight: 600 }}>{sel.nombre} · {sel.distribucion}</span>
                {calc.map(([l, v]) => <Fragment key={l}><span style={{ color: 'var(--tenue)' }}>{l}</span><span className="mono" style={der}>{v}</span></Fragment>)}
              </div>
            ) : <span style={tenue}>Elija una partida en la tabla.</span>}
          </section>
        </div>
      </>}
    </div>
  )
}
