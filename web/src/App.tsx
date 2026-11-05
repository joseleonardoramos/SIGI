import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, mensajeError } from './supabase'
import Login from './Login'
import Empresas from './Empresas'
import Usuarios from './Usuarios'
import Importar from './Importar'
import Catalogo from './Catalogo'
import Gastos from './Gastos'
import Bitacora, { FueraHoy } from './Bitacora'
import Panel from './Panel'
import { MODULOS } from './modulos'

type Acceso = { empresa_id: string | null; rol: string; empresas: { nombre: string } | null }
type Empresa = { id: string; nombre: string; tema: string }
type Permisos = { esAdmin: boolean; escribe: boolean; personal: boolean }
type Entrada = { id: string; titulo: string; ver: (p: Permisos) => boolean }

const todos = () => true
// Menú por secciones. La interfaz solo oculta opciones; los permisos reales los aplica la base.
const MENU: { seccion: string; entradas: Entrada[] }[] = [
  { seccion: '', entradas: [{ id: 'inicio', titulo: 'Inicio', ver: todos }] },
  { seccion: 'Presupuesto', entradas: [
    { id: 'versiones', titulo: 'Versiones', ver: todos },
    { id: 'partidas', titulo: 'Partidas', ver: todos },
    { id: 'gastos', titulo: 'Gastos y evidencias', ver: todos },
  ] },
  { seccion: 'Operación', entradas: [
    { id: 'telecom', titulo: 'Telecomunicaciones', ver: todos },
    { id: 'flotas', titulo: 'Flotas', ver: todos },
    { id: 'software', titulo: 'Software', ver: todos },
  ] },
  { seccion: 'Activos y proyectos', entradas: [
    { id: 'activos', titulo: 'Activos', ver: todos },
    { id: 'reposiciones', titulo: 'Plan de reposición', ver: todos },
    { id: 'proyectos', titulo: 'Proyectos y aperturas', ver: todos },
  ] },
  { seccion: 'Personal', entradas: [
    { id: 'personas', titulo: 'Personal', ver: (p) => p.personal },
    { id: 'ausencias', titulo: 'Ausencias', ver: (p) => p.personal },
  ] },
  { seccion: 'Catálogos', entradas: [
    { id: 'proveedores', titulo: 'Proveedores', ver: todos },
    { id: 'cuentas_proveedor', titulo: 'Cuentas de proveedor', ver: todos },
    { id: 'cuentas_contables', titulo: 'Cuentas contables', ver: todos },
    { id: 'centros_costo', titulo: 'Centros de costo', ver: todos },
    { id: 'tasas', titulo: 'Tasas de cambio', ver: todos },
  ] },
  { seccion: 'Herramientas', entradas: [
    { id: 'importar', titulo: 'Importar CSV', ver: (p) => p.escribe },
    { id: 'bitacora', titulo: 'Bitácora', ver: (p) => p.personal },
  ] },
  { seccion: 'Administración', entradas: [
    { id: 'empresas', titulo: 'Empresas', ver: (p) => p.esAdmin },
    { id: 'usuarios', titulo: 'Usuarios y roles', ver: (p) => p.esAdmin },
  ] },
  { seccion: 'Cuenta', entradas: [{ id: 'clave', titulo: 'Cambiar contraseña', ver: todos }] },
]

