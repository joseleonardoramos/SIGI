// Crea el primer Administrador de SIGI (o promueve un usuario existente).
// Uso:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin:crear -- correo@empresa.com 'ContraseñaSegura123'
// En local, los valores salen de: npx supabase status -o env (API_URL y SERVICE_ROLE_KEY).
// La clave de servicio da acceso total: úsela solo en su máquina y nunca la guarde en el repositorio.

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const [email, password] = process.argv.slice(2)

if (!url || !key) throw new Error('Defina SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.')
if (!email || !password) throw new Error('Uso: npm run admin:crear -- correo contraseña')
if (password.length < 12 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  throw new Error('La contraseña debe tener al menos 12 caracteres, con letras y números.')
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function pedir(ruta, opciones = {}) {
  const r = await fetch(url + ruta, { ...opciones, headers: { ...headers, ...opciones.headers } })
  const texto = await r.text()
  let cuerpo = null
  try {
    cuerpo = texto ? JSON.parse(texto) : null
  } catch {
    // Página de error u otra respuesta que no es JSON (por ejemplo, Supabase apagado detrás de un proxy).
    cuerpo = { respuesta: texto.slice(0, 200) }
  }
  return { ok: r.ok, status: r.status, cuerpo }
}

const creado = await pedir('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email, password, email_confirm: true }),
})
let id = creado.cuerpo?.id
if (!creado.ok) {
  if (creado.status !== 422) throw new Error(`No se pudo crear el usuario: ${JSON.stringify(creado.cuerpo)}`)
  // Ya existe: se busca para promoverlo.
  const lista = await pedir('/auth/v1/admin/users?per_page=1000')
  id = lista.cuerpo?.users?.find((u) => u.email === email.toLowerCase())?.id
  if (!id) throw new Error('El usuario existe pero no se encontró.')
  console.log('El usuario ya existía; se le asigna el rol de Administrador.')
}

const rol = await pedir('/rest/v1/membresias?on_conflict=usuario_id,empresa_id,rol', {
  method: 'POST',
  headers: { Prefer: 'resolution=ignore-duplicates' },
  body: JSON.stringify({ usuario_id: id, empresa_id: null, rol: 'Administrador' }),
})
if (!rol.ok) throw new Error(`No se pudo asignar el rol: ${JSON.stringify(rol.cuerpo)}`)
console.log(`Administrador listo: ${email}`)
