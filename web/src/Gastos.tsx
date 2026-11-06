import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase, mensajeError, fechaLocal, leerTodo, dinero } from './supabase'

// Gastos: compromiso → factura → pago, con evidencias. Todo pasa por las funciones de la base
// (registrar_compromiso, registrar_movimiento, reversar_movimiento), que bloquean la partida y validan.

type Gasto = { id: string; codigo: string; origen: string; descripcion: string; moneda: string; partida_id: string | null; proveedor_id: string | null; creado_en: string }
type Paso = { id: string; gasto_id: string; tipo: string; fecha: string; monto: number; documento: string | null; ncf: string | null; metodo_pago: string | null; referencia_bancaria: string | null; fuera_presupuesto_motivo: string | null; nota: string | null; reversado: boolean; reversa_id: string | null }
type Evidencia = { id: string; paso_id: string; nombre: string; ruta_storage: string }
type Opcion = { id: string; etiqueta: string }
type Resumen = { gasto_id: string; comprometido: number; facturado: number; pagado: number }

const hoy = () => fechaLocal()
const NUEVO = { codigo: '', origen: 'Partida', descripcion: '', partida: '', proveedor: '', cuenta: '', moneda: 'RD$', monto: '', fecha: hoy(), documento: '', motivo: '' }
const MOV = { tipo: 'Factura', monto: '', fecha: hoy(), documento: '', ncf: '', metodo: 'Transferencia', referencia: '', motivo: '', proveedor: '' }

