import { useEffect, useState, type CSSProperties } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal, dinero } from './supabase'
import { Formulario, type Fila } from './Catalogo'
import { MODULOS } from './modulos'
import { etiquetaMes, mesesDelEjercicio } from './panelDatos'
import { ahorroAnual, ahorroDe, cuenta, enEjercicio } from './ahorro'
import { fechaCorta } from './comun'
import { Barra, Cabecera, DadosDeBaja, Mensajes, h2, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Ahorros generados vs. presupuesto, reconstruida a partir de design/Ahorros.dc.html con datos reales.
// Ahorro = iniciativas registradas (línea base − costo nuevo, anual), prorrateado en el ejercicio desde su fecha efectiva.
// Realizado = estado «Realizado»; en gestión = los demás salvo «Descartada». Excesos = partidas vigentes sobre su presupuesto.
// Proyección de cierre = presupuesto vigente − ahorro neto (realizado + en gestión − excesos).

type Iniciativa = Fila & { empresa_id: string; codigo: string; nombre: string; modulo: string; palanca: string; linea_base: number; costo_nuevo: number; fecha_efectiva: string; estado: string; evidencia: string | null }
type Version = { id: string; empresa_id: string; ejercicio: string }
type Saldo = { version_id: string; presupuesto: number; disponible: number }

const TONO: Record<string, [string, string]> = {
  'Realizado': ['#E7F5EF', '#075B3F'], 'En negociación': ['#FFF4D6', '#6B4A00'], 'En trámite': ['#E6EEF7', '#1D3557'],
  'En validación': ['#E6EEF7', '#1D3557'], 'Propuesta': ['#EEF1F4', '#3E4A58'], 'Descartada': ['#EEEEEE', '#7A7A7A'],
}
const MODULOS_AHORRO: [string, string][] = [['Telecom', 'Telecomunicaciones'], ['Flotas', 'Flotas móviles'], ['Software', 'Software y suscripciones'], ['Partida', 'Otras partidas'], ['Otro', 'Otro']]
const der: CSSProperties = { textAlign: 'right' }
const m2 = (v: number) => (v / 1e6).toFixed(2)


export default function Ahorros({ empresas, empresa, setEmpresa, puedeEscribir, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  puedeEscribir: boolean
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [iniciativas, setIniciativas] = useState<Iniciativa[]>([])
  const [vigentes, setVigentes] = useState<Version[]>([])
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [inicio, setInicio] = useState<Record<string, number>>({})
  const [formulario, setFormulario] = useState<{ fila: Iniciativa | null } | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const hoy = fechaLocal()
  const todas = co === 'all'
  useEffect(() => { if (empresa && co !== 'all') setCo(empresa) }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  // Todas las empresas visibles: las tarjetas comparan empresas y consolidado. RLS limita lo que cada usuario ve.
  async function cargar() {
    const [e, v, i] = await Promise.all([
      supabase.from('empresas').select('id, inicio_ejercicio_mes').eq('activo', true),
      supabase.from('presupuestos_versiones').select('id, empresa_id, ejercicio').eq('activo', true).eq('estado', 'Vigente'),
      leerTodo<Iniciativa>((d, h) => supabase.from('iniciativas_ahorro').select('*').order('codigo').order('id').range(d, h)),
    ])
    const fallo = e.error ?? v.error ?? i.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    const versiones = (v.data ?? []) as Version[]
    const s = versiones.length
      ? await leerTodo<Saldo>((d, h) => supabase.from('saldo_partidas').select('version_id, presupuesto, disponible').in('version_id', versiones.map((x) => x.id)).order('partida_id').range(d, h))
      : { data: [] as Saldo[], error: null }
    if (s.error) { setError(await mensajeError(s.error)); return }
    setInicio(Object.fromEntries((e.data ?? []).map((x) => [x.id, x.inicio_ejercicio_mes])))
    setVigentes(versiones)
    setSaldos(s.data)
    setIniciativas(i.data)
  }
  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: string) => { setCo(id); setFormulario(null); setMsg(''); if (id !== 'all') setEmpresa(id) }
  const emp = empresas.find((e) => e.id === co)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const moneda = (todas ? empresas[0] : emp)?.moneda_reporte ?? 'RD$'
  // Ejercicio de cada empresa: el de su versión vigente; sin versión vigente, el que contiene hoy.
  const mesesDe = (id: string) => {
    const v = vigentes.find((x) => x.empresa_id === id)
    const ini = inicio[id] ?? 1
    const anio = Number(hoy.slice(0, 4)) - (Number(hoy.slice(5, 7)) < ini ? 1 : 0)
    return mesesDelEjercicio(v?.ejercicio ?? String(anio), ini)
  }
  const ej = (i: Iniciativa) => enEjercicio(i, mesesDe(i.empresa_id))

  const resumen = (id: string) => {
    const ids = id === 'all' ? empresas.map((e) => e.id) : [id]
    const rs = iniciativas.filter((i) => i.activo && ids.includes(i.empresa_id))
    const { R, G } = ahorroDe(rs, mesesDe)
    const versiones = vigentes.filter((v) => ids.includes(v.empresa_id)).map((v) => v.id)
    const ss = saldos.filter((s) => versiones.includes(s.version_id))
    const vigente = ss.reduce((a, s) => a + Number(s.presupuesto), 0)
    const excesos = ss.reduce((a, s) => a + Math.max(-Number(s.disponible), 0), 0)
    return { rs, R, G, bruto: R + G, excesos, neto: R + G - excesos, vigente }
  }
  const S = resumen(co)
  const tarjetas = [...empresas.map((e) => ({ id: e.id, nombre: e.nombre, tema: e.tema })), { id: 'all', nombre: 'Consolidado', tema: 'todas' }].map((c) => ({ ...c, s: resumen(c.id) }))
  const maxBruto = Math.max(1, ...tarjetas.map((t) => t.s.bruto))

  const bruto = (rs: Iniciativa[]) => { const a = ahorroDe(rs, mesesDe); return a.R + a.G }
  const porModulo = (empresaId: string, modulo?: string) => bruto(iniciativas.filter((i) => (empresaId === 'all' || i.empresa_id === empresaId) && (!modulo || i.modulo === modulo)))
  const modulos = MODULOS_AHORRO.filter(([m]) => porModulo('all', m) > 0 || ['Telecom', 'Flotas', 'Software'].includes(m))
  const maxModulo = Math.max(1, ...modulos.map(([m]) => porModulo('all', m)))

  const palancas = [...new Set(S.rs.filter((i) => cuenta(i.estado)).map((i) => i.palanca))]
    .map((p) => ({ p, v: bruto(S.rs.filter((i) => i.palanca === p)) })).sort((a, b) => b.v - a.v)
  const maxPalanca = Math.max(1, ...palancas.map((x) => x.v))

  // Cascada: del presupuesto vigente a la proyección de cierre.
  const proyeccion = S.vigente - S.neto
  const pasos = [
    { label: 'Presupuesto vigente', valor: m2(S.vigente), base: 0, alto: S.vigente, color: 'var(--presupuesto)' },
    { label: 'Ahorros realizados', valor: `−${m2(S.R)}`, base: S.vigente - S.R, alto: S.R, color: 'var(--ahorro)' },
    { label: 'Ahorros en gestión', valor: `−${m2(S.G)}`, base: S.vigente - S.R - S.G, alto: S.G, color: 'var(--ahorro-suave)' },
    { label: 'Excesos', valor: `+${m2(S.excesos)}`, base: S.vigente - S.R - S.G, alto: S.excesos, color: 'var(--riesgo)' },
    { label: 'Proyección de cierre', valor: m2(proyeccion), base: 0, alto: proyeccion, color: 'var(--primario)' },
  ]
  // Eje truncado (como el diseño) para que las variaciones se vean junto a montos grandes.
  const piso = Math.max(0, Math.min(S.vigente - S.R - S.G, proyeccion) - 1.2 * Math.max(S.R + S.G + S.excesos, 1))
  const techo = Math.max(S.vigente, proyeccion, piso + 1)
  const escala = (v: number) => (Math.max(v, piso) - piso) / (techo - piso) * 220

  const filas = S.rs.slice().sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
  const totalAnual = filas.filter((i) => cuenta(i.estado)).reduce((a, i) => a + ahorroAnual(i), 0)
  const totalEj = S.bruto
  const bajas = iniciativas.filter((i) => !i.activo && (todas || i.empresa_id === co))
  const periodo = todas
    ? `Consolidado · ${empresas.map((e) => { const ms = mesesDe(e.id); return `${e.nombre} ${etiquetaMes(ms[0])} ${ms[0].anio} – ${etiquetaMes(ms[11])} ${ms[11].anio}` }).join(' · ')}`
    : (() => { const ms = mesesDe(co); return `${emp?.nombre ?? ''} · Ejercicio ${etiquetaMes(ms[0])} ${ms[0].anio} – ${etiquetaMes(ms[11])} ${ms[11].anio}` })()

  async function darDeBaja(i: Iniciativa) {
    const motivo = window.prompt(`Motivo de la baja de ${i.codigo} (se conserva en el historial; si no prosperó, márquela «Descartada»):`)
    if (!motivo?.trim()) return
    const { error } = await supabase.from('iniciativas_ahorro').update({ activo: false, baja_motivo: motivo.trim() }).eq('id', i.id)
    if (error) setError(await mensajeError(error)); else { setMsg('Iniciativa dada de baja; se conserva en el historial.'); cargar() }
  }
  async function reactivar(i: Iniciativa) {
    const { error } = await supabase.from('iniciativas_ahorro').update({ activo: true }).eq('id', i.id)
    if (error) setError(await mensajeError(error)); else { setMsg(`${i.codigo} reactivada.`); cargar() }
  }

  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo="Ahorros" titulo="Ahorros generados vs. presupuesto" empresas={empresas} co={co} elegir={elegir} ir={ir}
        subtitulo={<>{periodo} · Corte {fechaCorta(hoy)} · {moneda} millones · Vista: <b>ejecución + proyección</b></>}
        crear={puedeEscribir && !formulario ? { texto: 'Registrar iniciativa', onClick: () => { setMsg(''); setError(''); setFormulario({ fila: null }) } } : undefined} />
      <Mensajes msg={msg} error={error} />

      {formulario && (
        <Formulario key={formulario.fila?.id ?? 'nueva'} m={MODULOS.iniciativas} empresa={formulario.fila?.empresa_id ?? co} fila={formulario.fila}
          titulo={formulario.fila ? `Editar ${formulario.fila.codigo} · ${formulario.fila.nombre}` : `Registrar iniciativa · ${emp?.nombre ?? ''}`}
          onGuardado={(t) => { setMsg(t); setFormulario(null); cargar() }} onCancelar={() => setFormulario(null)} />
      )}

      <section aria-labelledby="h-emp" style={tarjeta}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 id="h-emp" style={h2}>Ahorro por empresa y consolidado</h2>
          <span style={tenue}>Clic en una tarjeta para cambiar de ambiente</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {tarjetas.map((t) => (
            <button key={t.id} data-tema={t.tema} onClick={() => elegir(t.id)} aria-pressed={co === t.id}
              style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 12, border: co === t.id ? '2px solid var(--boton-activo)' : '1px solid var(--borde)', background: '#FFFFFF', color: 'var(--tinta)', textAlign: 'left', fontWeight: 400 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}><b>{t.nombre}</b><span className="mono" style={tenue}>Vigente {m2(t.s.vigente)}</span></span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="mono" style={{ fontSize: 26, fontWeight: 600, color: 'var(--ahorro-tinta)' }}>{m2(t.s.neto)}</span>
                <span style={tenue}>neto · {t.s.vigente ? `${((t.s.neto / t.s.vigente) * 100).toFixed(1)} %` : '—'} del vigente</span>
              </span>
              <span style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--pista)' }}>
                <span style={{ width: `${(t.s.R / maxBruto) * 100}%`, background: 'var(--ahorro)' }} />
                <span style={{ width: `${(t.s.G / maxBruto) * 100}%`, background: 'var(--ahorro-suave)' }} />
              </span>
              <span style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, fontSize: 12 }}>
                {([['Realizado', m2(t.s.R)], ['En gestión', m2(t.s.G)], ['Bruto', m2(t.s.bruto)], ['Excesos', `(${m2(t.s.excesos)})`]] as const).map(([l, v]) => (
                  <span key={l} style={{ display: 'flex', flexDirection: 'column' }}><span style={{ color: 'var(--tenue)' }}>{l}</span><span className="mono" style={{ fontWeight: 600, color: l === 'Excesos' ? 'var(--riesgo)' : undefined }}>{v}</span></span>
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="h-mod" style={tarjeta}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 id="h-mod" style={h2}>Ahorro bruto por módulo y empresa</h2>
          <span style={tenue}>{moneda} M en el ejercicio · realizado + en gestión</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Módulo</th>{empresas.map((e) => <th key={e.id} style={der}>{e.nombre}</th>)}<th style={der}>Consolidado</th><th>Participación</th></tr></thead>
            <tbody>
              {modulos.map(([m, nombre]) => (
                <tr key={m}>
                  <td>{nombre}</td>
                  {empresas.map((e) => <td key={e.id} className="num">{m2(porModulo(e.id, m))}</td>)}
                  <td className="num" style={{ fontWeight: 600 }}>{m2(porModulo('all', m))}</td>
                  <td style={{ minWidth: 160 }}><span style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--pista)' }}>
                    {empresas.map((e) => <span key={e.id} data-tema={e.tema} style={{ width: `${(porModulo(e.id, m) / maxModulo) * 100}%`, background: 'var(--primario2)' }} />)}
                  </span></td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>Total bruto</td>{empresas.map((e) => <td key={e.id} className="num">{m2(porModulo(e.id))}</td>)}<td className="num">{m2(porModulo('all'))}</td><td /></tr>
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <section aria-labelledby="h-wf" style={{ ...tarjeta, flex: '2 1 520px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-wf" style={h2}>Del presupuesto vigente a la proyección de cierre · {todas ? 'Consolidado' : emp?.nombre}</h2>
            <span style={tenue}>{moneda} M · eje truncado en {m2(piso)} para mostrar las variaciones</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, alignItems: 'end', height: 280 }}>
            {pasos.map((p) => (
              <div key={p.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{p.valor}</span>
                <div style={{ position: 'relative', width: '70%', height: 220 }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: escala(p.base), height: Math.max(3, escala(p.base + p.alto) - escala(p.base)), background: p.color, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--tenue)', textAlign: 'center' }}>{p.label}</span>
              </div>
            ))}
          </div>
          {!S.vigente && <span className="nota">Sin versión vigente: el presupuesto y los excesos salen de la versión «Vigente» de cada empresa.</span>}
        </section>
        <section aria-labelledby="h-pal" style={{ ...tarjeta, flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-pal" style={h2}>Ahorro por palanca</h2>
            <span style={tenue}>En el ejercicio · {moneda} M · {todas ? 'Consolidado' : emp?.nombre}</span>
          </div>
          {palancas.map((x) => <Barra key={x.p} nombre={x.p} detalle={`${S.rs.filter((i) => i.palanca === x.p && cuenta(i.estado)).length} iniciativas`} valor={m2(x.v)} ancho={(x.v / maxPalanca) * 100} />)}
          {palancas.length === 0 && <span style={tenue}>Sin iniciativas registradas.</span>}
        </section>
      </div>

      <section aria-labelledby="h-ini" style={tarjeta}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 id="h-ini" style={h2}>Iniciativas de ahorro · {todas ? 'Consolidado' : emp?.nombre}</h2>
          <span style={tenue}>Línea base y costo nuevo anualizados · ahorro del ejercicio prorrateado desde la fecha efectiva · {moneda}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 1250 }}>
            <thead><tr><th>ID</th><th>Empresa</th><th>Iniciativa</th><th>Módulo</th><th>Palanca</th><th style={der}>Línea base</th><th style={der}>Costo nuevo</th><th style={der}>Ahorro anual</th><th style={der}>En ejercicio</th><th>Efectiva</th><th>Estado</th><th>Evidencia</th><th></th></tr></thead>
            <tbody>
              {filas.map((i) => (
                <tr key={i.id} style={{ opacity: i.estado === 'Descartada' ? 0.55 : 1 }}>
                  <td className="mono">{i.codigo}</td><td>{nombreEmpresa(i.empresa_id)}</td><td style={{ fontWeight: 600 }}>{i.nombre}</td><td>{i.modulo}</td><td style={{ color: 'var(--tenue)' }}>{i.palanca}</td>
                  <td className="num">{dinero(Number(i.linea_base))}</td><td className="num">{dinero(Number(i.costo_nuevo))}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{dinero(ahorroAnual(i))}</td><td className="num">{cuenta(i.estado) ? dinero(ej(i)) : '—'}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fechaCorta(i.fecha_efectiva)}</td>
                  <td><span style={pastilla(TONO[i.estado] ?? TONO.Propuesta)}>{i.estado}</span></td>
                  <td style={{ color: 'var(--tenue)' }}>{i.evidencia}</td>
                  <td className="acciones">
                    {puedeEscribir && <button className="secundario" onClick={() => { setMsg(''); setFormulario({ fila: i }) }}>Editar</button>}
                    {esAdmin && <button className="secundario" onClick={() => darDeBaja(i)}>Dar de baja</button>}
                  </td>
                </tr>
              ))}
              {filas.length > 0 && <tr style={{ fontWeight: 700 }}><td /><td /><td>Total (sin descartadas)</td><td /><td /><td /><td /><td className="num">{dinero(totalAnual)}</td><td className="num">{dinero(totalEj)}</td><td /><td /><td /><td /></tr>}
              {filas.length === 0 && <tr><td colSpan={13} style={tenue}>Todavía no hay iniciativas. Regístrelas con «Registrar iniciativa».</td></tr>}
            </tbody>
          </table>
        </div>
        {esAdmin && <DadosDeBaja filas={bajas} nombre={(i) => `${i.codigo} · ${i.nombre} · ${nombreEmpresa(i.empresa_id)}`} reactivar={reactivar} />}
      </section>

      <section aria-labelledby="h-met" style={tarjeta}>
        <h2 id="h-met" style={h2}>Cómo se reconoce un ahorro</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 13 }}>
          {[
            ['Línea base', 'Costo contratado o tarifa presupuestada para el mismo alcance (servicio, cantidad, período), anualizado.'],
            ['Realizado', 'Diferencia ya reflejada en factura o contrato firmado, con evidencia anotada. Estado «Realizado».'],
            ['En gestión', 'Propuesta, en validación, en trámite o en negociación. Entra en la proyección, no en el realizado. «Descartada» no cuenta.'],
            ['Consolidado', 'Suma de las empresas; cada una conserva su ejercicio fiscal y su moneda de reporte.'],
          ].map(([t, d]) => <div key={t} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><b>{t}</b><span style={{ color: 'var(--tenue)' }}>{d}</span></div>)}
        </div>
        <div className="mono" style={{ fontSize: 13, padding: '10px 12px', background: 'var(--suave)', borderRadius: 8 }}>
          Proyección de cierre = vigente {m2(S.vigente)} − realizado {m2(S.R)} − en gestión {m2(S.G)} + excesos {m2(S.excesos)} = {m2(proyeccion)} M
        </div>
      </section>
    </div>
  )
}
