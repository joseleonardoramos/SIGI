import { Fragment, useEffect, useState, type CSSProperties } from 'react'
import { supabase, mensajeError, leerTodo } from './supabase'
import { Formulario, type Fila, type Modulo } from './Catalogo'
import { MODULOS } from './modulos'
import { Cabecera, DadosDeBaja, Mensajes, botonAcento, control, etiqueta, h2, Multi, pasa, pastilla, tarjeta, tenue, type Empresa } from './diseno'

// Proveedores y cuentas contables, reconstruida a partir de design/Catalogos.dc.html con datos reales.
// Reúne el catálogo contable de cada empresa, el maestro de proveedores (común) y sus cuentas por empresa.
// Solo el Administrador crea y edita; los demás consultan.

type Cuenta = Fila & { empresa_id: string; codigo: string; descripcion: string; tipo: string; categoria: string; estado: string; centro_costo_codigo: string | null }
type Centro = { empresa_id: string; codigo: string; nombre: string }
type Proveedor = Fila & { nombre: string; rnc: string | null; categorias: string[] }
type CuentaProveedor = Fila & { empresa_id: string; proveedor_id: string; numero: string; descripcion: string | null; moneda: string }

const ESTADO: Record<string, [string, string]> = { Activa: ['#E7F5EF', '#075B3F'], Nueva: ['#E6EEF7', '#1D3557'], Inactiva: ['#EEF1F4', '#3E4A58'] }
const celda: CSSProperties = { whiteSpace: 'nowrap' }

// Estructura empresa-centro de costo-concepto (11-112-63-0110): concepto 63-0110, centro 112.
// Otros formatos (Bona: 6210-050) son su propio concepto y toman el centro del campo.
export function partes(c: Pick<Cuenta, 'codigo' | 'centro_costo_codigo'>): { concepto: string; centro: string } {
  const m = c.codigo.trim().match(/^\d{2}-(\d{3})-(\d{2}-\d{4})$/)
  return m ? { concepto: m[2], centro: c.centro_costo_codigo || m[1] } : { concepto: c.codigo.trim(), centro: c.centro_costo_codigo ?? '' }
}

