import { useNavigate } from 'react-router-dom'
import { LOGO_URL } from '../format'
import { useAuth } from '../auth'

const MODULOS = [
  { to: '/factura', ico: '🧾', label: 'Factura rápida', desc: 'Vender productos y servicios' },
  { to: '/historial', ico: '📋', label: 'Historial de ventas', desc: 'Ver y corregir ventas', soloDueno: true },
  { to: '/inventario', ico: '📦', label: 'Inventario', desc: 'Productos, entradas y kardex', soloDueno: true },
  { to: '/credito', ico: '💳', label: 'Crédito', desc: 'Fiado y abonos de clientes', soloDueno: true },
  { to: '/gastos', ico: '🏠', label: 'Gastos', desc: 'Arriendo, luz, agua y más', soloDueno: true },
  { to: '/balance', ico: '⚖️', label: 'Balance', desc: 'Ganancias, gastos y utilidad', soloDueno: true },
  { to: '/config', ico: '⚙️', label: 'Configuración', desc: 'Servicios, trabajadores', soloDueno: true },
]

export default function Inicio() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const esDueno = user?.rol === 'dueño'
  const modulos = MODULOS.filter((m) => esDueno || !m.soloDueno)

  return (
    <>
      <div className="brand-header">
        <img src={LOGO_URL} alt="Lavadero Fénix LC" className="brand-logo" />
        <div>
          <div className="hola">Hola, {user?.nombre} {esDueno ? '👨🏻‍💻' : '👤'}</div>
          <div className="sub">¿Qué vas a hacer?</div>
        </div>
      </div>

      <div className="content">
        <div className="menu-grid">
          {modulos.map((m) => (
            <button key={m.to} className="menu-card" onClick={() => navigate(m.to)}>
              <span className="menu-ico">{m.ico}</span>
              <span className="menu-label">{m.label}</span>
              <span className="menu-desc">{m.desc}</span>
            </button>
          ))}
        </div>

        <button className="btn ghost" style={{ marginTop: 16 }} onClick={logout}>
          ⏻ Cerrar sesión
        </button>
      </div>
    </>
  )
}
