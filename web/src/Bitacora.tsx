import { useEffect, useState } from 'react'
import { supabase, mensajeError, fechaLocal } from './supabase'
import { Multi } from './diseno'

type Registro = {
  id: number
  tabla: string
  registro_id: string
  accion: 'INSERT' | 'UPDATE'
  antes: Record<string, unknown> | null
  despues: Record<string, unknown>
  usuario_id: string | null
  ocurrido_en: string
}

const TABLAS: Record<string, string> = {
  servicios_telecom: 'Telecomunicaciones', lineas_flota: 'Flotas', productos_software: 'Software',
  gastos: 'Gastos', gasto_pasos: 'Movimientos de gasto', evidencias: 'Evidencias', partidas: 'Partidas',
  presupuestos_versiones: 'Versiones', personas: 'Personal', ausencias: 'Ausencias', proveedores: 'Proveedores',
  cuentas_proveedor: 'Cuentas de proveedor', cuentas_contables: 'Cuentas contables', centros_costo: 'Centros de costo',
  membresias: 'Roles', empresas: 'Empresas', tasas_cambio: 'Tasas de cambio',
}
const INTERNOS = new Set(['id', 'empresa_id', 'creado_en', 'creado_por', 'baja_en', 'baja_por'])
const valor = (v: unknown) => (v == null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v))

// Qué cambió: en una edición, solo los campos distintos; en un alta, los datos principales.
function cambios(r: Registro): string {
  if (r.accion === 'INSERT') {
    return Object.entries(r.despues).filter(([k, v]) => !INTERNOS.has(k) && v != null && v !== '' && k !== 'activo').slice(0, 6)
      .map(([k, v]) => `${k}: ${valor(v)}`).join(' · ')
  }
  return Object.keys(r.despues).filter((k) => !INTERNOS.has(k) && valor(r.antes?.[k]) !== valor(r.despues[k]))
    .map((k) => `${k}: ${valor(r.antes?.[k])} → ${valor(r.despues[k])}`).join(' · ')
}

export default function Bitacora({ empresa, esAdmin }: { empresa: string; esAdmin: boolean }) {
  const [registros, setRegistros] = useState<Registro[]>([])
  const [usuarios, setUsuarios] = useState<Record<string, string>>({})
  const [tablas, setTablas] = useState<string[]>([])
  const [global, setGlobal] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let q = supabase.from('bitacora').select('*').order('ocurrido_en', { ascending: false }).limit(300)
    // Proveedores, tasas y el rol de Administrador no tienen empresa: solo el Administrador los ve.
    q = global ? q.is('empresa_id', null) : q.eq('empresa_id', empresa)
    if (tablas.length) q = q.in('tabla', tablas)
    q.then(async ({ data, error }) => {
      if (error) setError(await mensajeError(error))
      else setRegistros(data as Registro[])
    })
  }, [empresa, tablas, global])

  useEffect(() => {
    if (!esAdmin) return
    supabase.rpc('listar_usuarios').then(({ data }) => {
      setUsuarios(Object.fromEntries(((data ?? []) as { id: string; email: string }[]).map((u) => [u.id, u.email])))
    })
  }, [esAdmin])

  return (
    <section>
      <h2>Bitácora</h2>
      <p className="nota">Cada alta y edición queda aquí con el valor anterior y el nuevo. Nada se borra. Se muestran los últimos 300 cambios.</p>
      <div className="fila-controles">
        <Multi label="Qué" opciones={Object.entries(TABLAS)} valor={tablas} cambiar={setTablas} todos="Todo" ancho={200} />
        {esAdmin && <label className="casilla"><input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} /> Registros globales (proveedores, tasas, Administradores)</label>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="desplazable">
        <table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Qué</th><th>Acción</th><th>Cambios</th></tr></thead>
          <tbody>
            {registros.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.ocurrido_en).toLocaleString('es-DO')}</td>
                <td>{r.usuario_id ? usuarios[r.usuario_id] ?? r.usuario_id.slice(0, 8) : 'Sistema'}</td>
                <td>{TABLAS[r.tabla] ?? r.tabla}</td>
                <td>{r.accion === 'INSERT' ? 'Alta' : r.antes?.activo === true && r.despues.activo === false ? 'Baja' : 'Edición'}</td>
                <td className="cambios">{cambios(r)}</td>
              </tr>
            ))}
            {registros.length === 0 && <tr><td colSpan={5}>Sin cambios registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Tarjeta del inicio: quién está fuera hoy y quién sale en los próximos 30 días.
export function FueraHoy({ empresa }: { empresa: string }) {
  const [filas, setFilas] = useState<{ id: string; tipo: string; desde: string; hasta: string; cobertura: string | null; personas: { nombre: string } | null }[]>([])

  useEffect(() => {
    const hoy = fechaLocal()
    const en30 = fechaLocal(new Date(Date.now() + 30 * 864e5))
    supabase.from('ausencias').select('id, tipo, desde, hasta, cobertura, personas!ausencias_persona_id_fkey(nombre)')
      .eq('empresa_id', empresa).eq('activo', true).eq('cancelada', false)
      .lte('desde', en30).gte('hasta', hoy).order('desde')
      .then(({ data }) => setFilas((data ?? []) as unknown as typeof filas))
  }, [empresa])

  const hoy = fechaLocal()
  return (
    <div className="tarjeta">
      <h3>Personal fuera hoy y próximos 30 días</h3>
      {filas.length === 0 ? <p className="nota">Nadie de vacaciones ni con permiso.</p> : (
        <ul className="lista">
          {filas.map((a) => (
            <li key={a.id}>
              <b>{a.personas?.nombre}</b> · {a.tipo} · {a.desde} al {a.hasta}
              {a.desde <= hoy ? ' · fuera hoy' : ''}{a.cobertura ? ` · lo cubre ${a.cobertura}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
