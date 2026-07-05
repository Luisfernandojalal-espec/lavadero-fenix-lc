import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { money } from '../format'
import { stockBajo } from '../db'
import { useAuth } from '../auth'

const sinTildes = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Catálogo vacío: en vez de un callejón sin salida, guía a cargarlo.
function CatalogoVacio({ sinServicios, sinProductos }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const esDueno = user?.rol === 'dueño'

  return (
    <div className="empty">
      Aún no hay nada para vender: falta cargar el catálogo.
      {esDueno ? (
        <div style={{ maxWidth: 360, margin: '14px auto 0' }}>
          {sinServicios && (
            <button className="btn" onClick={() => navigate('/config')}>
              Crear servicios de lavado (Admin)
            </button>
          )}
          {sinServicios && sinProductos && <div style={{ height: 10 }} />}
          {sinProductos && (
            <button className="btn secondary" onClick={() => navigate('/inventario')}>
              Cargar productos (Inventario)
            </button>
          )}
          <div className="helper" style={{ marginTop: 10 }}>
            Los productos se cargan de una vez con la plantilla de Excel en Inventario → Saldos iniciales.
          </div>
        </div>
      ) : (
        <div className="helper" style={{ marginTop: 8 }}>
          Pídele al administrador que cargue los productos y servicios.
        </div>
      )}
    </div>
  )
}

// Convierte un ítem de la cuadrícula en una línea de carrito/cuenta.
export function lineaDesde(it) {
  if (it.tipo === 'servicio') {
    return {
      key: it.key, tipo: 'servicio', refId: it.ref.id, nombre: it.ref.nombre,
      precioVenta: it.ref.precio, cantidad: 1,
      comisionPct: it.ref.comisionPct || 0,
      comisionPctServicio: it.ref.comisionPct || 0, // respaldo si la línea queda sin lavador
    }
  }
  return {
    key: it.key, tipo: 'producto', refId: it.ref.id, nombre: it.ref.nombre,
    precioVenta: it.ref.precioVenta, precioCompra: it.ref.precioCompra || 0, cantidad: 1,
  }
}

// Cuadrícula unificada de venta: SERVICIOS primero, luego PRODUCTOS.
// La cantidad seleccionada se ve en la propia tarjeta (badge + stepper),
// sin abrir otra ventana.
// carrito: { [key]: { cantidad, ... } }
export function ItemsGrid({ servicios, productos, carrito, onAdd, onSub }) {
  const [q, setQ] = useState('')

  let items = [
    ...(servicios || []).slice().sort((a, b) => a.precio - b.precio)
      .map((s) => ({ key: 'servicio:' + s.id, tipo: 'servicio', ref: s, nombre: s.nombre, precio: s.precio })),
    ...(productos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((p) => ({ key: 'producto:' + p.id, tipo: 'producto', ref: p, nombre: p.nombre, precio: p.precioVenta })),
  ]

  if (items.length === 0) {
    return <CatalogoVacio sinServicios={!(servicios || []).length} sinProductos={!(productos || []).length} />
  }

  if (q.trim()) items = items.filter((it) => sinTildes(it.nombre).includes(sinTildes(q)))

  return (
    <>
    <input className="buscador" inputMode="search" placeholder="Buscar producto o servicio…"
      value={q} onChange={(e) => setQ(e.target.value)} />
    {items.length === 0 && <div className="empty">Sin resultados para “{q}”.</div>}
    <div className="tiles">
      {items.map((it) => {
        const qty = carrito[it.key]?.cantidad || 0
        return (
          <div key={it.key} className={`tile ${qty > 0 ? 'sel' : ''}`} role="button" tabIndex={0}
            onClick={() => onAdd(it)}>
            {qty > 0 && <span className="tile-qty">{qty}</span>}
            {it.tipo === 'servicio' && <span className="tile-tag">Servicio</span>}
            <span className="name">{it.nombre}</span>
            <span className="price">{money(it.precio)}</span>
            {it.tipo === 'producto' && stockBajo(it.ref) && (
              <span className="badge amber">Quedan {it.ref.stock ?? 0}</span>
            )}
            {qty > 0 && (
              <span className="tile-step" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onSub(it)} aria-label="Quitar uno">−</button>
                <b>{qty}</b>
                <button onClick={() => onAdd(it)} aria-label="Agregar uno">+</button>
              </span>
            )}
          </div>
        )
      })}
    </div>
    </>
  )
}
