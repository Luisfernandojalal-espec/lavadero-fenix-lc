import { useNavigate } from 'react-router-dom'
import { LOGO_URL } from '../format'
import { useAuth } from '../auth'

const MODULOS = [
  { to: '/factura', label: 'Factura rápida', desc: 'Registrar ventas de productos y servicios' },
  { to: '/historial', label: 'Historial de ventas', desc: 'Consultar y anular ventas', soloDueno: true },
  { to: '/inventario', label: 'Inventario', desc: 'Productos, entradas, salidas y kardex', soloDueno: true },
  { to: '/credito', label: 'Crédito', desc: 'Cartera: fiado y abonos de clientes', soloDueno: true },
  { to: '/gastos', label: 'Gastos', desc: 'Arriendo, servicios y otros egresos', soloDueno: true },
  { to: '/balance', label: 'Balance', desc: 'Estado financiero del negocio', soloDueno: true },
  { to: '/config', label: 'Configuración', desc: 'Servicios de lavado y personal', soloDueno: true },
]

export default function Inicio() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const esDueno = user?.rol === 'dueño'
  const modulos = MODULOS.filter((m) => esDueno || !m.soloDueno)

  return (
    <>
      <header className="inicio-top">
        <img src={LOGO_URL} alt="Lavadero Fénix LC" className="inicio-logo" />
        <div>
          <div className="inicio-nombre">Lavadero Fénix LC</div>
          <div className="inicio-usuario">{user?.nombre} · {esDueno ? 'Administrador' : 'Trabajador'}</div>
        </div>
      </header>

      <div className="content">
        <div className="lista-menu">
          {modulos.map((m) => (
            <button key={m.to} className="menu-item" onClick={() => navigate(m.to)}>
              <div className="menu-item-txt">
                <div className="menu-item-label">{m.label}</div>
                <div className="menu-item-desc">{m.desc}</div>
              </div>
              <span className="menu-item-arrow">›</span>
            </button>
          ))}
        </div>

        <button className="btn ghost" style={{ marginTop: 16 }} onClick={logout}>
          Cerrar sesión
        </button>
      </div>
    </>
  )
}