function leerEmpresaGuardada(): string {
  try { return localStorage.getItem('sigi.empresa') ?? '' } catch { return '' }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [listo, setListo] = useState(false)
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresa, setEmpresa] = useState(leerEmpresaGuardada)
  const [vista, setVista] = useState('inicio')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setListo(true) })
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const usuarioId = session?.user.id
  useEffect(() => {
    if (!usuarioId) { setAccesos([]); setEmpresas([]); setVista('inicio'); return }
    supabase.from('membresias').select('empresa_id, rol, empresas(nombre)')
      .eq('usuario_id', usuarioId).eq('activo', true)
      .then(({ data }) => setAccesos((data ?? []) as unknown as Acceso[]))
    // RLS devuelve solo las empresas que este usuario puede ver.
    supabase.from('empresas').select('id, nombre, tema').eq('activo', true).order('nombre')
      .then(({ data }) => {
        const lista = (data ?? []) as Empresa[]
        setEmpresas(lista)
        setEmpresa((actual) => (lista.some((e) => e.id === actual) ? actual : lista[0]?.id ?? ''))
      })
  }, [usuarioId])

  useEffect(() => {
    try { if (empresa) localStorage.setItem('sigi.empresa', empresa) } catch { /* sin almacenamiento */ }
  }, [empresa])

  if (!listo) return null
  if (!session) return <Login />

  const esAdmin = accesos.some((a) => a.rol === 'Administrador')
  const rol = esAdmin ? 'Administrador' : accesos.find((a) => a.empresa_id === empresa)?.rol ?? ''
  const permisos: Permisos = { esAdmin, escribe: esAdmin || rol === 'Captura', personal: esAdmin || rol === 'Captura' }
  const actual = empresas.find((e) => e.id === empresa)
  const modulo = MODULOS[vista]
  const sinEmpresa = !empresa && !['inicio', 'clave', 'empresas', 'usuarios'].includes(vista)

  return (
    <div className="app" data-tema={actual?.tema ?? 'catador'}>
      <header>
        <strong>SIGI</strong>
        {empresas.length > 0 && (
          <label className="empresa">
            <span className="oculto">Empresa</span>
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} aria-label="Empresa">
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
        )}
        {rol && <span className="rol">{rol}</span>}
        <span className="usuario">{session.user.email}</span>
        <button className="secundario" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <div className="cuerpo">
        <nav aria-label="Principal">
          {MENU.map(({ seccion, entradas }) => {
            const visibles = entradas.filter((x) => x.ver(permisos))
            if (visibles.length === 0) return null
            return (
              <div key={seccion || 'general'}>
                {seccion && <p className="seccion">{seccion}</p>}
                {visibles.map((x) => (
                  <button key={x.id} className={vista === x.id ? 'activo' : ''} aria-current={vista === x.id ? 'page' : undefined} onClick={() => setVista(x.id)}>{x.titulo}</button>
                ))}
              </div>
            )
          })}
        </nav>
        <main>
          {sinEmpresa && <p className="nota">{esAdmin ? 'Cree primero una empresa en Administración → Empresas.' : 'Su usuario aún no tiene acceso a ninguna empresa. Pida al Administrador que le asigne un rol.'}</p>}
          {!sinEmpresa && (
            <>
              {vista === 'inicio' && <Inicio accesos={accesos} esAdmin={esAdmin} empresa={empresa} personal={permisos.personal} />}
              {modulo && <Catalogo key={modulo.id} modulo={modulo} empresa={empresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} />}
              {vista === 'gastos' && <Gastos empresa={empresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} />}
              {vista === 'bitacora' && permisos.personal && <Bitacora empresa={empresa} esAdmin={esAdmin} />}
              {vista === 'importar' && permisos.escribe && <Importar key={empresa} empresa={empresa} nombreEmpresa={actual?.nombre ?? ''} esAdmin={esAdmin} />}
              {vista === 'empresas' && esAdmin && <Empresas />}
              {vista === 'usuarios' && esAdmin && <Usuarios yo={session.user.id} />}
              {vista === 'clave' && <CambiarClave email={session.user.email ?? ''} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function Inicio({ accesos, esAdmin, empresa, personal }: { accesos: Acceso[]; esAdmin: boolean; empresa: string; personal: boolean }) {
  return (
    <section>
      <h2>Panel gerencial</h2>
      {empresa && <Panel empresa={empresa} personal={personal} />}
      <div className="tarjetas">
        <div className="tarjeta">
          <h3>Mis accesos</h3>
          <ul className="lista">
            {esAdmin && <li><b>Administrador</b> en todas las empresas</li>}
            {accesos.filter((a) => a.empresa_id).map((a) => (
              <li key={a.empresa_id}><b>{a.rol}</b> en {a.empresas?.nombre}</li>
            ))}
          </ul>
          <p className="nota">Si entró con una contraseña temporal, cámbiela en «Cambiar contraseña».</p>
        </div>
        {personal && empresa && <FueraHoy empresa={empresa} />}
      </div>
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
