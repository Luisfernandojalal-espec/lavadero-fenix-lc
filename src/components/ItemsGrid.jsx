import { money } from '../format'
import { stockBajo } from '../db'

// Convierte un ítem de la cuadrícula en una línea de carrito/cuenta.
export function lineaDesde(it) {
  if (it.tipo === 'servicio') {
    return {
      key: it.key, tipo: 'servicio', refId: it.ref.id, nombre: it.ref.nombre,
      precioVenta: it.ref.precio, comisionPct: it.ref.comisionPct || 0, cantidad: 1,
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
  const items = [
    ...(servicios || []).slice().sort((a, b) => a.precio - b.precio)
      .map((s) => ({ key: 'servicio:' + s.id, tipo: 'servicio', ref: s, nombre: s.nombre, precio: s.precio })),
    ...(productos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((p) => ({ key: 'producto:' + p.id, tipo: 'producto', ref: p, nombre: p.nombre, precio: p.precioVenta })),
  ]

  if (items.length === 0) {
    return <div className="empty">No hay servicios ni productos. Créalos en Inventario y Admin.</div>
  }

  return (
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
  )
}
