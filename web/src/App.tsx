import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, mensajeError } from './supabase'
import Login from './Login'
import Empresas from './Empresas'
import Usuarios from './Usuarios'

type Acceso = { empresa_id: string | null; rol: string; empresas: { nombre: string } | null }
type Vista = 'inicio' | 'empresas' | 'usuarios' | 'clave'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [listo, setListo] = useState(false)
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [vista, setVista] = useState<Vista>('inicio')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setListo(true) })
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const usuarioId = session?.user.id
  useEffect(() => {
    if (!usuarioId) { setAccesos([]); setVista('inicio'); return }
    supabase.from('membresias').select('empresa_id, rol, empresas(nombre)')
      .eq('usuario_id', usuarioId).eq('activo', true)
      .then(({ data }) => setAccesos((data ?? []) as unknown as Acceso[]))
  }, [usuarioId])

  if (!listo) return null
  if (!session) return <Login />

  // La interfaz solo oculta opciones; los permisos reales los aplica la base de datos.
  const esAdmin = accesos.some((a) => a.rol === 'Administrador')
  const nav: [Vista, string][] = [['inicio', 'Inicio'], ...(esAdmin ? [['empresas', 'Empresas'], ['usuarios', 'Usuarios y roles']] as [Vista, string][] : []), ['clave', 'Cambiar contraseña']]

  return (
    <div className="app">
      <header>
        <strong>SIGI</strong>
        <nav aria-label="Principal">
          {nav.map(([v, t]) => (
            <button key={v} className={vista === v ? 'activo' : ''} aria-current={vista === v ? 'page' : undefined} onClick={() => setVista(v)}>{t}</button>
          ))}
        </nav>
        <span className="usuario">{session.user.email}</span>
        <button className="secundario" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <main>
        {vista === 'inicio' && <Inicio accesos={accesos} esAdmin={esAdmin} />}
        {vista === 'empresas' && esAdmin && <Empresas />}
        {vista === 'usuarios' && esAdmin && <Usuarios yo={session.user.id} />}
        {vista === 'clave' && <CambiarClave email={session.user.email ?? ''} />}
      </main>
    </div>
  )
}

function Inicio({ accesos, esAdmin }: { accesos: Acceso[]; esAdmin: boolean }) {
  if (accesos.length === 0) {
    return <p className="nota">Su usuario aún no tiene acceso a ninguna empresa. Pida al Administrador que le asigne un rol.</p>
  }
  return (
    <section>
      <h2>Mis accesos</h2>
      <ul>
        {esAdmin && <li><b>Administrador</b> en todas las empresas</li>}
        {accesos.filter((a) => a.empresa_id).map((a) => (
          <li key={a.empresa_id}><b>{a.rol}</b> en {a.empresas?.nombre}</li>
        ))}
      </ul>
      <p className="nota">Si entró con una contraseña temporal, cámbiela en «Cambiar contraseña».</p>
    </section>
  )
}

function CambiarClave({ email }: { email: string }) {
  const [actual, setActual] = useState('')
  const [clave, setClave] = useState('')
  const [repetir, setRepetir] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setOk(false)
    if (clave !== repetir) { setError('Las contraseñas no coinciden.'); return }
    if (clave.length < 12 || !/[a-zA-Z]/.test(clave) || !/[0-9]/.test(clave)) {
      setError('Use al menos 12 caracteres, con letras y números.')
      return
    }
    // Confirma que quien cambia la contraseña la conoce: una sesión abierta y desatendida no basta.
    const verificada = await supabase.auth.signInWithPassword({ email, password: actual })
    if (verificada.error) { setError('La contraseña actual no es correcta.'); return }
    const { error } = await supabase.auth.updateUser({ password: clave })
    if (error) { setError(await mensajeError(error)); return }
    setError('')
    setActual('')
    setClave('')
    setRepetir('')
    setOk(true)
  }

  return (
    <section>
      <h2>Cambiar contraseña</h2>
      <form className="tarjeta" onSubmit={guardar}>
        <label>Contraseña actual<input type="password" autoComplete="current-password" required value={actual} onChange={(e) => setActual(e.target.value)} /></label>
        <label>Nueva contraseña<input type="password" autoComplete="new-password" required value={clave} onChange={(e) => setClave(e.target.value)} /></label>
        <label>Repetir contraseña<input type="password" autoComplete="new-password" required value={repetir} onChange={(e) => setRepetir(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        {ok && <p className="ok" role="status">Contraseña actualizada.</p>}
        <button type="submit">Guardar</button>
      </form>
    </section>
  )
}
