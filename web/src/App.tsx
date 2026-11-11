import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, mensajeError } from './supabase'
import Login from './Login'
import Empresas from './Empresas'
import Usuarios from './Usuarios'
import Importar from './Importar'
import Catalogo from './Catalogo'
import Gastos from './Gastos'
import Bitacora from './Bitacora'
import Panel from './Panel'
import Comparar from './Comparar'
import Telecom from './Telecom'
import Flotas from './Flotas'
import Software from './Software'
import Personal from './Personal'
import ProveedoresCuentas from './ProveedoresCuentas'
import Presupuestos from './Presupuestos'
import Ahorros from './Ahorros'
import { MODULOS } from './modulos'

type Acceso = { empresa_id: string | null; rol: string; empresas: { nombre: string } | null }
type Empresa = { id: string; nombre: string; tema: string; moneda_reporte: string }

// Sello del menú, como en el diseño: iniciales de la empresa (El Catador → EC, Bona → B).
const sello = (nombre?: string) => (nombre ?? 'SIGI').split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'SI'
type Permisos = { esAdmin: boolean; escribe: boolean; personal: boolean }
type Entrada = { id: string; titulo: string; ver: (p: Permisos) => boolean }

const todos = () => true
// Menú por secciones. La interfaz solo oculta opciones; los permisos reales los aplica la base.
const MENU: { seccion: string; entradas: Entrada[] }[] = [
  { seccion: '', entradas: [{ id: 'inicio', titulo: 'Inicio', ver: todos }] },
  { seccion: 'Presupuesto', entradas: [
    { id: 'versiones', titulo: 'Versiones', ver: todos },
    { id: 'partidas', titulo: 'Presupuesto y ejecución', ver: todos },
    { id: 'ahorros', titulo: 'Ahorros', ver: todos },
    { id: 'comparar', titulo: 'Comparar versiones', ver: todos },
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
    { id: 'personas', titulo: 'Personal y ausencias', ver: (p) => p.personal },
  ] },
  { seccion: 'Catálogos', entradas: [
    { id: 'proveedores', titulo: 'Proveedores y cuentas', ver: todos },
    { id: 'centros_costo', titulo: 'Centros de costo', ver: todos },
    { id: 'areas', titulo: 'Áreas', ver: todos },
    { id: 'departamentos', titulo: 'Departamentos', ver: todos },
    { id: 'tasas', titulo: 'Tasas de cambio', ver: todos },
    { id: 'feriados', titulo: 'Feriados', ver: todos },
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
    supabase.from('empresas').select('id, nombre, tema, moneda_reporte').eq('activo', true).order('nombre')
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
  // Pantallas propias (diseño); su formulario sigue saliendo de MODULOS.
  const propias = ['inicio', 'telecom', 'flotas', 'software', 'personas', 'ausencias', 'gastos', 'proveedores', 'cuentas_proveedor', 'cuentas_contables', 'partidas', 'ahorros']
  const modulo = propias.includes(vista) ? undefined : MODULOS[vista]
  const conCabeceraPropia = propias.includes(vista)
  const sinEmpresa = !empresa && !['inicio', 'clave', 'empresas', 'usuarios'].includes(vista)

  const seccion = MENU.find((s) => s.entradas.some((x) => x.id === vista))
  const corte = new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="app" data-tema={actual?.tema ?? 'catador'}>
      <aside className="lateral">
        <div className="marca">
          <span className="sello" aria-hidden="true">{sello(actual?.nombre)}</span>
          <div><strong>SIGI</strong><span>{actual?.nombre ?? 'Sin empresa'}</span></div>
        </div>
        <nav aria-label="Módulos de SIGI">
          {MENU.map(({ seccion, entradas }) => {
            const visibles = entradas.filter((x) => x.ver(permisos))
            if (visibles.length === 0) return null
            return [
              seccion && <p key={`s-${seccion}`} className="seccion">{seccion}</p>,
              ...visibles.map((x) => (
                <button key={x.id} className={vista === x.id ? 'activo' : ''} aria-current={vista === x.id ? 'page' : undefined} onClick={() => setVista(x.id)}>{x.titulo}</button>
              )),
            ]
          })}
        </nav>
        <div className="pie">
          <span>{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </aside>
      <div className="contenido">
        {!conCabeceraPropia && <header className="cabecera">
          <span className="ruta">
            {seccion?.seccion || 'Control'} · Ambiente <b>{actual?.nombre ?? '—'}</b> · Corte al {corte}{actual && ` · Moneda de reporte ${actual.moneda_reporte}`}
          </span>
          <div className="fila-controles" style={{ margin: 0 }}>
            {rol && <span className="rol">{rol}</span>}
            {empresas.length > 0 && (
              <label className="empresa">
                <span className="oculto">Empresa</span>
                <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} aria-label="Empresa">
                  {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </label>
            )}
          </div>
        </header>}
        <main>
          {sinEmpresa && <p className="nota">{esAdmin ? 'Cree primero una empresa en Administración → Empresas.' : 'Su usuario aún no tiene acceso a ninguna empresa. Pida al Administrador que le asigne un rol.'}</p>}
          {!sinEmpresa && (
            <>
              {vista === 'inicio' && <Panel empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} personal={permisos.personal} ir={setVista} />}
              {vista === 'telecom' && <Telecom empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} ir={setVista} />}
              {vista === 'flotas' && <Flotas empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} ir={setVista} />}
              {vista === 'software' && <Software empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} ir={setVista} />}
              {(vista === 'personas' || vista === 'ausencias') && permisos.personal && <Personal empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} esAdmin={esAdmin} ir={setVista} />}
              {modulo && <Catalogo key={modulo.id} modulo={modulo} empresa={empresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} />}
              {vista === 'comparar' && <Comparar key={empresa} empresa={empresa} moneda={actual?.moneda_reporte ?? 'RD$'} />}
              {vista === 'gastos' && <Gastos empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} ir={setVista} />}
              {vista === 'partidas' && <Presupuestos empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} ir={setVista} />}
              {vista === 'ahorros' && <Ahorros empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} puedeEscribir={permisos.escribe} esAdmin={esAdmin} ir={setVista} />}
              {['proveedores', 'cuentas_proveedor', 'cuentas_contables'].includes(vista) && <ProveedoresCuentas empresas={empresas} empresa={empresa} setEmpresa={setEmpresa} esAdmin={esAdmin} ir={setVista} />}
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
