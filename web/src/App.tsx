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

// Íconos de trazo (24×24) del menú, como en el diseño del menú en acordeón.
const Icono = ({ d, tam = 18, className }: { d: string; tam?: number; className?: string }) => (
  <svg aria-hidden="true" className={className} width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)

const todos = () => true
// Menú por secciones en acordeón. La interfaz solo oculta opciones; los permisos reales los aplica la base.
const MENU: { seccion: string; icono: string; entradas: Entrada[] }[] = [
  { seccion: '', icono: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z', entradas: [{ id: 'inicio', titulo: 'Inicio', ver: todos }] },
  { seccion: 'Presupuesto', icono: 'M4 20V10M10 20V4M16 20v-7M22 20H2', entradas: [
    { id: 'versiones', titulo: 'Versiones', ver: todos },
    { id: 'partidas', titulo: 'Presupuesto y ejecución', ver: todos },
    { id: 'ahorros', titulo: 'Ahorros', ver: todos },
    { id: 'comparar', titulo: 'Comparar versiones', ver: todos },
    { id: 'gastos', titulo: 'Gastos y evidencias', ver: todos },
  ] },
  { seccion: 'Operación', icono: 'M12 20v-8M8.5 8.5a5 5 0 0 1 7 0M5.5 5.5a9 9 0 0 1 13 0M12 12h.01', entradas: [
    { id: 'telecom', titulo: 'Telecomunicaciones', ver: todos },
    { id: 'flotas', titulo: 'Flotas', ver: todos },
    { id: 'software', titulo: 'Software', ver: todos },
  ] },
  { seccion: 'Activos y proyectos', icono: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8', entradas: [
    { id: 'activos', titulo: 'Activos', ver: todos },
    { id: 'reposiciones', titulo: 'Plan de reposición', ver: todos },
    { id: 'proyectos', titulo: 'Proyectos y aperturas', ver: todos },
  ] },
  { seccion: 'Personal', icono: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8', entradas: [
    { id: 'personas', titulo: 'Personal y ausencias', ver: (p) => p.personal },
  ] },
  { seccion: 'Catálogos', icono: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5', entradas: [
    { id: 'proveedores', titulo: 'Proveedores y cuentas', ver: todos },
    { id: 'centros_costo', titulo: 'Centros de costo', ver: todos },
    { id: 'areas', titulo: 'Áreas', ver: todos },
    { id: 'departamentos', titulo: 'Departamentos', ver: todos },
    { id: 'tasas', titulo: 'Tasas de cambio', ver: todos },
    { id: 'feriados', titulo: 'Feriados', ver: todos },
  ] },
  { seccion: 'Herramientas', icono: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z', entradas: [
    { id: 'importar', titulo: 'Importar CSV', ver: (p) => p.escribe },
    { id: 'bitacora', titulo: 'Bitácora', ver: (p) => p.personal },
  ] },
  { seccion: 'Administración', icono: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', entradas: [
    { id: 'empresas', titulo: 'Empresas', ver: (p) => p.esAdmin },
    { id: 'usuarios', titulo: 'Usuarios y roles', ver: (p) => p.esAdmin },
  ] },
  { seccion: 'Cuenta', icono: 'M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', entradas: [{ id: 'clave', titulo: 'Cambiar contraseña', ver: todos }] },
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
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set()) // secciones del menú abiertas (varias a la vez)

  // Al cambiar de pantalla (menú o enlaces de las pantallas): se abre su sección y se va al inicio de la página.
  useEffect(() => {
    const s = MENU.find((m) => m.entradas.some((x) => x.id === vista))?.seccion
    if (s) setAbiertas((prev) => (prev.has(s) ? prev : new Set(prev).add(s)))
    window.scrollTo({ top: 0 })
  }, [vista])

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
          {MENU.map(({ seccion, icono, entradas }) => {
            const visibles = entradas.filter((x) => x.ver(permisos))
            if (visibles.length === 0) return null
            const opcion = (x: Entrada, conIcono = false) => (
              <button key={x.id} className={`${conIcono ? 'suelta ' : ''}${vista === x.id ? 'activo' : ''}`} aria-current={vista === x.id ? 'page' : undefined}
                onClick={() => { setVista(x.id); window.scrollTo({ top: 0 }) }}>
                {conIcono && <Icono d={icono} />}{x.titulo}
              </button>
            )
            if (!seccion) return visibles.map((x) => opcion(x, true)) // Inicio: suelta, sin acordeón
            const abierta = abiertas.has(seccion)
            const contiene = visibles.some((x) => x.id === vista)
            return (
              <div key={seccion} className="grupo">
                <button className={`seccion${contiene ? ' contiene' : ''}`} aria-expanded={abierta}
                  onClick={() => setAbiertas((prev) => { const n = new Set(prev); if (n.has(seccion)) n.delete(seccion); else n.add(seccion); return n })}>
                  <Icono d={icono} />
                  <span className="titulo">{seccion}</span>
                  {!abierta && contiene && <span className="punto" title="Aquí está la pantalla actual"><span className="oculto">(pantalla actual)</span></span>}
                  <Icono d="m9 6 6 6-6 6" tam={16} className="flecha" />
                </button>
                {abierta && <div className="opciones">{visibles.map((x) => opcion(x))}</div>}
              </div>
            )
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
