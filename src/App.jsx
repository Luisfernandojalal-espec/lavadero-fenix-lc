import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { db, seedIfEmpty } from './db'
import { startSync, sync } from './sync'
import { syncDisponible } from './supabase'
import { LOGO_URL } from './format'
import { useAuth } from './auth'
import { SyncBadge } from './components/ui'
import Login from './pages/Login'
import Reportes from './pages/Reportes'
import Movimientos from './pages/Movimientos'
import Caja from './pages/Caja'
import Productos from './pages/Productos'
import Servicios from './pages/Servicios'
import Gastos from './pages/Gastos'

const TABS = [
  { to: '/', ico: '📊', label: 'Inicio', end: true, soloDueno: true },
  { to: '/caja', ico: '🧾', label: 'Caja' },
  { to: '/productos', ico: '🛒', label: 'Productos', soloDueno: true },
  { to: '/servicios', ico: '🚿', label: 'Servicios', soloDueno: true },
  { to: '/gastos', ico: '🏠', label: 'Gastos', soloDueno: true },
]

export default function App() {
  const [ready, setReady] = useState(false)
  const { user, logout } = useAuth()
  const location = useLocation()

  useEffect(() => {
    (async () => {
      // En un dispositivo nuevo (sin datos) y con internet, primero bajamos
      // lo que ya exista en la nube; así NO sembramos datos de ejemplo
      // duplicados. Si ya hay datos locales, arrancamos al instante (offline-first).
      const vacio = (await db.productos.count()) === 0
      if (vacio && syncDisponible && navigator.onLine) {
        try { await sync() } catch { /* sin conexión: seguimos local */ }
      }
      await seedIfEmpty() // solo siembra si después de bajar sigue vacío
      setReady(true)
      startSync() // sincronización continua con la nube (si está configurada)
    })()
  }, [])

  // Lleva el scroll arriba al cambiar de pestaña
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  if (!ready) {
    return <div className="empty">Cargando…</div>
  }

  // Sin sesión → pantalla de acceso
  if (!user) {
    return <Login />
  }

  const esDueno = user.rol === 'dueño'
  const tabs = TABS.filter((t) => esDueno || !t.soloDueno)

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">
          <img src={LOGO_URL} alt="Lavadero Fénix" />
          <span>Lavadero Fénix</span>
        </div>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="ico">{t.ico}</span>
            <span>{t.label}</span>
          </NavLink>
        ))}
        <button className="nav-logout" onClick={logout} title={`Salir (${user.nombre})`}>
          <span className="ico">⏻</span>
          <span>Salir</span>
        </button>
      </nav>

      <main className="main">
        <SyncBadge />
        <Routes>
          {esDueno ? (
            <>
              <Route path="/" element={<Reportes />} />
              <Route path="/movimientos" element={<Movimientos />} />
              <Route path="/caja" element={<Caja />} />
              <Route path="/productos" element={<Productos />} />
              <Route path="/servicios" element={<Servicios />} />
              <Route path="/gastos" element={<Gastos />} />
            </>
          ) : (
            // El trabajador solo tiene acceso a la Caja
            <>
              <Route path="/caja" element={<Caja />} />
              <Route path="*" element={<Navigate to="/caja" replace />} />
            </>
          )}
        </Routes>
      </main>
    </div>
  )
}
