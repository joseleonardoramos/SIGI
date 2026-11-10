import { useEffect, useState, type CSSProperties } from 'react'
import { supabase, mensajeError, leerTodo, fechaLocal } from './supabase'
import { Formulario, type Fila } from './Catalogo'
import { MODULOS } from './modulos'
import { fechaCorta, sumarDias } from './comun'
import { Cabecera, Indicadores, Mensajes, botonAcento, botonBorde, h2, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Personal y ausencias, reconstruida a partir de design/Personal.dc.html con datos reales.
// Las ausencias no se traslapan (lo valida la base); cancelar marca la ausencia y la conserva.

type Persona = Fila & { empresa_id: string; nombre: string; cargo: string | null; area_id: string | null; areas: { nombre: string } | null }
type Ausencia = Fila & { empresa_id: string; persona_id: string; tipo: string; desde: string; hasta: string; cobertura: string | null; nota: string | null; cancelada: boolean }
type Evento = { id: number; tabla: string; accion: string; antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; ocurrido_en: string }

const TONO: Record<string, [string, string]> = {
  'En curso': ['#FFF4D6', '#6B4A00'], 'Programada': ['#E6EEF7', '#1D3557'], 'Finalizada': ['#EEF1F4', '#3E4A58'], 'Cancelada': ['#FBE9DF', '#8A3A12'],
}
const ACTIVO: [string, string] = ['#E7F5EF', '#075B3F']
const INACTIVO: [string, string] = ['#EEF1F4', '#3E4A58']
const celda: CSSProperties = { whiteSpace: 'nowrap' }

// Hábil: de lunes a viernes y no feriado (fechas AAAA-MM-DD del catálogo de feriados).
const esHabil = (f: string, feriados: Set<string>) => { const d = new Date(`${f}T12:00:00Z`).getUTCDay(); return d !== 0 && d !== 6 && !feriados.has(f) }
// Días hábiles entre dos fechas, ambas incluidas.
export function diasHabiles(desde: string, hasta: string, feriados: Set<string>): number {
  let n = 0
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) if (esHabil(f, feriados)) n++
  return n
}
// Primer día hábil después del fin de la ausencia.
export function regreso(hasta: string, feriados: Set<string>): string {
  let f = sumarDias(hasta, 1)
  while (!esHabil(f, feriados)) f = sumarDias(f, 1)
  return f
}
export const estadoAusencia = (a: Pick<Ausencia, 'cancelada' | 'desde' | 'hasta'>, hoy: string) =>
  a.cancelada ? 'Cancelada' : a.hasta < hoy ? 'Finalizada' : a.desde <= hoy ? 'En curso' : 'Programada'

// Qué pasó en un evento de la bitácora, en palabras.
export function describir(e: Pick<Evento, 'tabla' | 'accion' | 'antes' | 'despues'>): string {
  const persona = e.tabla === 'personas'
  if (e.accion === 'INSERT') return persona ? 'Alta de persona' : 'Registro de ausencia'
  if (e.antes?.activo === true && e.despues?.activo === false) return persona ? 'Baja de persona' : 'Baja de ausencia'
  if (e.antes?.activo === false && e.despues?.activo === true) return persona ? 'Reactivación de persona' : 'Reactivación de ausencia'
  if (!persona && e.antes?.cancelada === false && e.despues?.cancelada === true) return 'Cancelación de ausencia'
  return persona ? 'Edición de persona' : 'Edición de ausencia'
}

