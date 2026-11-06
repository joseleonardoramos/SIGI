import { useEffect, useState, type FormEvent } from 'react'
import { supabase, mensajeError } from './supabase'

type Empresa = {
  id: string
  codigo: string
  nombre: string
  inicio_ejercicio_mes: number
  moneda_reporte: string
  tema: string
  activo: boolean
  baja_motivo: string | null
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const VACIA = { codigo: '', nombre: '', inicio_ejercicio_mes: 1, moneda_reporte: 'RD$', tema: 'catador' }
const TEMAS: Record<string, string> = { catador: 'El Catador', bona: 'Bona' }

export default function Empresas() {
  const [lista, setLista] = useState<Empresa[]>([])
  const [form, setForm] = useState(VACIA)
  const [editando, setEditando] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false) // formulario visible solo al presionar Crear o Editar
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  async function cargar() {
    const { data, error } = await supabase.from('empresas').select('*').order('nombre')
    if (error) setError(await mensajeError(error))
    else setLista(data as Empresa[])
  }
  useEffect(() => { cargar() }, [])

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const datos = { ...form, codigo: form.codigo.trim().toUpperCase(), nombre: form.nombre.trim() }
    const { error } = editando
      ? await supabase.from('empresas').update(datos).eq('id', editando)
      : await supabase.from('empresas').insert(datos)
    if (error) {
      setError(error.code === '23505' ? 'Ya existe una empresa con ese código.' : await mensajeError(error))
      return
    }
    setMsg(editando ? 'Empresa actualizada.' : 'Empresa creada.')
    cerrar()
    cargar()
  }

  function cerrar() { setForm(VACIA); setEditando(null); setAbierto(false) }

  async function cambiarEstado(emp: Empresa) {
    setError('')
    let cambios: Partial<Empresa> = { activo: true }
    if (emp.activo) {
      const motivo = window.prompt(`Motivo de la baja de ${emp.nombre}:`)
      if (!motivo?.trim()) return
      cambios = { activo: false, baja_motivo: motivo.trim() }
    }
    const { error } = await supabase.from('empresas').update(cambios).eq('id', emp.id)
    if (error) setError(await mensajeError(error))
    else { setMsg(emp.activo ? 'Empresa dada de baja; su historial se conserva.' : 'Empresa reactivada.'); cargar() }
  }

  return (
    <section>
      <h2>Empresas</h2>
      {!abierto && <button type="button" onClick={() => { cerrar(); setMsg(''); setError(''); setAbierto(true) }}>Crear empresa</button>}
      {abierto && <form className="tarjeta fila" onSubmit={guardar}>
        <label>Código<input required maxLength={10} value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></label>
        <label className="ancho">Nombre<input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
        <label>Inicio del año fiscal
          <select value={form.inicio_ejercicio_mes} onChange={(e) => setForm({ ...form, inicio_ejercicio_mes: Number(e.target.value) })}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label>Moneda de reporte
          <select value={form.moneda_reporte} onChange={(e) => setForm({ ...form, moneda_reporte: e.target.value })}>
            <option>RD$</option><option>US$</option>
          </select>
        </label>
        <label>Colores
          <select value={form.tema} onChange={(e) => setForm({ ...form, tema: e.target.value })}>
            {Object.entries(TEMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="submit">{editando ? 'Guardar cambios' : 'Crear empresa'}</button>
        <button type="button" className="secundario" onClick={cerrar}>Cancelar</button>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && !error && <p className="ok" role="status">{msg}</p>}

      <table>
        <thead><tr><th>Código</th><th>Nombre</th><th>Año fiscal inicia</th><th>Moneda</th><th>Colores</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {lista.map((emp) => (
            <tr key={emp.id} className={emp.activo ? '' : 'inactivo'}>
              <td>{emp.codigo}</td>
              <td>{emp.nombre}</td>
              <td>{MESES[emp.inicio_ejercicio_mes - 1]}</td>
              <td>{emp.moneda_reporte}</td>
              <td>{TEMAS[emp.tema] ?? emp.tema}</td>
              <td>{emp.activo ? 'Activa' : `Baja: ${emp.baja_motivo ?? ''}`}</td>
              <td className="acciones">
                <button className="secundario" onClick={() => {
                  setEditando(emp.id)
                  setAbierto(true)
                  setForm({ codigo: emp.codigo, nombre: emp.nombre, inicio_ejercicio_mes: emp.inicio_ejercicio_mes, moneda_reporte: emp.moneda_reporte, tema: emp.tema })
                }}>Editar</button>
                <button className="secundario" onClick={() => cambiarEstado(emp)}>{emp.activo ? 'Dar de baja' : 'Reactivar'}</button>
              </td>
            </tr>
          ))}
          {lista.length === 0 && <tr><td colSpan={7}>Todavía no hay empresas.</td></tr>}
        </tbody>
      </table>
    </section>
  )
}
