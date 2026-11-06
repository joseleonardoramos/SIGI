import { useEffect, useState, type CSSProperties } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal } from './supabase'
import { aCsv, descargar } from './csv'
import { acumular, etiquetaMes, indiceMes, mesesDelEjercicio, programar, transcurrido, type Mes } from './panelDatos'

// Panel gerencial, reconstruido a partir de design/Main.dc.html con datos reales.
// Pendiente de definir por el usuario: la proyección de cierre y las iniciativas de ahorro.

type Empresa = { id: string; nombre: string; tema: string; moneda_reporte: string; inicio_ejercicio_mes?: number }
type Version = { id: string; empresa_id: string; ejercicio: string; numero: number; estado: string }
type Partida = { id: string; empresa_id: string; version_id: string; categoria: string; distribucion: string; cuenta_contable: string | null; centro_costo_codigo: string | null; monto: number }
type Saldo = { partida_id: string; comprometido: number; ejecutado: number; disponible: number; presupuesto: number }
type Factura = { fecha: string; monto: number; gastos: { partida_id: string | null; tasa: number } | null }
type Servicio = { empresa_id: string; sucursal: string; tipo: string; detalle: string; estatus: string; moneda: string; monto: number; cuenta_contable: string | null; vence: string | null }
type Linea = { empresa_id: string; estado: string; costo_mensual: number }
type Software = { empresa_id: string; nombre: string; contratadas: number; asignadas: number; precio_unitario: number; moneda: string; vence: string | null; renovacion: string; preaviso_dias: number }

const TONO = { ok: ['#E7F5EF', '#075B3F'], warn: ['#FFF4D6', '#6B4A00'], risk: ['#FBE9DF', '#8A3A12'], info: ['#E6EEF7', '#1D3557'] } as const
const COLORES_EMPRESA: Record<string, [string, string]> = { catador: ['#262727', '#807451'], bona: ['#000000', '#BC2F2C'] }
const M = (v: number) => v / 1e6
const f1 = (v: number) => M(v).toFixed(1)
const f2 = (v: number) => M(v).toFixed(2)
const corto = (v: number) => (Math.abs(v) >= 1e6 ? `${M(v).toFixed(2)} M` : `${(v / 1e3).toFixed(1)} K`)
const fechaLarga = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 864e5)

const tarjeta: CSSProperties = { background: '#FFFFFF', border: '1px solid var(--borde)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }
const titulo: CSSProperties = { margin: 0, fontSize: 17, fontWeight: 600 }
const tenue: CSSProperties = { fontSize: 13, color: 'var(--tenue)' }
const etiquetaFiltro: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--tenue)', fontWeight: 600 }
const selectFiltro: CSSProperties = { height: 40, minWidth: 170, border: '1px solid var(--borde)', borderRadius: 8, padding: '0 10px', fontSize: 14, color: 'var(--tinta)', background: '#FFFFFF' }
const muestra = (fondo: string, extra: CSSProperties = {}) => <span style={{ width: 12, height: 12, background: fondo, borderRadius: 2, ...extra }} />

