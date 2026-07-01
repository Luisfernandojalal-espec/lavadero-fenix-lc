import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { LOGO_URL } from '../format'
import { useAuth } from '../auth'

// Teclado numérico para el PIN
function PinPad({ value, onChange }) {
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
  function pulsar(k) {
    if (k === '') return
    if (k === '⌫') return onChange(value.slice(0, -1))
    if (value.length < 4) onChange(value + k)
  }
  return (
    <>
      <div className="pin-dots">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`pin-dot ${i < value.length ? 'on' : ''}`} />
        ))}
      </div>
      <div className="pin-pad">
        {teclas.map((k, i) => (
          <button key={i} className={`pin-key ${k === '' ? 'empty' : ''}`} onClick={() => pulsar(k)} disabled={k === ''}>
            {k}
          </button>
        ))}
      </div>
    </>
  )
}

export default function Login() {
  const { login } = useAuth()
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], undefined)

  const [sel, setSel] = useState(null)     // usuario elegido para poner PIN
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  // Estado del modo "primera vez" (crear dueño)
  const [setupNombre, setSetupNombre] = useState('Administrador')
  const [setupPin, setSetupPin] = useState('')

  if (trabajadores === undefined) {
    return <div className="empty">Cargando…</div>
  }

  const hayDueno = trabajadores.some((t) => t.rol === 'dueño')
  const usuarios = trabajadores.filter((t) => t.pin) // solo quienes ya tienen PIN

  // --- Modo primera vez: crear el usuario dueño ---
  if (!hayDueno) {
    async function crearDueno() {
      if (!setupNombre.trim()) return setError('Escribe un nombre')
      if (setupPin.length !== 4) return setError('El PIN debe tener 4 dígitos')
      const nuevo = stamp({ id: uid(), activo: 1, nombre: setupNombre.trim(), rol: 'dueño', pin: setupPin })
      await db.trabajadores.add(nuevo)
      login(nuevo)
    }
    return (
      <div className="login">
        <img src={LOGO_URL} alt="Lavadero Fénix" className="login-logo" />
        <h1>Bienvenido</h1>
        <p className="login-sub">Vamos a crear el usuario <b>dueño</b>. Serás quien vea las ganancias y administre todo.</p>

        <label>Tu nombre</label>
        <input value={setupNombre} onChange={(e) => setSetupNombre(e.target.value)} placeholder="Ej: Luis" />

        <label>Crea tu PIN (4 dígitos)</label>
        <PinPad value={setupPin} onChange={(v) => { setSetupPin(v); setError('') }} />

        {error && <div className="login-error">{error}</div>}
        <button className="btn" style={{ marginTop: 16 }} onClick={crearDueno} disabled={setupPin.length !== 4}>
          Crear mi cuenta y entrar
        </button>
      </div>
    )
  }

  // --- Modo normal: elegir usuario y poner PIN ---
  function elegir(u) {
    setSel(u); setPin(''); setError('')
  }
  function verificar(nuevoPin) {
    setPin(nuevoPin); setError('')
    if (nuevoPin.length === 4) {
      if (nuevoPin === sel.pin) login(sel)
      else { setError('PIN incorrecto'); setTimeout(() => setPin(''), 400) }
    }
  }

  if (sel) {
    return (
      <div className="login">
        <div className="login-avatar">{sel.rol === 'dueño' ? '👨🏻‍💻' : '👤'}</div>
        <h1>{sel.nombre}</h1>
        <p className="login-sub">Ingresa tu PIN</p>
        <PinPad value={pin} onChange={verificar} />
        {error && <div className="login-error">{error}</div>}
        <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => setSel(null)}>← Cambiar de usuario</button>
      </div>
    )
  }

  return (
    <div className="login">
      <img src={LOGO_URL} alt="Lavadero Fénix" className="login-logo" />
      <h1>¿Quién eres?</h1>
      <p className="login-sub">Toca tu usuario para entrar</p>
      <div className="login-users">
        {usuarios.map((u) => (
          <button key={u.id} className="login-user" onClick={() => elegir(u)}>
            <span className="login-user-ico">{u.rol === 'dueño' ? '👨🏻‍💻' : '👤'}</span>
            <span>{u.nombre}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
