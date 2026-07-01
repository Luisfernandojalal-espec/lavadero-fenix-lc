import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { db, seedIfEmpty } from './db'
import { startSync, sync } from './sync'
import { syncDisponible } from './supabase'
import { LOGO_URL } from './format'
import { useAuth } from './auth'
import { SyncBadge } from './components/ui'
import Login from './pages/Login'
import Inicio from './pages/Inicio'
import Reportes from './pages/Reportes'
import Movimientos from './pages/Movimientos'
import Caja from './pages/Caja'
import Inventario from './pages/Inventario'
import Servicios from './pages/Servicios'
import Gastos from './pages/Gastos'
import Credito from './pages/Credito'

// Barra lateral (solo escritorio). En móvil la navegación es por el menú de Inicio.
const NAV = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/factura', label: 'Factura rápida' },
  { to: '/historial', label: 'Historial', soloDueno: true },
  { to: '/inventario', label: 'Inventario', soloDueno: true },
  { to: '/credito', label: 'Crédito', soloDueno: true },
  { to: '/gastos', label: 'Gastos', soloDueno: true },
  { to: '/balance', label: 'Balance', soloDueno: true },
  { to: '/config', label: 'Configuración', soloDueno: true },
]

export default function App() {
  const [ready, setReady] = useState(false)
  const { user, logout } = useAuth()
  const location = useLocation()

  useEffect(() => {
    (async () => {
      const vacio = (await db.productos.count()) === 0
      if (vacio && syncDisponible && navigator.onLine) {
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
      <nav className="nav">
        <div className="nav-brand">
          <img src={LOGO_URL} alt="Lavadero Fénix" />
          <span>Lavadero Fénix</span>
        </div>
        {navItems.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>{t.label}</span>
          </NavLink>
        ))}
        <button className="nav-logout" onClick={logout} title={`Salir (${user.nombre})`}>
          <span>Salir</span>
        </button>
      </nav>

      <main className="main">
        <SyncBadge />
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/factura" element={<Caja />} />
          {esDueno ? (
            <>
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