export default function Panel({ empresas, empresa, setEmpresa, personal, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  personal: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [versiones, setVersiones] = useState<Version[]>([])
  const [version, setVersion] = useState('')
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [saldos, setSaldos] = useState<Record<string, Saldo>>({})
  const [tipos, setTipos] = useState<Record<string, string>>({}) // empresa|cuenta → OPEX/CAPEX
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [lineas, setLineas] = useState<Linea[]>([])
  const [software, setSoftware] = useState<Software[]>([])
  const [fuera, setFuera] = useState<string[]>([])
  const [categoria, setCategoria] = useState('')
  const [centro, setCentro] = useState('')
  const [modo, setModo] = useState<'mensual' | 'acumulado'>('mensual')
  const [error, setError] = useState('')
  const [info, setInfo] = useState<Record<string, number>>({}) // empresa → mes de inicio del ejercicio

  const todas = co === 'all'
  const hoy = fechaLocal()

  useEffect(() => { if (empresa && co !== 'all') setCo(empresa) }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  // Datos de las empresas visibles (una o todas). RLS limita lo que cada usuario ve.
  useEffect(() => {
    // Registros activos de la tabla, de la empresa elegida o de todas las visibles.
    const de = <T,>(tabla: string, columnas: string) => leerTodo<T>((d, h) => {
      let q = supabase.from(tabla).select(columnas).eq('activo', true)
      if (!todas) q = q.eq('empresa_id', co)
      return q.order('id').range(d, h)
    })
    Promise.all([
      supabase.from('empresas').select('id, inicio_ejercicio_mes').eq('activo', true),
      de<Version>('presupuestos_versiones', 'id, empresa_id, ejercicio, numero, estado'),
      de<Servicio>('servicios_telecom', 'empresa_id, sucursal, tipo, detalle, estatus, moneda, monto, cuenta_contable, vence'),
      de<Linea>('lineas_flota', 'empresa_id, estado, costo_mensual'),
      de<Software>('productos_software', 'empresa_id, nombre, contratadas, asignadas, precio_unitario, moneda, vence, renovacion, preaviso_dias'),
      de<{ empresa_id: string; codigo: string; tipo: string }>('cuentas_contables', 'empresa_id, codigo, tipo'),
    ]).then(async ([e, v, s, l, sw, cc]) => {
      const fallo = e.error ?? v.error ?? s.error ?? l.error ?? sw.error ?? cc.error
      if (fallo) { setError(await mensajeError(fallo)); return }
      setInfo(Object.fromEntries((e.data ?? []).map((x) => [x.id, x.inicio_ejercicio_mes])))
      setVersiones(v.data)
      setVersion(v.data.find((x) => x.estado === 'Vigente' && x.empresa_id === co)?.id ?? v.data.find((x) => x.empresa_id === co)?.id ?? '')
      setServicios(s.data)
      setLineas(l.data)
      setSoftware(sw.data)
      setTipos(Object.fromEntries(cc.data.map((x) => [`${x.empresa_id}|${x.codigo}`, x.tipo])))
    })
    if (personal) {
      let q = supabase.from('ausencias').select('personas!ausencias_persona_id_fkey(nombre)').eq('activo', true).eq('cancelada', false).lte('desde', hoy).gte('hasta', hoy)
      if (!todas) q = q.eq('empresa_id', co)
      q.then(({ data }) => setFuera(((data ?? []) as unknown as { personas: { nombre: string } | null }[]).map((a) => a.personas?.nombre ?? '')))
    }
  }, [co]) // eslint-disable-line react-hooks/exhaustive-deps

  // Versiones que se miden: la elegida (una empresa) o la vigente de cada empresa (consolidado).
  const medidas = todas ? versiones.filter((v) => v.estado === 'Vigente').map((v) => v.id) : version ? [version] : []
  const clave = medidas.join(',')
  useEffect(() => {
    if (!clave) { setPartidas([]); setSaldos({}); setFacturas([]); return }
    const ids = clave.split(',')
    Promise.all([
      leerTodo<Partida>((d, h) => supabase.from('partidas').select('id, empresa_id, version_id, categoria, distribucion, cuenta_contable, centro_costo_codigo, monto').eq('activo', true).in('version_id', ids).order('id').range(d, h)),
      leerTodo<Saldo>((d, h) => supabase.from('saldo_partidas').select('partida_id, comprometido, ejecutado, disponible, presupuesto').in('version_id', ids).order('partida_id').range(d, h)),
    ]).then(async ([p, s]) => {
      const fallo = p.error ?? s.error
      if (fallo) { setError(await mensajeError(fallo)); return }
      setPartidas(p.data)
      setSaldos(Object.fromEntries(s.data.map((x) => [x.partida_id, x])))
      const partidaIds = new Set(p.data.map((x) => x.id))
      const empresasIds = [...new Set(p.data.map((x) => x.empresa_id))]
      const f = await leerTodo<Factura>((d, h) => supabase.from('gasto_pasos').select('fecha, monto, gastos!gasto_pasos_gasto_id_fkey(partida_id, tasa)')
        .eq('tipo', 'Factura').eq('activo', true).eq('reversado', false).in('empresa_id', empresasIds.length ? empresasIds : ['00000000-0000-0000-0000-000000000000']).order('id').range(d, h))
      setFacturas(f.data.filter((x) => x.gastos?.partida_id && partidaIds.has(x.gastos.partida_id)))
    })
  }, [clave])

  const elegir = (id: string) => { setCo(id); setCategoria(''); setCentro(''); if (id !== 'all') setEmpresa(id) }
  const emp = empresas.find((e) => e.id === co)
  const nombreVista = todas ? 'Consolidado' : emp?.nombre ?? ''
  const moneda = todas ? empresas[0]?.moneda_reporte ?? 'RD$' : emp?.moneda_reporte ?? 'RD$'
  const ver = versiones.find((v) => v.id === version)

  // Partidas filtradas por categoría y centro de costo.
  const lista = partidas.filter((p) => (!categoria || p.categoria === categoria) && (!centro || p.centro_costo_codigo === centro))
  const s = (p: Partida) => saldos[p.id] ?? { comprometido: 0, ejecutado: 0, disponible: Number(p.monto), presupuesto: Number(p.monto), partida_id: p.id }
  const pendiente = (p: Partida) => Math.max(Number(s(p).comprometido) - Number(s(p).ejecutado), 0) // comprometido aún sin facturar
  const sum = (ps: Partida[], f: (p: Partida) => number) => ps.reduce((t, p) => t + f(p), 0)
  const tot = {
    bud: sum(lista, (p) => Number(p.monto)), exe: sum(lista, (p) => Number(s(p).ejecutado)), com: sum(lista, pendiente),
    disp: sum(lista, (p) => Number(s(p).disponible)),
    ahorro: sum(lista, (p) => Math.max(Number(s(p).disponible), 0)), exceso: sum(lista, (p) => Math.max(-Number(s(p).disponible), 0)),
  }
  const neto = tot.ahorro - tot.exceso
  const pctDe = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '—')

  // Gráfico mensual (una empresa): presupuesto programado vs. ejecutado por mes del ejercicio.
  const meses: Mes[] = ver ? mesesDelEjercicio(ver.ejercicio, info[co] ?? 1) : []
  const avance = meses.length ? transcurrido(meses, hoy) : 0
  const corteIdx = meses.length ? Math.max(indiceMes(hoy, meses), avance >= 1 ? 11 : -1) : -1
  const prog = meses.map(() => 0)
  for (const p of lista) programar(Number(p.monto), p.distribucion, meses).forEach((v, i) => { prog[i] += v })
  const ids = new Set(lista.map((p) => p.id))
  const ejec = meses.map(() => 0)
  for (const f of facturas) {
    if (!f.gastos?.partida_id || !ids.has(f.gastos.partida_id)) continue
    const i = indiceMes(f.fecha, meses)
    if (i >= 0) ejec[i] += Number(f.monto) * Number(f.gastos.tasa)
  }
  const presMes = modo === 'mensual' ? prog : acumular(prog)
  const ejecMes = modo === 'mensual' ? ejec : acumular(ejec)
  const tope = Math.max(...presMes, ...ejecMes, 1)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ pos: t * 206, label: M(tope * t).toFixed(tope >= 1e7 ? 0 : 1) }))
  const progCorte = prog.slice(0, corteIdx + 1).reduce((a, b) => a + b, 0)

  // Por categoría (tabla y ahorros).
  const categorias = [...new Set(partidas.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'es'))
  const centros = [...new Set(partidas.map((p) => p.centro_costo_codigo).filter(Boolean) as string[])].sort()
  const porCat = [...new Set(lista.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'es')).map((c) => {
    const ps = lista.filter((p) => p.categoria === c)
    const tiposCat = [...new Set(ps.map((p) => (p.cuenta_contable ? tipos[`${p.empresa_id}|${p.cuenta_contable}`] : undefined)).filter(Boolean))]
    const bud = sum(ps, (p) => Number(p.monto)), exe = sum(ps, (p) => Number(s(p).ejecutado)), com = sum(ps, pendiente), disp = sum(ps, (p) => Number(s(p).disponible))
    return { c, tipo: tiposCat.length === 1 ? tiposCat[0]! : tiposCat.length ? 'Mixto' : '—', bud, exe, com, disp, ahorro: sum(ps, (p) => Math.max(Number(s(p).disponible), 0)) }
  })

  // Resumen por módulo.
  const enGestion = servicios.filter((x) => x.estatus !== 'Activo').length
  const respaldo = Object.values(servicios.filter((x) => x.tipo === 'Internet' || x.tipo === 'Metro Ethernet')
    .reduce<Record<string, number>>((r, x) => { const k = `${x.empresa_id}|${x.sucursal}`; r[k] = (r[k] ?? 0) + 1; return r }, {})).filter((n) => n > 1).length
  const lineasActivas = lineas.filter((l) => l.estado !== 'Cancelada')
  const costoLineas = lineasActivas.reduce((t, l) => t + Number(l.costo_mensual), 0)
  const contratadas = software.reduce((t, x) => t + Number(x.contratadas), 0)
  const asignadas = software.reduce((t, x) => t + Number(x.asignadas), 0)
  const en90 = (v: string | null) => !!v && v >= hoy && dias(hoy, v) <= 90
  const nombreEmp = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const modulos = [
    { nombre: 'Telecomunicaciones', vista: 'telecom', stats: [
      ['Servicios activos', String(servicios.length)], ['Costo mensual', `RD$ ${corto(servicios.filter((x) => x.moneda === 'RD$').reduce((t, x) => t + Number(x.monto), 0))}`],
      ['Sucursales con respaldo', String(respaldo)], ['Servicios en gestión', String(enGestion)]] },
    { nombre: 'Flotas móviles', vista: 'flotas', stats: [
      ['Líneas activas', String(lineasActivas.length)], ['Costo promedio / línea', lineasActivas.length ? `RD$ ${(costoLineas / lineasActivas.length).toFixed(0)}` : '—'],
      ['Sin uso 90 días', String(lineas.filter((l) => l.estado === 'Sin uso 90 días').length), 'riesgo'], ['Cambiazos elegibles', String(lineas.filter((l) => l.estado === 'Cambiazo elegible').length)]] },
    { nombre: 'Software y suscripciones', vista: 'software', stats: [
      ['Licencias contratadas', contratadas.toLocaleString('en-US')], ['Asignadas', asignadas.toLocaleString('en-US')],
      ['Sin asignar', String(contratadas - asignadas), 'riesgo'], ['Renovaciones 90 días', String(software.filter((x) => en90(x.vence)).length)]] },
  ]

  // Renovaciones próximas (90 días): software y servicios con fecha de vencimiento.
  const renovaciones = [
    ...software.filter((x) => en90(x.vence)).map((x) => {
      const faltan = dias(hoy, x.vence!)
      const [estado, tono]: [string, keyof typeof TONO] = faltan <= x.preaviso_dias ? [`Preaviso ${x.preaviso_dias} días`, 'risk'] : x.renovacion === 'Automática' ? ['Renovación automática', 'info'] : ['Sin acción', 'ok']
      return { nombre: x.nombre, empresa: nombreEmp(x.empresa_id), vence: x.vence!, importe: `${x.moneda} ${corto(Number(x.precio_unitario) * Number(x.contratadas))}`, estado, tono }
    }),
    ...servicios.filter((x) => en90(x.vence)).map((x) => ({
      nombre: `${x.detalle} · ${x.sucursal}`, empresa: nombreEmp(x.empresa_id), vence: x.vence!, importe: `${x.moneda} ${corto(Number(x.monto))}/mes`, estado: 'Revisar contrato', tono: 'warn' as const,
    })),
  ].sort((a, b) => a.vence.localeCompare(b.vence))

  // Alertas: solo hechos que la base ya registra.
  const alertas: { nivel: string; texto: string; tono: keyof typeof TONO }[] = []
  for (const e of todas ? empresas : emp ? [emp] : []) {
    const ps = partidas.filter((p) => p.empresa_id === e.id)
    for (const c of [...new Set(ps.map((p) => p.categoria))]) {
      const exceso = sum(ps.filter((p) => p.categoria === c), (p) => Math.max(-Number(s(p).disponible), 0))
      if (exceso > 0) alertas.push({ nivel: 'EXCESO', tono: 'risk', texto: `${e.nombre} · ${c} supera su presupuesto por ${e.moneda_reporte} ${f2(exceso)} M. Queda registrado como fuera de presupuesto.` })
    }
    const sinCuenta = ps.filter((p) => !p.cuenta_contable)
    if (sinCuenta.length) alertas.push({ nivel: 'CALIDAD', tono: 'warn', texto: `${e.nombre} · ${sinCuenta.length} partida(s) sin cuenta contable por ${e.moneda_reporte} ${f2(sum(sinCuenta, (p) => Number(p.monto)))} M.` })
    const servSin = servicios.filter((x) => x.empresa_id === e.id && !x.cuenta_contable).length
    if (servSin) alertas.push({ nivel: 'CALIDAD', tono: 'warn', texto: `${e.nombre} · ${servSin} servicio(s) de telecomunicaciones sin cuenta contable.` })
    const sinUso = lineas.filter((l) => l.empresa_id === e.id && l.estado === 'Sin uso 90 días').length
    if (sinUso) alertas.push({ nivel: 'AHORRO', tono: 'ok', texto: `${e.nombre} · ${sinUso} línea(s) móvil(es) sin uso en 90 días, candidatas a baja.` })
  }

  // Avance por empresa (consolidado).
  const avancePorEmpresa = empresas.map((e) => {
    const v = versiones.find((x) => x.empresa_id === e.id && x.estado === 'Vigente')
    const ps = partidas.filter((p) => p.empresa_id === e.id)
    const bud = sum(ps, (p) => Number(p.monto)), exe = sum(ps, (p) => Number(s(p).ejecutado)), com = sum(ps, pendiente)
    const net = sum(ps, (p) => Math.max(Number(s(p).disponible), 0)) - sum(ps, (p) => Math.max(-Number(s(p).disponible), 0))
    const ms = v ? mesesDelEjercicio(v.ejercicio, info[e.id] ?? 1) : []
    return { e, v, bud, exe, com, net, elapsed: ms.length ? transcurrido(ms, hoy) * 100 : 0, colores: COLORES_EMPRESA[e.tema] ?? COLORES_EMPRESA.catador,
      periodo: ms.length ? `${etiquetaMes(ms[0])} ${ms[0].anio} – ${etiquetaMes(ms[11])} ${ms[11].anio}` : 'Sin versión vigente' }
  })

  function exportar() {
    descargar(`panel-${nombreVista}-${hoy}.csv`, aCsv(
      ['Categoría', 'Tipo', 'Vigente', 'Ejecutado', 'Comprometido', 'Reservado', 'Disponible', 'Ahorro / (exceso)'],
      porCat.map((c) => [c.c, c.tipo, c.bud, c.exe, c.com, 0, c.disp, c.disp]),
    ))
  }

  const periodo = todas ? 'Ejercicios vigentes de cada empresa' : ver && meses.length
    ? `Ejercicio ${ver.ejercicio} (${etiquetaMes(meses[0])} ${meses[0].anio} – ${etiquetaMes(meses[11])} ${meses[11].anio})` : 'Sin versión de presupuesto'
  const kpis: { label: string; value: string; sub: string; color?: string }[] = [
    ...(personal ? [{ label: 'Personal fuera hoy', value: String(fuera.length), sub: fuera.length ? fuera.join(', ') : 'Nadie de vacaciones ni con permiso' }] : []),
    { label: 'Presupuesto vigente', value: f1(tot.bud), sub: todas ? `${medidas.length} versión(es) vigente(s)` : ver ? `Versión ${ver.numero} · ${ver.estado}` : '—' },
    { label: 'Ejecutado', value: f1(tot.exe), sub: `${pctDe(tot.exe, tot.bud)} del vigente${todas ? '' : ` · ${(avance * 100).toFixed(0)} % del año`}`, color: 'var(--primario)' },
    { label: 'Comprometido + reservas', value: f1(tot.com), sub: `Compromisos ${f1(tot.com)} · Reservas 0.0` },
    { label: 'Disponible', value: f1(tot.disp), sub: `${pctDe(tot.disp, tot.bud)} del vigente`, color: tot.disp < 0 ? 'var(--riesgo)' : undefined },
    { label: 'Proyección de cierre', value: '—', sub: 'Método por definir' },
  ]

  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={tenue}>Control · Panel gerencial · Ambiente <b>{nombreVista}</b></span>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em' }}>Panel gerencial de infraestructura</h1>
          <span style={{ fontSize: 14, color: 'var(--tenue)' }}>{periodo} · Corte al {fechaLarga(hoy)} · {moneda} millones · Vista: <b style={{ color: 'var(--tinta)' }}>ejecución</b></span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="Empresa" style={{ display: 'flex', border: '1px solid var(--borde)', borderRadius: 10, overflow: 'hidden', background: '#FFFFFF' }}>
            {[{ id: 'all', nombre: 'Consolidado' }, ...empresas].map((c) => (
              <button key={c.id} onClick={() => elegir(c.id)} aria-pressed={co === c.id}
                style={{ height: 44, padding: '0 18px', border: 'none', borderRadius: 0, fontSize: 14, fontWeight: 600, background: co === c.id ? 'var(--boton-activo)' : '#FFFFFF', color: co === c.id ? '#FFFFFF' : 'var(--tinta)' }}>
                {c.nombre}
              </button>
            ))}
          </div>
          <button onClick={exportar} style={{ height: 44, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--acento)', color: '#FFFFFF', fontSize: 14, fontWeight: 600 }}>Exportar</button>
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <form aria-label="Filtros" onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, background: '#FFFFFF', border: '1px solid var(--borde)', borderRadius: 12, padding: '14px 16px' }}>
        {!todas && (
          <label style={etiquetaFiltro}>Ejercicio y versión
            <select style={{ ...selectFiltro, minWidth: 220 }} value={version} onChange={(e) => setVersion(e.target.value)}>
              {versiones.filter((v) => v.empresa_id === co).map((v) => <option key={v.id} value={v.id}>{v.ejercicio} · v{v.numero} · {v.estado}</option>)}
            </select>
          </label>
        )}
        <label style={etiquetaFiltro}>Categoría
          <select style={selectFiltro} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>{categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label style={etiquetaFiltro}>Centro de costo
          <select style={selectFiltro} value={centro} onChange={(e) => setCentro(e.target.value)}>
            <option value="">Todos</option>{centros.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label style={etiquetaFiltro}>Moneda
          <select style={{ ...selectFiltro, minWidth: 120 }} value={moneda} onChange={() => undefined}><option>{moneda}</option></select>
        </label>
      </form>

      <section aria-label="Indicadores clave" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: '#FFFFFF', border: '1px solid var(--borde)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--tenue)', fontWeight: 600 }}>{k.label}</span>
            <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: k.color ?? 'var(--tinta)' }}>{k.value}</span>
            <span style={{ fontSize: 12, color: 'var(--tenue)' }}>{k.sub}</span>
          </div>
        ))}
        <div style={{ background: 'var(--ahorro-fondo)', border: '1px solid var(--ahorro-suave)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--ahorro-tinta)', fontWeight: 700 }}>Ahorro neto generado</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: 'var(--ahorro-tinta)' }}>{f2(neto)}</span>
          <span style={{ fontSize: 12, color: 'var(--ahorro-tinta)' }}>Ahorro {f2(tot.ahorro)} − excesos {f2(tot.exceso)}</span>
        </div>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <section aria-labelledby="h-chart" style={{ ...tarjeta, flex: '2 1 560px', minWidth: 0 }}>
          {!todas ? (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h2 id="h-chart" style={titulo}>Presupuesto vs. ejecución · {nombreVista}</h2>
                  <span style={tenue}>{meses.length ? `${etiquetaMes(meses[0])}–${etiquetaMes(meses[11])} · ejecutado al corte · ${moneda} M` : 'Sin versión de presupuesto'}</span>
                </div>
                <div role="group" aria-label="Modo del gráfico" style={{ display: 'flex', border: '1px solid var(--borde)', borderRadius: 8, overflow: 'hidden' }}>
                  {(['mensual', 'acumulado'] as const).map((m) => (
                    <button key={m} onClick={() => setModo(m)} aria-pressed={modo === m}
                      style={{ height: 44, padding: '0 16px', border: 'none', borderRadius: 0, fontSize: 14, fontWeight: 600, background: modo === m ? 'var(--boton-activo)' : '#FFFFFF', color: modo === m ? '#FFFFFF' : 'var(--tinta)' }}>
                      {m === 'mensual' ? 'Mensual' : 'Acumulado'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ position: 'relative', height: 236 }}>
                {ticks.map((t) => (
                  <div key={t.pos} style={{ position: 'absolute', left: 0, right: 0, bottom: t.pos + 24, display: 'flex', alignItems: 'center', gap: 8, height: 0 }}>
                    <span className="mono" style={{ width: 34, textAlign: 'right', fontSize: 11, color: 'var(--tenue)' }}>{t.label}</span>
                    <div style={{ flex: 1, borderTop: '1px solid var(--pista)' }} />
                  </div>
                ))}
                <div style={{ position: 'absolute', left: 44, right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                  {meses.map((m, i) => (
                    <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 206 }}>
                        <div title={`Presupuesto ${f2(presMes[i])}`} style={{ width: 12, height: (presMes[i] / tope) * 206, background: 'var(--presupuesto)', borderRadius: '3px 3px 0 0' }} />
                        {i <= corteIdx && <div title={`Ejecutado ${f2(ejecMes[i])}`} style={{ width: 12, height: (ejecMes[i] / tope) * 206, background: 'var(--primario)', borderRadius: '3px 3px 0 0' }} />}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--tenue)', height: 18 }}>{etiquetaMes(m)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, color: 'var(--tenue)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{muestra('var(--presupuesto)')}Presupuesto vigente</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{muestra('var(--primario)')}Ejecutado</span>
                <span style={{ marginLeft: 'auto' }} className="mono">
                  {modo === 'mensual' ? `Al corte: presupuesto ${f1(progCorte)} · ejecutado ${f1(tot.exe)}` : `Vigente ${f1(tot.bud)} · ejecutado ${f1(tot.exe)}`}
                </span>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h2 style={titulo}>Avance por empresa</h2>
                <span style={tenue}>Ejercicios distintos: cada barra se mide contra su propio período fiscal · la línea marca el tiempo transcurrido</span>
              </div>
              {avancePorEmpresa.map((p) => (
                <div key={p.e.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, fontSize: 14 }}><b>{p.e.nombre}</b><span style={{ color: 'var(--tenue)' }}>{p.periodo}</span></div>
                  <div style={{ position: 'relative', height: 30 }}>
                    <div style={{ display: 'flex', height: 30, background: 'var(--pista)', borderRadius: 6, overflow: 'hidden' }}>
                      <div title="Ejecutado" style={{ width: `${p.bud ? Math.min((p.exe / p.bud) * 100, 100) : 0}%`, background: p.colores[0] }} />
                      <div title="Comprometido" style={{ width: `${p.bud ? Math.min((p.com / p.bud) * 100, 100) : 0}%`, background: p.colores[1] }} />
                    </div>
                    <div aria-hidden="true" style={{ position: 'absolute', top: -4, bottom: -4, left: `${p.elapsed}%`, width: 2, background: 'var(--tinta)' }} />
                  </div>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--tenue)' }}>
                    Vigente {f2(p.bud)} · Ejecutado {f2(p.exe)} ({pctDe(p.exe, p.bud)}) · Comprometido {f2(p.com)} · Ahorro neto {f2(p.net)}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, color: 'var(--tenue)' }}>
                {avancePorEmpresa.map((p) => (
                  <span key={p.e.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{muestra(p.colores[0])}{muestra(p.colores[1])}{p.e.nombre}</span>
                ))}
                <span>Oscuro: ejecutado · color: comprometido</span>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="h-ahorro" style={{ ...tarjeta, flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-ahorro" style={titulo}>Ahorros generados vs. presupuesto</h2>
            <span style={tenue}>Por categoría · {moneda} M en el ejercicio</span>
          </div>
          {porCat.map((c) => (
            <div key={c.c} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{c.c}</span><span className="mono" style={{ fontWeight: 600 }}>{f2(c.ahorro)}</span></div>
              <div style={{ display: 'flex', height: 12, background: 'var(--pista)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ width: `${tot.ahorro ? (c.ahorro / tot.ahorro) * 100 : 0}%`, background: 'var(--ahorro)' }} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--tenue)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{muestra('var(--ahorro)')}Saldo bajo el presupuesto</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, borderTop: '1px solid var(--pista)', paddingTop: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 12, color: 'var(--tenue)' }}>Ahorro bruto</span><span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{f2(tot.ahorro)}</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 12, color: 'var(--tenue)' }}>Excesos</span><span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--riesgo)' }}>({f2(tot.exceso)})</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 12, color: 'var(--tenue)' }}>Ahorro neto</span><span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ahorro-tinta)' }}>{f2(neto)}</span></div>
          </div>
        </section>
      </div>

      <section aria-labelledby="h-cat" style={{ ...tarjeta, gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2 id="h-cat" style={titulo}>Ejecución por categoría (OPEX y CAPEX) · {nombreVista}</h2>
          <span style={tenue}>Disponible = vigente − compromisos − ejecutado · sin doble conteo</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="t" style={{ minWidth: 960 }}>
            <thead><tr style={{ color: 'var(--tenue)' }}><th>Categoría</th><th>Tipo</th><th className="r">Vigente</th><th className="r">Ejecutado</th><th className="r">Comprometido</th><th className="r">Reservado</th><th className="r">Disponible</th><th className="r">Proyección</th><th className="r">Ahorro / (exceso)</th><th style={{ width: 200 }}>Consumo del presupuesto</th></tr></thead>
            <tbody>
              {porCat.map((c) => (
                <tr key={c.c}>
                  <td style={{ fontWeight: 600 }}>{c.c}</td>
                  <td style={{ color: 'var(--tenue)' }}>{c.tipo}</td>
                  <td className="r mono">{f2(c.bud)}</td>
                  <td className="r mono">{f2(c.exe)}</td>
                  <td className="r mono">{f2(c.com)}</td>
                  <td className="r mono">0.00</td>
                  <td className="r mono">{f2(c.disp)}</td>
                  <td className="r mono">—</td>
                  <td className="r mono" style={{ fontWeight: 600, color: c.disp < 0 ? 'var(--riesgo)' : 'var(--ahorro-tinta)' }}>{c.disp < 0 ? `(${f2(-c.disp)})` : f2(c.disp)}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, display: 'flex', height: 10, background: 'var(--pista)', borderRadius: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${c.bud ? Math.min((c.exe / c.bud) * 100, 100) : 0}%`, background: 'var(--primario)' }} />
                      <div style={{ width: `${c.bud ? Math.min((c.com / c.bud) * 100, 100) : 0}%`, background: 'var(--primario2)' }} />
                    </div>
                    <span className="mono" style={{ fontSize: 12, width: 44, textAlign: 'right' }}>{pctDe(c.exe + c.com, c.bud)}</span>
                  </div></td>
                </tr>
              ))}
              <tr style={{ background: 'var(--suave)' }}>
                <td style={{ fontWeight: 700 }}>Total {nombreVista}</td><td />
                <td className="r mono" style={{ fontWeight: 700 }}>{f2(tot.bud)}</td><td className="r mono" style={{ fontWeight: 700 }}>{f2(tot.exe)}</td>
                <td className="r mono" style={{ fontWeight: 700 }}>{f2(tot.com)}</td><td className="r mono" style={{ fontWeight: 700 }}>0.00</td>
                <td className="r mono" style={{ fontWeight: 700 }}>{f2(tot.disp)}</td><td className="r mono" style={{ fontWeight: 700 }}>—</td>
                <td className="r mono" style={{ fontWeight: 700, color: 'var(--ahorro-tinta)' }}>{f2(neto)}</td>
                <td className="mono" style={{ fontSize: 12, textAlign: 'right' }}>{pctDe(tot.exe + tot.com, tot.bud)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, color: 'var(--tenue)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{muestra('var(--primario)')}Ejecutado</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{muestra('var(--primario2)')}Comprometido</span>
        </div>
      </section>

      <section aria-label="Resumen por módulo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {modulos.map((m) => (
          <button key={m.nombre} onClick={() => ir(m.vista)} style={{ ...tarjeta, gap: 14, textAlign: 'left', color: 'var(--tinta)', minHeight: 0, fontWeight: 400, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{m.nombre}</h2>
              <span style={{ fontSize: 13, color: 'var(--enlace)', fontWeight: 600 }}>Abrir →</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, width: '100%' }}>
              {m.stats.map(([l, v, c]) => (
                <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--tenue)' }}>{l}</span>
                  <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: c ? 'var(--riesgo)' : 'var(--tinta)' }}>{v}</span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <section aria-labelledby="h-ren" style={{ ...tarjeta, flex: '1 1 480px', minWidth: 0, gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <h2 id="h-ren" style={titulo}>Renovaciones próximas (90 días)</h2>
            <span style={tenue}>{renovaciones.length} contrato(s)</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="t" style={{ minWidth: 600 }}>
              <thead><tr style={{ color: 'var(--tenue)' }}><th>Contrato / producto</th><th>Empresa</th><th>Vence</th><th className="r">Importe</th><th>Estado</th></tr></thead>
              <tbody>
                {renovaciones.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.nombre}</td><td style={{ color: 'var(--tenue)' }}>{r.empresa}</td>
                    <td className="mono">{fechaLarga(r.vence)}</td><td className="r mono">{r.importe}</td>
                    <td><span style={{ fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 999, background: TONO[r.tono][0], color: TONO[r.tono][1], whiteSpace: 'nowrap' }}>{r.estado}</span></td>
                  </tr>
                ))}
                {renovaciones.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--tenue)' }}>Nada vence en los próximos 90 días.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section aria-labelledby="h-al" style={{ ...tarjeta, flex: '1 1 380px', minWidth: 0, gap: 12 }}>
          <h2 id="h-al" style={titulo}>Alertas y calidad de datos</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alertas.map((a, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, background: 'var(--suave)' }}>
                <span style={{ flex: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', padding: '3px 7px', borderRadius: 4, background: TONO[a.tono][0], color: TONO[a.tono][1] }}>{a.nivel}</span>
                <span style={{ fontSize: 13, lineHeight: '19px' }}>{a.texto}</span>
              </li>
            ))}
            {alertas.length === 0 && <li style={{ fontSize: 13, color: 'var(--tenue)' }}>Sin alertas.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
