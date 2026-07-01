import { useEffect, useState, useCallback } from 'react'
import { subscribeSync, sync } from '../sync'
import { syncDisponible, sesionNube, conectarNube, desconectarNube } from '../supabase'

// Indicador del estado de la nube + panel para conectar el dispositivo
export function SyncBadge() {
  const [estado, setEstado] = useState({ fase: 'idle' })
  const [abierto, setAbierto] = useState(false)
  useEffect(() => subscribeSync(setEstado), [])
  if (!syncDisponible) return null

  const mapa = {
    idle: { txt: 'Nube', cls: 'muted' },
    sincronizando: { txt: 'Sincronizando', cls: 'sync' },
    ok: { txt: 'Sincronizado', cls: 'ok' },
    offline: { txt: 'Sin conexión', cls: 'off' },
    auth: { txt: 'Conectar', cls: 'err' },
    error: { txt: 'Error de nube', cls: 'err' },
  }
  const e = mapa[estado.fase] || mapa.idle
  return (
    <>
      <button className={`sync-badge ${e.cls}`} onClick={() => setAbierto(true)} title="Estado de la nube">
        <span className="sync-dot" />
        <span className="sync-txt">{e.txt}</span>
      </button>
      <NubeSheet open={abierto} onClose={() => setAbierto(false)} estado={estado} />
    </>
  )
}

// Panel de gestión de la nube
function NubeSheet({ open, onClose, estado }) {
  const [conectado, setConectado] = useState(null) // null=cargando, true/false
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState('')
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!open) return
    setMsg('')
    sesionNube().then((s) => setConectado(Boolean(s)))
  }, [open])

  async function conectar() {
    if (!email.trim() || !pass) return setMsg('Escribe el correo y el código')
    setCargando(true); setMsg('')
    try {
      await conectarNube(email, pass)
      setConectado(true)
      setPass('')
      await sync()
      setMsg('Dispositivo conectado')
    } catch (err) {
      setMsg('No pude conectar: ' + (err?.message || 'revisa el correo y el código'))
    } finally {
      setCargando(false)
    }
  }

  async function desconectar() {
    await desconectarNube()
    setConectado(false)
    setMsg('Dispositivo desconectado')
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nube / Sincronización">
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="main">
          <div className="title">Estado</div>
          <div className="meta">
            {estado.fase === 'ok' && 'Todo sincronizado'}
            {estado.fase === 'sincronizando' && 'Sincronizando…'}
            {estado.fase === 'offline' && 'Sin conexión a internet'}
            {estado.fase === 'auth' && 'Este dispositivo necesita conectarse'}
            {estado.fase === 'error' && 'Hubo un error al sincronizar'}
            {estado.fase === 'idle' && 'Listo'}
          </div>
        </div>
        <button className="btn ghost" style={{ width: 'auto' }} onClick={() => sync()}>Sincronizar</button>
      </div>

      {conectado === true ? (
        <>
          <div className="helper" style={{ marginBottom: 12 }}>Este dispositivo está conectado a la nube del negocio.</div>
          <button className="btn ghost" onClick={desconectar}>Desconectar este dispositivo</button>
        </>
      ) : (
        <>
          <div className="helper" style={{ marginBottom: 4 }}>
            Conecta este dispositivo con el <b>correo y código del negocio</b> (te los da el dueño). Solo se hace una vez por celular.
          </div>
          <label>Correo del negocio</label>
          <input type="email" inputMode="email" autoCapitalize="none" value={email}
            placeholder="ej: lavadero@fenix.app" onChange={(e) => setEmail(e.target.value)} />
          <label>Código del negocio</label>
          <input type="password" value={pass} placeholder="••••••••" onChange={(e) => setPass(e.target.value)} />
          <div style={{ height: 14 }} />
          <button className="btn" onClick={conectar} disabled={cargando}>
            {cargando ? 'Conectando…' : 'Conectar dispositivo'}
          </button>
        </>
      )}

      {msg && <div className="helper" style={{ marginTop: 12, color: msg.startsWith('No pude') ? 'var(--red)' : 'var(--green)' }}>{msg}</div>}
    </Sheet>
  )
}

export function Header({ title, sub, onBack }) {
  return (
    <header className="header">
      {onBack && (
        <button className="back-btn" onClick={onBack} aria-label="Volver">‹ Inicio</button>
      )}
      <h1>{title}</h1>
      {sub && <div className="sub">{sub}</div>}
    </header>
  )
}

// Hoja modal que sube desde abajo (estilo app móvil)
export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  )
}

// Hook simple para mostrar un mensaje flotante de confirmación
export function useToast() {
  const [msg, setMsg] = useState(null)
  const show = useCallback((text) => {
    setMsg(text)
    setTimeout(() => setMsg(null), 1800)
  }, [])
  const node = msg ? <div className="toast">{msg}</div> : null
  return { show, node }
}

// Selector con barra de búsqueda (reemplaza las listas desplegables).
// options: [{ value, label }]
export function SearchSelect({ value, onChange, options, placeholder }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const sel = options.find((o) => o.value === value)
  const filtradas = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options

  return (
    <div className="search-select">
      <input
        value={open ? q : (sel ? sel.label : '')}
        placeholder={placeholder || 'Buscar…'}
        onFocus={() => { setOpen(true); setQ('') }}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="search-options">
          {filtradas.map((o) => (
            <div key={o.value} className="search-option"
              onMouseDown={() => { onChange(o.value); setOpen(false) }}>
              {o.label}
            </div>
          ))}
          {filtradas.length === 0 && <div className="search-option vacio">Sin resultados</div>}
        </div>
      )}
    </div>
  )
}

// Input de dinero con separador de miles automático
export function MoneyInput({ value, onChange, placeholder }) {
  const formatted = value ? new Intl.NumberFormat('es-CO').format(value) : ''
  return (
    <input
      inputMode="numeric"
      placeholder={placeholder || '0'}
      value={formatted}
      onChange={(e) => {
        const n = e.target.value.replace(/[^\d]/g, '')
        onChange(n ? parseInt(n, 10) : 0)
      }}
    />
  )
}