export default function Personal({ empresas, empresa, setEmpresa, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [personas, setPersonas] = useState<Persona[]>([])
  const [ausencias, setAusencias] = useState<Ausencia[]>([])
  const [eventos, setEventos] = useState<Evento[]>([])
  const [feriados, setFeriados] = useState<Set<string>>(new Set())
  const [formulario, setFormulario] = useState<{ que: 'ausencia' | 'persona'; fila: Persona | null } | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const todas = co === 'all'
  const hoy = fechaLocal()
  useEffect(() => { if (empresa && co !== 'all') setCo(empresa) }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    const de = <T,>(tabla: string, columnas: string) => leerTodo<T>((d, h) => {
      let q = supabase.from(tabla).select(columnas)
      if (!todas) q = q.eq('empresa_id', co)
      return q.order('id').range(d, h)
    })
    let qb = supabase.from('bitacora').select('id, tabla, accion, antes, despues, ocurrido_en').in('tabla', ['personas', 'ausencias']).order('ocurrido_en', { ascending: false }).limit(15)
    if (!todas) qb = qb.eq('empresa_id', co)
    const [p, a, b, fe] = await Promise.all([
      de<Persona>('personas', '*, areas!personas_area_id_empresa_id_fkey(nombre)'),
      de<Ausencia>('ausencias', '*'),
      qb,
      leerTodo<{ fecha: string }>((d, h) => supabase.from('feriados').select('fecha').eq('activo', true).order('fecha').range(d, h)),
    ])
    const fallo = p.error ?? a.error ?? b.error ?? fe.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    setFeriados(new Set(fe.data.map((x) => x.fecha)))
    setPersonas(p.data)
    setAusencias(a.data.filter((x) => x.activo))
    setEventos((b.data ?? []) as Evento[])
  }
  useEffect(() => { cargar() }, [co]) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: string) => { setCo(id); setFormulario(null); setMsg(''); if (id !== 'all') setEmpresa(id) }
  const emp = empresas.find((e) => e.id === co)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const persona = (id: string) => personas.find((p) => p.id === id)
  const abrir = (que: 'ausencia' | 'persona', fila: Persona | null = null) => { setMsg(''); setError(''); setFormulario({ que, fila }) }
  const guardado = (texto: string) => { setMsg(texto); setFormulario(null); cargar() }

  async function actualizar(tabla: string, id: string, cambios: Record<string, unknown>, ok: string) {
    setError('')
    const { error } = await supabase.from(tabla).update(cambios).eq('id', id)
    if (error) setError(await mensajeError(error))
    else { setMsg(ok); cargar() }
  }
  function cancelar(a: Ausencia) {
    if (!window.confirm('¿Cancelar esta ausencia? Se conserva en el historial y deja de contar.')) return
    actualizar('ausencias', a.id, { cancelada: true }, 'Ausencia cancelada; queda en el historial.')
  }
  function cambiarPersona(p: Persona) {
    if (!p.activo) { actualizar('personas', p.id, { activo: true }, 'Persona reactivada.'); return }
    const motivo = window.prompt(`Motivo de la baja de ${p.nombre} (su historial se conserva):`)
    if (motivo?.trim()) actualizar('personas', p.id, { activo: false, baja_motivo: motivo.trim() }, 'Persona dada de baja; su historial se conserva.')
  }

  const conEstado = ausencias.map((a) => ({ a, est: estadoAusencia(a, hoy), p: persona(a.persona_id) }))
  const enCurso = conEstado.filter((x) => x.est === 'En curso')
  const proximas = conEstado.filter((x) => x.est === 'Programada' && x.a.desde <= sumarDias(hoy, 30)).sort((x, y) => x.a.desde.localeCompare(y.a.desde))
  const activas = personas.filter((p) => p.activo)
  const kpis = [
    { label: 'Fuera hoy', value: String(enCurso.length), sub: enCurso.length ? enCurso.map((x) => x.p?.nombre).join(', ') : 'Nadie', color: enCurso.length ? undefined : 'var(--tenue)' },
    { label: 'Próximos 30 días', value: String(proximas.length), sub: 'Ausencias programadas' },
    { label: 'Personas activas', value: String(activas.length), sub: `Registradas en ${todas ? 'todas las empresas' : emp?.nombre ?? ''}` },
    { label: 'Ausencias registradas', value: String(ausencias.length), sub: 'Incluye canceladas y finalizadas' },
  ]
  // La ausencia nueva no lleva la casilla «Cancelada»: se cancela después, desde la lista.
  const moduloAusencia = { ...MODULOS.ausencias, campos: MODULOS.ausencias.campos.filter((c) => c.k !== 'cancelada') }

  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo={`Personal y ausencias · Hoy ${fechaCorta(hoy)}`} titulo="Personal y ausencias" empresas={empresas} co={co} elegir={elegir} ir={ir}
        subtitulo="Quién está de vacaciones, permiso o incapacidad, y cuándo regresa. Nada se borra: las cancelaciones y bajas quedan en la bitácora." />
      <Mensajes msg={msg} error={error} />

      <Indicadores etiqueta="Indicadores de personal" kpis={kpis} />

      <section aria-labelledby="h-fuera" style={tarjeta}>
        <h2 id="h-fuera" style={h2}>Fuera hoy y próximas ausencias</h2>
        {[...enCurso, ...proximas].map(({ a, est, p }) => (
          <div key={a.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--pista)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', flex: '1 1 240px' }}>
              <b>{p?.nombre}</b>
              <span style={{ fontSize: 12, color: 'var(--tenue)' }}>{[p?.cargo, nombreEmpresa(a.empresa_id), p?.areas?.nombre].filter(Boolean).join(' · ')}</span>
            </span>
            <span style={{ fontSize: 14 }}>{a.tipo}</span>
            <span className="mono" style={{ fontSize: 13 }}>{fechaCorta(a.desde)} → {fechaCorta(a.hasta)} · regresa {fechaCorta(regreso(a.hasta, feriados))}</span>
            <span style={pastilla(TONO[est])}>{est}</span>
          </div>
        ))}
        {enCurso.length + proximas.length === 0 && <p style={{ ...tenue, margin: 0 }}>Nadie está fuera hoy ni tiene ausencias en los próximos 30 días.</p>}
      </section>

      {formulario ? (
        formulario.que === 'ausencia'
          ? <Formulario m={moduloAusencia} empresa={co} fila={null} titulo={`Registrar ausencia · ${emp?.nombre ?? ''}`} onGuardado={guardado} onCancelar={() => setFormulario(null)} />
          : <Formulario key={formulario.fila?.id ?? 'nueva'} m={MODULOS.personas} empresa={formulario.fila?.empresa_id ?? co} fila={formulario.fila}
              titulo={formulario.fila ? `Editar ${formulario.fila.nombre}` : `Agregar persona · ${emp?.nombre ?? ''}`} onGuardado={guardado} onCancelar={() => setFormulario(null)} />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button style={{ ...botonAcento, height: 44 }} disabled={todas} onClick={() => abrir('ausencia')}>Registrar ausencia</button>
          <button style={{ ...botonBorde, height: 44, fontWeight: 600 }} disabled={todas} onClick={() => abrir('persona')}>Agregar persona</button>
          {todas && <span className="nota">Para registrar, elija primero la empresa.</span>}
        </div>
      )}

      <section aria-labelledby="h-pers" style={tarjeta}>
        <h2 id="h-pers" style={h2}>Personal</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Nombre</th><th>Cargo</th><th>Empresa</th><th>Área</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {[...personas].sort((x, y) => Number(y.activo) - Number(x.activo) || x.nombre.localeCompare(y.nombre, 'es')).map((p) => (
                <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                  <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                  <td>{p.cargo}</td>
                  <td>{nombreEmpresa(p.empresa_id)}</td>
                  <td>{p.areas?.nombre}</td>
                  <td><span style={pastilla(p.activo ? ACTIVO : INACTIVO)}>{p.activo ? 'Activo' : 'Inactivo'}</span>{!p.activo && p.baja_motivo && <span className="nota"> {p.baja_motivo}</span>}</td>
                  <td className="acciones">
                    {p.activo && <button className="secundario" onClick={() => abrir('persona', p)}>Editar</button>}
                    {esAdmin && <button className="secundario" onClick={() => cambiarPersona(p)}>{p.activo ? 'Dar de baja' : 'Reactivar'}</button>}
                  </td>
                </tr>
              ))}
              {personas.length === 0 && <tr><td colSpan={6} style={tenue}>Todavía no hay personas registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="h-aus" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2 id="h-aus" style={h2}>Todas las ausencias</h2>
          <span className="mono" style={tenue}>{ausencias.length} ausencias · {enCurso.length} en curso · {conEstado.filter((x) => x.est === 'Programada').length} programadas</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Persona</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th className="num">Días hábiles</th><th>Cubre</th><th>Nota</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {[...conEstado].sort((x, y) => y.a.desde.localeCompare(x.a.desde)).map(({ a, est, p }) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{p?.nombre}</td>
                  <td>{a.tipo}</td>
                  <td className="mono" style={celda}>{fechaCorta(a.desde)}</td>
                  <td className="mono" style={celda}>{fechaCorta(a.hasta)}</td>
                  <td className="num">{diasHabiles(a.desde, a.hasta, feriados)}</td>
                  <td>{a.cobertura}</td>
                  <td style={{ color: 'var(--tenue)' }}>{a.nota}</td>
                  <td><span style={pastilla(TONO[est])}>{est}</span></td>
                  <td className="acciones">{(est === 'Programada' || est === 'En curso') && <button className="secundario" onClick={() => cancelar(a)}>Cancelar</button>}</td>
                </tr>
              ))}
              {ausencias.length === 0 && <tr><td colSpan={9} style={tenue}>Todavía no hay ausencias registradas.</td></tr>}
            </tbody>
          </table>
        </div>
        <span style={{ fontSize: 12, color: 'var(--tenue)' }}>Días hábiles: de lunes a viernes, sin contar los feriados registrados en Catálogos → Feriados{feriados.size ? '' : ' (todavía no hay ninguno)'}.</span>
      </section>

      <section aria-labelledby="h-bit" style={{ ...tarjeta, gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2 id="h-bit" style={h2}>Bitácora de esta pantalla</h2>
          <button className="enlace" onClick={() => ir('bitacora')} style={{ color: 'var(--enlace)', fontSize: 13, fontWeight: 600 }}>Ver la bitácora completa →</button>
        </div>
        {eventos.map((e) => {
          const datos = e.despues ?? e.antes ?? {}
          const quien = e.tabla === 'personas' ? String(datos.nombre ?? '') : persona(String(datos.persona_id ?? ''))?.nombre ?? ''
          const detalle = e.tabla === 'personas' ? quien : `${quien} · ${datos.tipo ?? ''} ${datos.desde ?? ''} → ${datos.hasta ?? ''}`
          return (
            <div key={e.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--pista)' }}>
              <span className="mono" style={{ color: 'var(--tenue)', minWidth: 150 }}>{new Date(e.ocurrido_en).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <b style={{ minWidth: 190 }}>{describir(e)}</b>
              <span>{detalle}</span>
            </div>
          )
        })}
        {eventos.length === 0 && <p style={{ ...tenue, margin: 0 }}>Sin movimientos todavía.</p>}
      </section>
    </div>
  )
}