export default function Gastos({ empresa, puedeEscribir, esAdmin }: { empresa: string; puedeEscribir: boolean; esAdmin: boolean }) {
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [resumen, setResumen] = useState<Record<string, Resumen>>({})
  const [pasos, setPasos] = useState<Paso[]>([]) // solo los del gasto abierto
  const [evidencias, setEvidencias] = useState<Evidencia[]>([])
  const [marcas, setMarcas] = useState<Record<string, boolean>>({})
  const [partidas, setPartidas] = useState<Opcion[]>([])
  const [proveedores, setProveedores] = useState<Opcion[]>([])
  const [cuentas, setCuentas] = useState<(Opcion & { proveedor_id: string })[]>([])
  const [nuevo, setNuevo] = useState(NUEVO)
  const [mov, setMov] = useState(MOV)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [buscar, setBuscar] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  async function cargar() {
    type FilaPartida = { id: string; codigo: string; nombre: string; presupuestos_versiones: { ejercicio: string; estado: string } | null }
    const [g, r, m, pa, pr, cu] = await Promise.all([
      leerTodo<Gasto>((d, h) => supabase.from('gastos').select('id, codigo, origen, descripcion, moneda, partida_id, proveedor_id, creado_en')
        .eq('empresa_id', empresa).eq('activo', true).order('creado_en', { ascending: false }).order('id').range(d, h)),
      leerTodo<Resumen>((d, h) => supabase.from('resumen_gastos').select('gasto_id, comprometido, facturado, pagado').eq('empresa_id', empresa).order('gasto_id').range(d, h)),
      leerTodo<{ entidad_id: string; marcado: boolean }>((d, h) => supabase.from('marcas_vigentes').select('entidad_id, marcado')
        .eq('empresa_id', empresa).eq('entidad', 'gastos').order('entidad_id').range(d, h)),
      leerTodo<FilaPartida>((d, h) => supabase.from('partidas').select('id, codigo, nombre, presupuestos_versiones!partidas_version_id_fkey(ejercicio, estado)')
        .eq('empresa_id', empresa).eq('activo', true).order('codigo').order('id').range(d, h)),
      leerTodo<{ id: string; nombre: string }>((d, h) => supabase.from('proveedores').select('id, nombre').eq('activo', true).order('nombre').order('id').range(d, h)),
      leerTodo<{ id: string; numero: string; proveedor_id: string }>((d, h) => supabase.from('cuentas_proveedor').select('id, numero, proveedor_id')
        .eq('empresa_id', empresa).eq('activo', true).order('id').range(d, h)),
    ])
    const fallo = g.error ?? r.error ?? m.error ?? pa.error ?? pr.error ?? cu.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    setGastos(g.data)
    setResumen(Object.fromEntries(r.data.map((x) => [x.gasto_id, x])))
    setMarcas(Object.fromEntries(m.data.map((x) => [x.entidad_id, x.marcado])))
    setPartidas(pa.data
      .filter((x) => x.presupuestos_versiones?.estado !== 'Cerrado')
      .map((x) => ({ id: x.id, etiqueta: `${x.codigo} · ${x.nombre} (${x.presupuestos_versiones?.ejercicio ?? ''})` })))
    setProveedores(pr.data.map((x) => ({ id: x.id, etiqueta: x.nombre })))
    setCuentas(cu.data.map((x) => ({ id: x.id, etiqueta: x.numero, proveedor_id: x.proveedor_id })))
  }

  // Movimientos y evidencias solo del gasto abierto.
  async function cargarDetalle(gasto: string | null) {
    if (!gasto) { setPasos([]); setEvidencias([]); return }
    const p = await supabase.from('gasto_pasos').select('*').eq('gasto_id', gasto).eq('activo', true).order('creado_en')
    if (p.error) { setError(await mensajeError(p.error)); return }
    const lista = p.data as Paso[]
    const e = await supabase.from('evidencias').select('id, paso_id, nombre, ruta_storage').in('paso_id', lista.map((x) => x.id)).eq('activo', true)
    setPasos(lista)
    setEvidencias((e.data ?? []) as Evidencia[])
  }

  useEffect(() => { setAbierto(null); cargar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargarDetalle(abierto) }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps

  async function ejecutar(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setError('')
    setMsg('')
    const { error } = await fn()
    if (error) { setError(await mensajeError(error)); return false }
    setMsg(ok)
    await Promise.all([cargar(), cargarDetalle(abierto)])
    return true
  }

  async function crear(e: FormEvent) {
    e.preventDefault()
    const listo = await ejecutar(() => supabase.rpc('registrar_compromiso', {
      p_empresa: empresa, p_codigo: nuevo.codigo, p_origen: nuevo.origen, p_descripcion: nuevo.descripcion,
      p_monto: Number(nuevo.monto.replace(/,/g, '')), p_fecha: nuevo.fecha, p_moneda: nuevo.moneda,
      p_partida: nuevo.partida || null, p_proveedor: nuevo.proveedor || null, p_cuenta_proveedor: nuevo.cuenta || null,
      p_documento: nuevo.documento || null, p_motivo_fuera: nuevo.motivo || null,
    }), 'Gasto registrado con su compromiso.')
    if (listo) setNuevo({ ...NUEVO, fecha: nuevo.fecha })
  }

  async function agregarMovimiento(e: FormEvent) {
    e.preventDefault()
    const listo = await ejecutar(() => supabase.rpc('registrar_movimiento', {
      p_gasto: abierto, p_tipo: mov.tipo, p_monto: Number(mov.monto.replace(/,/g, '')), p_fecha: mov.fecha,
      p_documento: mov.documento || null, p_ncf: mov.ncf || null, p_metodo_pago: mov.metodo || null,
      p_referencia_bancaria: mov.referencia || null, p_motivo_fuera: mov.motivo || null, p_proveedor: mov.proveedor || null,
    }), ({ Factura: 'Factura registrada.', Pago: 'Pago registrado.', Compromiso: 'Compromiso agregado.' } as Record<string, string>)[mov.tipo])
    if (listo) setMov({ ...MOV, tipo: mov.tipo })
  }

  async function reversar(p: Paso) {
    const motivo = window.prompt(`Motivo para reversar ${p.tipo.toLowerCase()} de ${dinero(Number(p.monto))}:`)
    if (!motivo?.trim()) return
    await ejecutar(() => supabase.rpc('reversar_movimiento', { p_paso: p.id, p_motivo: motivo.trim() }), 'Movimiento reversado; el original se conserva.')
  }

  async function marcarDireccion(g: Gasto) {
    await ejecutar(() => supabase.from('marcas_direccion').insert({ empresa_id: empresa, entidad: 'gastos', entidad_id: g.id, marcado: !marcas[g.id] }),
      marcas[g.id] ? 'Marca de Dirección retirada.' : 'Marcado como aprobado por Dirección.')
  }

  async function subirEvidencia(paso: Paso, e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    const ruta = `${empresa}/${paso.gasto_id}/${paso.id}/${Date.now()}-${archivo.name.replace(/[^\w.-]+/g, '_')}`
    setError('')
    const subida = await supabase.storage.from('evidencias').upload(ruta, archivo, { contentType: archivo.type })
    if (subida.error) { setError(`No se pudo subir: ${subida.error.message} (PDF, PNG o JPG de hasta 10 MB).`); return }
    await ejecutar(() => supabase.from('evidencias').insert({
      empresa_id: empresa, paso_id: paso.id, ruta_storage: ruta, nombre: archivo.name, tipo_mime: archivo.type, tamano_bytes: archivo.size,
    }), 'Evidencia agregada.')
  }

  async function verEvidencia(ev: Evidencia) {
    const { data, error } = await supabase.storage.from('evidencias').createSignedUrl(ev.ruta_storage, 120)
    if (error) setError(await mensajeError(error))
    else window.open(data.signedUrl, '_blank', 'noopener')
  }

  const nombre = (lista: Opcion[], id: string | null) => lista.find((x) => x.id === id)?.etiqueta ?? ''
  const termino = buscar.trim().toLowerCase()
  const lista = gastos.filter((g) => !termino || `${g.codigo} ${g.descripcion} ${nombre(proveedores, g.proveedor_id)}`.toLowerCase().includes(termino))
  const gasto = gastos.find((g) => g.id === abierto)
  const pasosGasto = pasos

  return (
    <section>
      <h2>Gastos y evidencias</h2>
      {puedeEscribir && (
        <form className="tarjeta fila" onSubmit={crear}>
          <label>Código *<input required value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} /></label>
          <label>Origen
            <select value={nuevo.origen} onChange={(e) => setNuevo({ ...nuevo, origen: e.target.value })}>
              {['Partida', 'Software', 'Telecom', 'Flotas'].map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label className="ancho">Descripción *<input required value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} /></label>
          <label className="ancho">Partida
            <select value={nuevo.partida} onChange={(e) => setNuevo({ ...nuevo, partida: e.target.value })}>
              <option value="">Sin partida (fuera de presupuesto)</option>
              {partidas.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
            </select>
          </label>
          <label>Proveedor
            <select value={nuevo.proveedor} onChange={(e) => setNuevo({ ...nuevo, proveedor: e.target.value, cuenta: '' })}>
              <option value="">—</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
            </select>
          </label>
          <label>Cuenta proveedor
            <select value={nuevo.cuenta} onChange={(e) => setNuevo({ ...nuevo, cuenta: e.target.value })}>
              <option value="">—</option>
              {cuentas.filter((c) => c.proveedor_id === nuevo.proveedor).map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
            </select>
          </label>
          <label>Moneda
            <select value={nuevo.moneda} onChange={(e) => setNuevo({ ...nuevo, moneda: e.target.value })}><option>RD$</option><option>US$</option></select>
          </label>
          <label>Monto comprometido *<input required inputMode="decimal" value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} /></label>
          <label>Fecha *<input type="date" required value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} /></label>
          <label>Orden o contrato<input value={nuevo.documento} onChange={(e) => setNuevo({ ...nuevo, documento: e.target.value })} /></label>
          <label className="ancho">Motivo si queda fuera de presupuesto<input value={nuevo.motivo} onChange={(e) => setNuevo({ ...nuevo, motivo: e.target.value })} /></label>
          <button type="submit">Registrar gasto</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && !error && <p className="ok" role="status">{msg}</p>}

      <div className="fila-controles">
        <label className="buscar">Buscar<input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} /></label>
        <span className="nota">{lista.length} gasto(s)</span>
      </div>
      <div className="desplazable">
        <table>
          <thead><tr><th>Código</th><th>Descripción</th><th>Partida</th><th>Proveedor</th><th>Moneda</th><th>Comprometido</th><th>Facturado</th><th>Pagado</th><th>Dirección</th><th></th></tr></thead>
          <tbody>
            {lista.map((g) => {
              const t = resumen[g.id] ?? { comprometido: 0, facturado: 0, pagado: 0 }
              return (
                <tr key={g.id} className={g.id === abierto ? 'seleccionado' : ''}>
                  <td>{g.codigo}</td>
                  <td>{g.descripcion}</td>
                  <td>{nombre(partidas, g.partida_id) || (g.partida_id ? '(presupuesto cerrado)' : 'Fuera de presupuesto')}</td>
                  <td>{nombre(proveedores, g.proveedor_id)}</td>
                  <td>{g.moneda}</td>
                  <td className="num">{dinero(Number(t.comprometido))}</td>
                  <td className="num">{dinero(Number(t.facturado))}</td>
                  <td className="num">{dinero(Number(t.pagado))}</td>
                  <td>
                    {esAdmin
                      ? <button className="secundario" onClick={() => marcarDireccion(g)}>{marcas[g.id] ? 'Aprobado ✓' : 'Marcar'}</button>
                      : marcas[g.id] ? 'Aprobado' : ''}
                  </td>
                  <td><button className="secundario" onClick={() => { setAbierto(g.id === abierto ? null : g.id); setMov(MOV) }}>{g.id === abierto ? 'Cerrar' : 'Ver'}</button></td>
                </tr>
              )
            })}
            {lista.length === 0 && <tr><td colSpan={10}>Sin gastos.</td></tr>}
          </tbody>
        </table>
      </div>

      {gasto && (
        <div className="tarjeta detalle">
          <h3>{gasto.codigo} · {gasto.descripcion}</h3>
          <p className="nota">«Aprobado por Dirección» es informativo: no bloquea ni cambia los registros. Los reversos no borran: el movimiento queda tachado y con su motivo.</p>
          <div className="desplazable">
            <table>
              <thead><tr><th>Tipo</th><th>Fecha</th><th>Monto ({gasto.moneda})</th><th>Documento / NCF</th><th>Pago</th><th>Notas</th><th>Evidencias</th><th></th></tr></thead>
              <tbody>
                {pasosGasto.map((p) => (
                  <tr key={p.id} className={p.reversado ? 'reversado' : ''}>
                    <td>{p.tipo}</td>
                    <td>{p.fecha}</td>
                    <td className="num">{dinero(Number(p.monto))}</td>
                    <td>{[p.documento, p.ncf].filter(Boolean).join(' · ')}</td>
                    <td>{[p.metodo_pago, p.referencia_bancaria].filter(Boolean).join(' · ')}</td>
                    <td>{[p.fuera_presupuesto_motivo && `Fuera de presupuesto: ${p.fuera_presupuesto_motivo}`, p.nota, p.reversado && 'Reversado'].filter(Boolean).join(' · ')}</td>
                    <td>
                      {evidencias.filter((ev) => ev.paso_id === p.id).map((ev) => (
                        <button key={ev.id} className="enlace" onClick={() => verEvidencia(ev)}>{ev.nombre}</button>
                      ))}
                      {puedeEscribir && p.tipo !== 'Reverso' && (
                        <label className="subir">+ Adjuntar<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => subirEvidencia(p, e)} /></label>
                      )}
                    </td>
                    <td>{puedeEscribir && !p.reversado && p.tipo !== 'Reverso' && <button className="secundario" onClick={() => reversar(p)}>Reversar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {puedeEscribir && (
            <form className="fila" onSubmit={agregarMovimiento}>
              <label>Movimiento
                <select value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value })}>
                  <option>Factura</option><option>Pago</option><option value="Compromiso">Más compromiso</option>
                </select>
              </label>
              <label>Monto *<input required inputMode="decimal" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value })} /></label>
              <label>Fecha *<input type="date" required value={mov.fecha} onChange={(e) => setMov({ ...mov, fecha: e.target.value })} /></label>
              {mov.tipo === 'Factura' && !gasto.proveedor_id && (
                <label>Proveedor de la factura *
                  <select required value={mov.proveedor} onChange={(e) => setMov({ ...mov, proveedor: e.target.value })}>
                    <option value="">—</option>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
                  </select>
                </label>
              )}
              {mov.tipo === 'Factura' && <label>NCF o e-CF *<input required placeholder="B0100000001" value={mov.ncf} onChange={(e) => setMov({ ...mov, ncf: e.target.value })} /></label>}
              <label>Documento<input value={mov.documento} onChange={(e) => setMov({ ...mov, documento: e.target.value })} /></label>
              {mov.tipo === 'Pago' && (
                <>
                  <label>Método<input value={mov.metodo} onChange={(e) => setMov({ ...mov, metodo: e.target.value })} /></label>
                  <label>Referencia bancaria<input value={mov.referencia} onChange={(e) => setMov({ ...mov, referencia: e.target.value })} /></label>
                </>
              )}
              {mov.tipo !== 'Pago' && <label className="ancho">Motivo si excede el presupuesto<input value={mov.motivo} onChange={(e) => setMov({ ...mov, motivo: e.target.value })} /></label>}
              <button type="submit">Registrar</button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
