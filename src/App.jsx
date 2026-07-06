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
import Ordenes from './pages/Ordenes'
import Lavadores from './pages/Lavadores'
import Turno from './pages/Turno'
import Inventario from './pages/Inventario'
import Servicios from './pages/Servicios'
import Gastos from './pages/Gastos'
import Credito from './pages/Credito'

const NAV = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/ordenes', label: 'Órdenes' },
  { to: '/mesas', label: 'Mesas' },
  { to: '/factura', label: 'Facturar' },
  { to: '/turno', label: 'Turno' },
  { to: '/inventario', label: 'Inventario', soloDueno: true },
  { to: '/historial', label: 'Historial', soloDueno: true },
  { to: '/credito', label: 'Créditos', soloDueno: true },
  { to: '/gastos', label: 'Gastos', soloDueno: true },
  { to: '/balance', label: 'Balance', soloDueno: true },
  { to: '/config', label: 'Admin', soloDueno: true },
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
  const navItems = NAV.filter((t) => esDueno || !t.soloDueno)

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
          <Route path="/ordenes" element={<Ordenes />} />
          <Route path="/mesas" element={<Mesas />} />
          <Route path="/factura" element={<Caja />} />
          <Route path="/turno" element={<Turno />} />
          {esDueno ? (
            <>
              <Route path="/lavadores" element={<Lavadores />} />
              <Route path="/historial" element={<Movimientos />} />
              <Route path="/inventario" element={<Inventario />} />
              <Route path="/credito" element={<Credito />} />
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