export default function ProveedoresCuentas({ empresas, empresa, setEmpresa, esAdmin, ir }: {
  empresas: Empresa[]
  empresa: string
  setEmpresa: (id: string) => void
  esAdmin: boolean
  ir: (vista: string) => void
}) {
  const [co, setCo] = useState(empresa) // 'all' = consolidado
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [centros, setCentros] = useState<Centro[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [cuentasProv, setCuentasProv] = useState<CuentaProveedor[]>([])
  const [catalogo, setCatalogo] = useState(empresa) // empresa del catálogo contable que se muestra
  const [estadoF, setEstadoF] = useState('')
  const [gq, setGq] = useState('')
  const [conceptoF, setConceptoF] = useState<string[]>([])
  const [vista, setVista] = useState<'lista' | 'matriz'>('lista')
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [categoriaF, setCategoriaF] = useState<string[]>([])
  const [elegido, setElegido] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<{ m: Modulo; fila: Fila | null; empresa: string; titulo: string; donde: 'cuentas' | 'proveedores' } | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const todas = co === 'all'
  useEffect(() => { if (empresa && co !== 'all') { setCo(empresa); setCatalogo(empresa) } }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    const de = <T,>(tabla: string, columnas: string, activos = false) => leerTodo<T>((d, h) => {
      let q = supabase.from(tabla).select(columnas)
      if (activos) q = q.eq('activo', true)
      if (!todas && tabla !== 'proveedores') q = q.eq('empresa_id', co)
      return q.order('id').range(d, h)
    })
    const [c, cc, p, cp] = await Promise.all([
      de<Cuenta>('cuentas_contables', '*'),
      de<Centro>('centros_costo', 'empresa_id, codigo, nombre', true),
      de<Proveedor>('proveedores', '*'),
      de<CuentaProveedor>('cuentas_proveedor', '*'),
    ])
    const fallo = c.error ?? cc.error ?? p.error ?? cp.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    setCuentas(c.data)
    setCentros(cc.data)
    setProveedores(p.data)
    setCuentasProv(cp.data)
  }
  useEffect(() => { cargar() }, [co]) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: string) => {
    setCo(id); setFormulario(null); setMsg(''); setAbiertos(new Set())
    if (id !== 'all') { setEmpresa(id); setCatalogo(id) } else if (!empresas.some((e) => e.id === catalogo)) setCatalogo(empresas[0]?.id ?? '')
  }
  const emp = empresas.find((e) => e.id === co)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const visibles = todas ? empresas : emp ? [emp] : []
  const abrir = (donde: 'cuentas' | 'proveedores', m: Modulo, fila: Fila | null, empresaForm: string, titulo: string) => {
    setMsg(''); setError(''); setFormulario({ m, fila, empresa: empresaForm, titulo, donde })
  }
  const guardado = (texto: string) => { setMsg(texto); setFormulario(null); cargar() }

  async function cambiarEstado(tabla: string, f: Fila, nombre: string) {
    setError('')
    let cambios: Record<string, unknown> = { activo: true }
    if (f.activo) {
      const motivo = window.prompt(`Motivo de la baja de ${nombre} (se conserva en el historial):`)
      if (!motivo?.trim()) return
      cambios = { activo: false, baja_motivo: motivo.trim() }
    }
    const { error } = await supabase.from(tabla).update(cambios).eq('id', f.id)
    if (error) setError(await mensajeError(error))
    else { setMsg(f.activo ? 'Dado de baja; se conserva en el historial.' : 'Reactivado.'); cargar() }
  }

  // ===== Catálogo contable de la empresa elegida =====
  const delCatalogo = cuentas.filter((c) => c.activo && c.empresa_id === catalogo)
  const centrosDe = centros.filter((c) => c.empresa_id === catalogo)
  const nombreCentro = (codigo: string) => centrosDe.find((c) => c.codigo === codigo)?.nombre ?? ''
  const conceptos = [...new Set(delCatalogo.map((c) => partes(c).concepto))].sort()
  const termino = gq.trim().toLowerCase()
  const filtradas = delCatalogo.filter((c) => (!estadoF || c.estado === estadoF) && pasa(conceptoF, partes(c).concepto) &&
    (!termino || [c.codigo, c.descripcion, c.categoria, partes(c).centro, nombreCentro(partes(c).centro)].join(' ').toLowerCase().includes(termino)))
  const grupos = conceptos.map((concepto) => {
    const todasDelConcepto = delCatalogo.filter((c) => partes(c).concepto === concepto)
    const filas = filtradas.filter((c) => partes(c).concepto === concepto).sort((a, b) => a.codigo.localeCompare(b.codigo))
    const categorias = [...new Set(todasDelConcepto.map((c) => c.categoria))]
    const inactivas = todasDelConcepto.filter((c) => c.estado === 'Inactiva').length
    const nuevas = todasDelConcepto.filter((c) => c.estado === 'Nueva').length
    return { concepto, filas, total: todasDelConcepto.length, categorias, tipo: todasDelConcepto[0]?.tipo ?? '', inactivas, nuevas }
  }).filter((g) => g.filas.length > 0)
  const codigosCentro = [...new Set([...centrosDe.map((c) => c.codigo), ...delCatalogo.map((c) => partes(c).centro).filter(Boolean)])].sort()
  const cuenta = (centro: string, concepto: string) => delCatalogo.find((c) => partes(c).centro === centro && partes(c).concepto === concepto)
  const huecos = codigosCentro.reduce((a, cc) => a + conceptos.filter((k) => !cuenta(cc, k)).length, 0)
  const contar = (e: string) => delCatalogo.filter((c) => c.estado === e).length
  const indicadores: [string, string, number, string][] = [['', 'Cuentas', delCatalogo.length, 'var(--tinta)'], ['Activa', 'Activas', contar('Activa'), '#075B3F'], ['Nueva', 'Nuevas', contar('Nueva'), '#1D3557'], ['Inactiva', 'Inactivas', contar('Inactiva'), '#3E4A58']]

  // ===== Maestro de proveedores =====
  const cuentasDe = (p: Proveedor, empresaId: string) => cuentasProv.filter((c) => c.activo && c.proveedor_id === p.id && c.empresa_id === empresaId)
  const categoriasProv = [...new Set(proveedores.flatMap((p) => p.categorias ?? []))].sort((a, b) => a.localeCompare(b, 'es'))
  const tq = q.trim().toLowerCase()
  const listaProv = proveedores.filter((p) => (p.activo || esAdmin) && (!categoriaF.length || (p.categorias ?? []).some((c) => categoriaF.includes(c))) &&
    (!tq || [p.nombre, p.rnc, ...(p.categorias ?? []), ...cuentasProv.filter((c) => c.proveedor_id === p.id).map((c) => c.numero)].join(' ').toLowerCase().includes(tq)))
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'))
  const sel = proveedores.find((p) => p.id === elegido) ?? listaProv[0]
  const moduloCuentaProv = (proveedorId: string) => ({ ...MODULOS.cuentas_proveedor, campos: MODULOS.cuentas_proveedor.campos.map((c) => (c.k === 'proveedor_id' ? { ...c, defecto: proveedorId } : c)) })

  const formAqui = (donde: 'cuentas' | 'proveedores') => formulario?.donde === donde && (
    <Formulario key={`${formulario.titulo}-${formulario.fila?.id ?? 'nuevo'}`} m={formulario.m} empresa={formulario.empresa} fila={formulario.fila}
      titulo={formulario.titulo} onGuardado={guardado} onCancelar={() => setFormulario(null)} />
  )

  return (
    <div data-tema={todas ? 'todas' : emp?.tema ?? 'catador'} style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--tinta)' }}>
      <Cabecera modulo="Proveedores y cuentas" titulo="Proveedores y cuentas contables" empresas={empresas} co={co} elegir={elegir} ir={ir}
        subtitulo="Maestro único de proveedores para todas las empresas · Cuentas de proveedor y catálogo contable propios de cada empresa" />
      <Mensajes msg={msg} error={error} />

      <section aria-labelledby="h-gl" style={tarjeta}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="h-gl" style={h2}>Catálogo de cuentas contables · {nombreEmpresa(catalogo)}</h2>
            <span style={tenue}>{delCatalogo.length} cuentas en {conceptos.length} conceptos · {codigosCentro.length} centros de costo</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {visibles.length > 1 && (
              <div role="group" aria-label="Catálogo de la empresa" style={{ display: 'flex', border: '1px solid var(--borde)', borderRadius: 8, overflow: 'hidden' }}>
                {visibles.map((e) => (
                  <button key={e.id} aria-pressed={catalogo === e.id} onClick={() => { setCatalogo(e.id); setAbiertos(new Set()); setConceptoF([]) }}
                    style={{ height: 40, padding: '0 14px', border: 'none', borderRadius: 0, fontSize: 13, fontWeight: 600, background: catalogo === e.id ? 'var(--boton-activo)' : '#FFFFFF', color: catalogo === e.id ? '#FFFFFF' : 'var(--tinta)' }}>{e.nombre}</button>
                ))}
              </div>
            )}
            {esAdmin && formulario?.donde !== 'cuentas' && (
              <button style={botonAcento} disabled={!catalogo} onClick={() => abrir('cuentas', MODULOS.cuentas_contables, null, catalogo, `Nueva cuenta contable · ${nombreEmpresa(catalogo)}`)}>+ Nueva cuenta</button>
            )}
          </div>
        </div>
        {formAqui('cuentas')}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 14px', border: '1px solid var(--pista)', borderRadius: 10, background: 'var(--suave)', flex: '1 1 300px' }}>
            <b style={{ fontSize: 13 }}>Estructura</b>
            <span className="mono" style={{ fontSize: 18 }}><span style={{ color: 'var(--primario2)' }}>11</span>-<span style={{ color: 'var(--riesgo)' }}>112</span>-<span>63-0110</span></span>
            <span style={{ fontSize: 12, color: 'var(--tenue)' }}><b>11</b> empresa · <b>112</b> centro de costo · <b>63-0110</b> cuenta del concepto. Los códigos con otro formato son su propio concepto.</span>
          </div>
          {indicadores.map(([k, label, n, color]) => (
            <button key={label} onClick={() => setEstadoF(estadoF === k ? '' : k)} aria-pressed={estadoF === k && k !== ''}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 16px', borderRadius: 10, border: estadoF === k && k ? '2px solid var(--boton-activo)' : '1px solid var(--borde)', background: '#FFFFFF', color: 'var(--tinta)', textAlign: 'left', minWidth: 110, fontWeight: 400 }}>
              <span style={{ fontSize: 12, color: 'var(--tenue)', fontWeight: 600 }}>{label}</span><span className="mono" style={{ fontSize: 22, fontWeight: 600, color }}>{n}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label style={etiqueta}>Buscar<input type="search" value={gq} onChange={(e) => setGq(e.target.value)} placeholder="Cuenta, centro de costo…" style={{ ...control, width: 220 }} /></label>
            <Multi label="Concepto" opciones={conceptos} valor={conceptoF} cambiar={setConceptoF} todos="Todos" ancho={160} />
          </div>
          <div role="group" aria-label="Vista del catálogo" style={{ display: 'flex', border: '1px solid var(--borde)', borderRadius: 8, overflow: 'hidden' }}>
            {([['lista', 'Por concepto'], ['matriz', 'Matriz CC × concepto']] as const).map(([k, label]) => (
              <button key={k} aria-pressed={vista === k} onClick={() => setVista(k)}
                style={{ height: 40, padding: '0 14px', border: 'none', borderRadius: 0, fontSize: 13, fontWeight: 600, background: vista === k ? 'var(--boton-activo)' : '#FFFFFF', color: vista === k ? '#FFFFFF' : 'var(--tinta)' }}>{label}</button>
            ))}
          </div>
        </div>

        {vista === 'lista' ? (
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--pista)', borderRadius: 10, overflow: 'hidden' }}>
            {grupos.map((g) => {
              const abierto = abiertos.has(g.concepto) || !!termino || !!estadoF
              const marcas = [g.nuevas && `${g.nuevas} nuevas`, g.inactivas && `${g.inactivas} inactivas`].filter(Boolean).join(' · ')
              return (
                <Fragment key={g.concepto}>
                  <button aria-expanded={abierto} onClick={() => { const n = new Set(abiertos); if (n.has(g.concepto)) n.delete(g.concepto); else n.add(g.concepto); setAbiertos(n) }}
                    style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 14px', border: 'none', borderRadius: 0, borderTop: '1px solid var(--pista)', background: abierto ? 'var(--suave)' : '#FFFFFF', color: 'var(--tinta)', textAlign: 'left', fontWeight: 400 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="mono" aria-hidden="true" style={{ color: 'var(--tenue)' }}>{abierto ? '▾' : '▸'}</span>
                      <b>{g.categorias.join(' / ') || 'Sin categoría'}</b><span className="mono" style={{ fontSize: 13 }}>{g.concepto}</span>
                      <span style={{ ...pastilla(g.tipo === 'CAPEX' ? ['var(--primario2)', '#FFFFFF'] : ['var(--primario)', '#FFFFFF']), padding: '2px 7px', fontSize: 11 }}>{g.tipo}</span>
                    </span>
                    <span style={tenue}>{g.total} cuentas{marcas && ` · ${marcas}`}{g.filas.length !== g.total && ` · ${g.filas.length} coinciden`}</span>
                  </button>
                  {abierto && (
                    <div style={{ overflowX: 'auto', padding: '0 14px 12px', background: 'var(--suave)' }}>
                      <table style={{ background: '#FFFFFF', border: '1px solid var(--pista)' }}>
                        <thead><tr><th>Cuenta</th><th>CC</th><th>Centro de costo</th><th>Descripción en el catálogo</th><th>Categoría SIGI</th><th>Estado</th><th></th></tr></thead>
                        <tbody>
                          {g.filas.map((c) => (
                            <tr key={c.id}>
                              <td className="mono" style={{ ...celda, textDecoration: c.estado === 'Inactiva' ? 'line-through' : undefined }}>{c.codigo}</td>
                              <td className="mono">{partes(c).centro}</td>
                              <td>{nombreCentro(partes(c).centro) || <span className="nota">No está en Centros de costo</span>}</td>
                              <td>{c.descripcion}</td>
                              <td>{c.categoria}</td>
                              <td><span style={pastilla(ESTADO[c.estado] ?? ESTADO.Inactiva)}>{c.estado}</span></td>
                              <td className="acciones">{esAdmin && <>
                                <button className="secundario" onClick={() => abrir('cuentas', MODULOS.cuentas_contables, c, c.empresa_id, `Editar cuenta ${c.codigo}`)}>Editar</button>
                                <button className="secundario" onClick={() => cambiarEstado('cuentas_contables', c, c.codigo)}>Dar de baja</button>
                              </>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Fragment>
              )
            })}
            {grupos.length === 0 && <p style={{ ...tenue, margin: 0, padding: 16, textAlign: 'center' }}>{delCatalogo.length ? 'Ninguna cuenta coincide con los filtros.' : 'Esta empresa todavía no tiene cuentas contables. Regístrelas con «+ Nueva cuenta» o con Importar CSV.'}</p>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={tenue}>Matriz de imputación: qué cuenta existe para cada centro de costo. Un hueco (—) significa que un gasto de ese concepto no tiene dónde imputarse{huecos ? ` · ${huecos} huecos` : ''}.</span>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>CC</th><th>Centro de costo</th>{conceptos.map((k) => <th key={k} style={{ textAlign: 'center' }}><span className="mono">{k}</span></th>)}</tr></thead>
                <tbody>
                  {codigosCentro.map((cc) => (
                    <tr key={cc}>
                      <td className="mono">{cc}</td>
                      <td style={celda}>{nombreCentro(cc) || <span className="nota">No está en Centros de costo</span>}</td>
                      {conceptos.map((k) => {
                        const c = cuenta(cc, k)
                        return <td key={k} style={{ textAlign: 'center' }}>{c
                          ? <span title={c.codigo} style={{ ...pastilla(ESTADO[c.estado] ?? ESTADO.Inactiva), display: 'inline-block', minWidth: 72 }}>{c.estado}</span>
                          : <span title={`No existe cuenta de ${k} para el centro ${cc}`} style={{ color: 'var(--tenue)' }}>—</span>}</td>
                      })}
                    </tr>
                  ))}
                  {codigosCentro.length === 0 && <tr><td colSpan={2 + conceptos.length} style={tenue}>Sin centros de costo para esta empresa.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {esAdmin && <DadosDeBaja filas={cuentas.filter((c) => !c.activo && c.empresa_id === catalogo)} nombre={(c) => `${c.codigo} · ${c.descripcion}`} reactivar={(c) => cambiarEstado('cuentas_contables', c, c.codigo)} />}
        <span style={{ fontSize: 12, color: 'var(--tenue)' }}>Una cuenta nueva queda como «Nueva» hasta que Contabilidad la confirme; la bitácora guarda quién la creó y cuándo. Los centros de costo se mantienen en <button className="enlace" onClick={() => ir('centros_costo')} style={{ fontSize: 12 }}>Catálogos → Centros de costo</button>.</span>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section aria-labelledby="h-prov" style={{ ...tarjeta, flex: '2 1 620px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="h-prov" style={h2}>Maestro de proveedores</h2>
              <span style={tenue}>{listaProv.length} de {proveedores.length} proveedores</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
              <label style={etiqueta}>Buscar<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, RNC, cuenta…" style={{ ...control, width: 200 }} /></label>
              <Multi label="Categoría" opciones={categoriasProv} valor={categoriaF} cambiar={setCategoriaF} todos="Todas" ancho={150} />
              {esAdmin && formulario?.donde !== 'proveedores' && <button style={botonAcento} onClick={() => abrir('proveedores', MODULOS.proveedores, null, '', 'Nuevo proveedor')}>+ Nuevo proveedor</button>}
            </div>
          </div>
          {formAqui('proveedores')}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Proveedor</th><th>RNC</th><th>Categorías</th>{visibles.map((e) => <th key={e.id}>Cuentas {e.nombre}</th>)}<th>Estado</th><th></th></tr></thead>
              <tbody>
                {listaProv.map((p) => (
                  <tr key={p.id} className={p.activo ? '' : 'inactivo'} style={{ background: sel?.id === p.id ? 'var(--suave)' : undefined }}>
                    <td><button className="enlace" aria-pressed={sel?.id === p.id} onClick={() => setElegido(p.id)} style={{ fontWeight: 600, fontSize: 14, textAlign: 'left' }}>{p.nombre}</button></td>
                    <td className="mono">{p.rnc ?? '—'}</td>
                    <td><span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{(p.categorias ?? []).map((c) => <span key={c} style={{ ...pastilla(['var(--suave)', 'var(--tinta)']), border: '1px solid var(--borde)', fontWeight: 500, padding: '2px 7px' }}>{c}</span>)}</span></td>
                    {visibles.map((e) => {
                      const cs = cuentasDe(p, e.id)
                      return <td key={e.id} className="mono" style={{ ...celda, color: cs.length ? 'var(--tinta)' : 'var(--tenue)' }}>{cs.length ? cs.map((c) => c.numero).join(', ') : 'No habilitado'}</td>
                    })}
                    <td><span style={pastilla(p.activo ? ESTADO.Activa : ESTADO.Inactiva)}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="acciones">{esAdmin && <>
                      {p.activo && <button className="secundario" onClick={() => abrir('proveedores', MODULOS.proveedores, p, '', `Editar ${p.nombre}`)}>Editar</button>}
                      <button className="secundario" onClick={() => cambiarEstado('proveedores', p, p.nombre)}>{p.activo ? 'Dar de baja' : 'Reactivar'}</button>
                    </>}</td>
                  </tr>
                ))}
                {listaProv.length === 0 && <tr><td colSpan={5 + visibles.length} style={tenue}>{proveedores.length ? 'Ningún proveedor coincide.' : 'Todavía no hay proveedores. Regístrelos con «+ Nuevo proveedor» o con Importar CSV.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <span style={{ fontSize: 12, color: 'var(--tenue)' }}>El nombre y el RNC no se repiten: la base rechaza duplicados.</span>
        </section>

        <section aria-labelledby="h-det" style={{ ...tarjeta, flex: '1 1 320px' }}>
          {sel ? <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="h-det" style={h2}>{sel.nombre}</h2>
              <span style={tenue}>{[sel.rnc ? `RNC ${sel.rnc}` : 'Sin RNC', (sel.categorias ?? []).join(', '), sel.activo ? 'Activo' : 'Inactivo'].filter(Boolean).join(' · ')}</span>
            </div>
            {visibles.map((e) => {
              const cs = cuentasProv.filter((c) => c.proveedor_id === sel.id && c.empresa_id === e.id && (c.activo || esAdmin))
              return (
                <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--pista)', paddingTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <b style={{ fontSize: 14 }}>{e.nombre}</b>
                    {esAdmin && sel.activo && <button className="secundario" onClick={() => abrir('proveedores', moduloCuentaProv(sel.id), null, e.id, `Nueva cuenta de ${sel.nombre} · ${e.nombre}`)}>+ Cuenta</button>}
                  </div>
                  {cs.map((c) => (
                    <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, fontSize: 13, padding: '8px 10px', border: '1px solid var(--pista)', borderRadius: 8, opacity: c.activo ? 1 : 0.55 }}>
                      <span>Cuenta proveedor <b className="mono">{c.numero}</b>{c.descripcion && <span style={{ color: 'var(--tenue)' }}> · {c.descripcion}</span>}</span>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="mono">{c.moneda}</span>
                        {esAdmin && c.activo && <button className="secundario" onClick={() => abrir('proveedores', MODULOS.cuentas_proveedor, c, c.empresa_id, `Editar cuenta ${c.numero}`)}>Editar</button>}
                        {esAdmin && <button className="secundario" onClick={() => cambiarEstado('cuentas_proveedor', c, `la cuenta ${c.numero}`)}>{c.activo ? 'Baja' : 'Reactivar'}</button>}
                      </span>
                    </div>
                  ))}
                  {cs.length === 0 && <span style={tenue}>No habilitado para esta empresa.</span>}
                </div>
              )
            })}
          </> : <p style={{ ...tenue, margin: 0 }} id="h-det">Elija un proveedor para ver sus cuentas por empresa.</p>}
        </section>
      </div>
      {!esAdmin && <p className="nota" style={{ margin: 0 }}>Solo el Administrador registra y edita proveedores y cuentas; usted puede consultarlos.</p>}
    </div>
  )
}
