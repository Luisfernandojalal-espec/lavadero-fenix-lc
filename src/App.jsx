import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { db, seedIfEmpty } from './db'
import { startSync, sync } from './sync'
import { syncDisponible } from './supabase'
import { LOGO_URL, fechaLarga } from './format'
import { useAuth } from './auth'
import { SyncBadge } from './components/ui'
import Login from './pages/Login'
import Inicio from './pages/Inicio'
import Reportes from './pages/Reportes'
import Movimientos from './pages/Movimientos'
import Caja from './pages/Caja'
import Mesas from './pages/Mesas'
import Lavadores from './pages/Lavadores'
import Turno from './pages/Turno'
import Inventario from './pages/Inventario'
import Servicios from './pages/Servicios'
import Gastos from './pages/Gastos'
import Credito from './pages/Credito'

// `roles` = quién ve la pestaña. Sin `roles` = todos (Inicio/Mesas/Facturar/Turno).
const NAV = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/mesas', label: 'Mesas' },
  { to: '/factura', label: 'Facturar' },
  { to: '/turno', label: 'Turno' },
  { to: '/inventario', label: 'Inventario', roles: ['dueño', 'cajero'] },
  { to: '/historial', label: 'Historial', roles: ['dueño', 'cajero'] },
  { to: '/credito', label: 'Créditos', roles: ['dueño', 'cajero'] },
  { to: '/gastos', label: 'Gastos', roles: ['dueño'] },
  { to: '/balance', label: 'Balance', roles: ['dueño'] },
  { to: '/config', label: 'Admin', roles: ['dueño'] },
]

let inicializado = false

export default function App() {
  const [ready, setReady] = useState(false)
  const { user, logout } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (inicializado) { setReady(true); return }
    inicializado = true
    ;(async () => {
      if (syncDisponible && navigator.onLine) {
        try { await sync() } catch { /* sin conexión: seguimos local */ }
      }
      await seedIfEmpty()
      setReady(true)
      startSync()
    })()
  }, [])

  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])

  if (!ready) return <div className="empty">Cargando…</div>
  if (!user) return <Login />

  const esDueno = user.rol === 'dueño'
  const esCajero = user.rol === 'cajero'
  const navItems = NAV.filter((t) => !t.roles || t.roles.includes(user.rol))

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <img src={LOGO_URL} alt="Lavadero Fénix" />
          <div>
            <div className="tb-name">Lavadero Fénix LC</div>
            <div className="tb-sub">Sistema POS</div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="tb-user">{user.nombre}</span>
          <SyncBadge />
          <span className="tb-date">{fechaLarga()}</span>
          <button className="tb-salir" onClick={logout}>Salir</button>
        </div>
      </header>

      <nav className="tabnav">
        {navItems.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/mesas" element={<Mesas />} />
          <Route path="/factura" element={<Caja />} />
          <Route path="/turno" element={<Turno />} />
          {(esDueno || esCajero) ? (
            <>
              <Route path="/historial" element={<Movimientos />} />
              <Route path="/inventario" element={<Inventario />} />
              <Route path="/credito" element={<Credito />} />
            </>
          ) : null}
          {esDueno ? (
            <>
              <Route path="/lavadores" element={<Lavadores />} />
              <Route path="/gastos" element={<Gastos />} />
              <Route path="/balance" element={<Reportes />} />
              <Route path="/config" element={<Servicios />} />
            </>
          ) : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
