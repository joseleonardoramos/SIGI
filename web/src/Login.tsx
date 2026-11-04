import { useState, type FormEvent } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setEnviando(false)
    // Mensaje genérico: no revela si el correo existe.
    if (error) setError('Correo o contraseña incorrectos.')
  }

  return (
    <main className="login">
      <form className="tarjeta" onSubmit={entrar}>
        <h1>SIGI</h1>
        <p className="sub">Sistema Integral de Gestión de Infraestructura</p>
        <label>
          Correo
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  )
}
