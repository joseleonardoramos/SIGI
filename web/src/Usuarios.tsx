import { useEffect, useState, type FormEvent } from 'react'
import { supabase, mensajeError } from './supabase'

type Usuario = { id: string; email: string; ultimo_acceso: string | null }
type Empresa = { id: string; nombre: string; activo: boolean }
type Membresia = { usuario_id: string; empresa_id: string | null; rol: string }

// Contraseña temporal de 16 caracteres con letras y números (sin caracteres confusos).
function claveTemporal(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const clave = Array.from(bytes, (b) => abc[b % abc.length]).join('')
    if (/[a-zA-Z]/.test(clave) && /[0-9]/.test(clave)) return clave
  }
}

export default function Usuarios({ yo }: { yo: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [membresias, setMembresias] = useState<Membresia[]>([])
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState(claveTemporal)
  const [abierto, setAbierto] = useState(false) // formulario visible solo al presionar Crear usuario
  const [creada, setCreada] = useState<{ email: string; clave: string } | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  async function cargar() {
    const [u, e, m] = await Promise.all([
      supabase.rpc('listar_usuarios'),
      // Incluye las dadas de baja: así se pueden retirar los accesos que quedaron en ellas.
      supabase.from('empresas').select('id, nombre, activo').order('activo', { ascending: false }).order('nombre'),
      supabase.from('membresias').select('usuario_id, empresa_id, rol').eq('activo', true),
    ])
    const fallo = u.error ?? e.error ?? m.error
    if (fallo) { setError(await mensajeError(fallo)); return }
    setUsuarios(u.data as Usuario[])
    setEmpresas(e.data as Empresa[])
    setMembresias(m.data as Membresia[])
  }
  useEffect(() => { cargar() }, [])

  async function crear(ev: FormEvent) {
    ev.preventDefault()
    setError('')
    setMsg('')
    setCreada(null)
    const { error } = await supabase.functions.invoke('usuarios', { body: { email: email.trim(), password: clave } })
    if (error) { setError(await mensajeError(error)); return }
    setCreada({ email: email.trim(), clave })
    setEmail('')
    setClave(claveTemporal())
    setAbierto(false)
    cargar()
  }

  async function asignar(usuario: string, empresa: string | null, rol: string | null) {
    setError('')
    const { error } = await supabase.rpc('asignar_rol', { p_usuario: usuario, p_empresa: empresa, p_rol: rol })
    if (error) setError(await mensajeError(error))
    else { setMsg('Rol actualizado.'); cargar() }
  }

  const rolEn = (u: string, emp: string | null) =>
    membresias.find((m) => m.usuario_id === u && m.empresa_id === emp)?.rol ?? ''

  return (
    <section>
      <h2>Usuarios y roles</h2>
      {!abierto && <button type="button" onClick={() => { setCreada(null); setMsg(''); setError(''); setAbierto(true) }}>Crear usuario</button>}
      {abierto && <form className="tarjeta fila" onSubmit={crear}>
        <label className="ancho">Correo del nuevo usuario
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Contraseña temporal
          <input required minLength={12} value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <button type="button" className="secundario" onClick={() => setClave(claveTemporal())}>Generar otra</button>
        <button type="submit">Crear usuario</button>
        <button type="button" className="secundario" onClick={() => { setEmail(''); setAbierto(false) }}>Cancelar</button>
      </form>}
      {creada && (
        <p className="ok" role="status">
          Usuario <b>{creada.email}</b> creado. Entréguele esta contraseña temporal por un medio seguro: <code>{creada.clave}</code>.
          No se volverá a mostrar. Luego asígnele un rol abajo.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && !error && <p className="ok" role="status">{msg}</p>}

      <p className="nota">Administrador: acceso global a todas las empresas. Captura: registra en su empresa y ve personal. Consulta: solo lee.</p>
      <div className="desplazable">
        <table>
          <thead>
            <tr>
              <th>Usuario</th><th>Último acceso</th><th>Administrador</th>
              {empresas.map((e) => <th key={e.id}>{e.nombre}{!e.activo && ' (dada de baja)'}</th>)}
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const admin = rolEn(u.id, null) === 'Administrador'
              return (
                <tr key={u.id}>
                  <td>{u.email}{u.id === yo && ' (usted)'}</td>
                  <td>{u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleString('es-DO') : 'Nunca'}</td>
                  <td>
                    <input type="checkbox" aria-label={`Administrador: ${u.email}`} checked={admin} disabled={u.id === yo}
                      onChange={(e) => asignar(u.id, null, e.target.checked ? 'Administrador' : null)} />
                  </td>
                  {empresas.map((emp) => (
                    <td key={emp.id}>
                      {admin ? <span className="nota">Todas</span> : (
                        <select aria-label={`Rol de ${u.email} en ${emp.nombre}`} value={rolEn(u.id, emp.id)}
                          onChange={(e) => asignar(u.id, emp.id, e.target.value || null)}>
                          <option value="">Sin acceso</option>
                          <option>Consulta</option>
                          <option>Captura</option>
                        </select>
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {empresas.length === 0 && <p className="nota">Cree primero una empresa para poder asignar roles de Captura o Consulta.</p>}
    </section>
  )
}
