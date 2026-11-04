// Prueba que solo el Administrador pueda crear usuarios. Ejecutar: npm run test:funciones
// Requiere Supabase local en marcha y en .env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY y los usuarios SIGI_PRUEBA_*.
// No crea datos: el caso del Administrador usa un correo que ya existe y espera 409.
import assert from 'node:assert/strict'

const e = process.env
const url = e.VITE_SUPABASE_URL
const apikey = e.VITE_SUPABASE_PUBLISHABLE_KEY
for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SIGI_PRUEBA_ADMIN_EMAIL', 'SIGI_PRUEBA_ADMIN_PASSWORD', 'SIGI_PRUEBA_CAPTURA_EMAIL', 'SIGI_PRUEBA_CAPTURA_PASSWORD']) {
  assert.ok(e[k], `Falta ${k} en .env`)
}

async function token(email, password) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(r.status, 200, `No se pudo entrar como ${email}`)
  return (await r.json()).access_token
}

async function crear(bearer) {
  const headers = { apikey, 'Content-Type': 'application/json' }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const r = await fetch(`${url}/functions/v1/usuarios`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: e.SIGI_PRUEBA_CAPTURA_EMAIL, password: 'Intento12345678' }),
  })
  return r.status
}

// Sin sesión lo rechaza la pasarela (401) o el control de Administrador (403); ambos son un rechazo.
assert.ok([401, 403].includes(await crear(null)), 'Sin sesión debe rechazarse')
assert.equal(await crear(await token(e.SIGI_PRUEBA_CAPTURA_EMAIL, e.SIGI_PRUEBA_CAPTURA_PASSWORD)), 403, 'Captura no debe crear usuarios')
assert.equal(await crear(await token(e.SIGI_PRUEBA_ADMIN_EMAIL, e.SIGI_PRUEBA_ADMIN_PASSWORD)), 409, 'El Administrador pasa el control (correo repetido = 409)')
console.log('Función usuarios: 3 pruebas correctas.')
