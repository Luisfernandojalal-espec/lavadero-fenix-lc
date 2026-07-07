import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, labelRol } from '../db'
import { LOGO_URL } from '../format'
import { useAuth } from '../auth'

const norm = (s) => String(s || '').trim().toLowerCase()

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

  const [sel, setSel] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  // Setup (crear dueño)
  const [setupNombre, setSetupNombre] = useState('Administrador')
  const [setupPin, setSetupPin] = useState('')
  const [setupPreg, setSetupPreg] = useState('')
  const [setupResp, setSetupResp] = useState('')

  // Recuperación de PIN
  const [recup, setRecup] = useState(null) // null | 'pregunta' | 'nuevopin'
  const [resp, setResp] = useState('')
  const [nuevoPin, setNuevoPin] = useState('')

  if (trabajadores === undefined) return <div className="empty">Cargando…</div>

  const hayDueno = trabajadores.some((t) => t.rol === 'dueño')
  const usuarios = trabajadores.filter((t) => t.pin)

  // --- Primera vez: crear el usuario dueño ---
  if (!hayDueno) {
    async function crearDueno() {
      if (!setupNombre.trim()) return setError('Escribe un nombre')
      if (setupPin.length !== 4) return setError('El PIN debe tener 4 dígitos')
      if (!setupPreg.trim() || !setupResp.trim()) return setError('Configura la pregunta y respuesta de seguridad')
      const nuevo = stamp({
        id: uid(), activo: 1, nombre: setupNombre.trim(), rol: 'dueño', pin: setupPin,
        pregunta: setupPreg.trim(), respuesta: norm(setupResp),
      })
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

        <label>Pregunta de seguridad (para recuperar el PIN)</label>
        <input value={setupPreg} onChange={(e) => setSetupPreg(e.target.value)} placeholder="Ej: ¿Nombre de mi primera mascota?" />
        <label>Respuesta</label>
        <input value={setupResp} onChange={(e) => setSetupResp(e.target.value)} placeholder="Tu respuesta secreta" />

        <label>Crea tu PIN (4 dígitos)</label>
        <PinPad value={setupPin} onChange={(v) => { setSetupPin(v); setError('') }} />

        {error && <div className="login-error">{error}</div>}
        <button className="btn" style={{ marginTop: 16 }} onClick={crearDueno} disabled={setupPin.length !== 4}>
          Crear mi cuenta y entrar
        </button>
      </div>
    )
  }

  // --- Elegir usuario / poner PIN ---
  function elegir(u) { setSel(u); setPin(''); setError(''); setRecup(null); setResp(''); setNuevoPin('') }
  function volver() { setSel(null); setRecup(null); setError('') }

  function verificar(nuevo) {
    setPin(nuevo); setError('')
    if (nuevo.length === 4) {
      if (nuevo === sel.pin) login(sel)
      else { setError('PIN incorrecto'); setTimeout(() => setPin(''), 400) }
    }
  }

  function iniciarRecuperacion() {
    if (!sel.pregunta || !sel.respuesta) {
      setError('Este usuario no tiene pregunta de seguridad. Pídele a un administrador que te la configure en Admin → Trabajadores.')
      return
    }
    setError(''); setResp(''); setRecup('pregunta')
  }
  function verificarRespuesta() {
    if (norm(resp) === sel.respuesta) { setError(''); setNuevoPin(''); setRecup('nuevopin') }
    else setError('Respuesta incorrecta')
  }
  async function ponerNuevoPin(v) {
    setNuevoPin(v); setError('')
    if (v.length === 4) {
      await db.trabajadores.update(sel.id, stamp({ pin: v }))
      login({ ...sel, pin: v })
    }
  }

  if (sel && recup === 'pregunta') {
    return (
      <div className="login">
        <h1>Recuperar PIN</h1>
        <p className="login-sub">Responde tu pregunta de seguridad</p>
        <label>{sel.pregunta}</label>
        <input value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Tu respuesta" />
        {error && <div className="login-error">{error}</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={verificarRespuesta}>Verificar</button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={volver}>← Volver</button>
      </div>
    )
  }

  if (sel && recup === 'nuevopin') {
    return (
      <div className="login">
        <div className="login-avatar">{sel.nombre.charAt(0).toUpperCase()}</div>
        <h1>Nuevo PIN</h1>
        <p className="login-sub">Crea tu nuevo PIN de 4 dígitos</p>
        <PinPad value={nuevoPin} onChange={ponerNuevoPin} />
        {error && <div className="login-error">{error}</div>}
      </div>
    )
  }

  if (sel) {
    return (
      <div className="login">
        <div className="login-avatar">{sel.nombre.charAt(0).toUpperCase()}</div>
        <h1>{sel.nombre}</h1>
        <p className="login-sub">Ingresa tu PIN</p>
        <PinPad value={pin} onChange={verificar} />
        {error && <div className="login-error">{error}</div>}
        <button className="login-link" onClick={iniciarRecuperacion}>¿Olvidaste tu PIN?</button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={volver}>← Cambiar de usuario</button>
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
            <span className="login-user-ini">{u.nombre.charAt(0).toUpperCase()}</span>
            <span className="login-user-main">
              <span className="login-user-nombre">{u.nombre}</span>
              <span className="login-user-rol">{labelRol(u.rol)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
