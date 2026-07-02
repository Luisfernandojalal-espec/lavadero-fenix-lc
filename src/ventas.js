import { db, uid, stamp } from './db'
import { monthKey } from './format'

// Factura un carrito mixto (productos y servicios) en un solo paso.
// - Crea UNA venta de productos (con sus items) si hay productos.
// - Crea UNA venta por cada línea de servicio (conserva comisión/trabajador),
//   así el Balance, comisiones e historial siguen cuadrando sin cambios.
// - Descuenta stock de los productos vendidos.
// Devuelve el total facturado.
export async function facturarItems({ items, trabajador = null, metodo = 'contado', cliente = null, origen = null }) {
  const now = Date.now()
  const base = {
    fecha: now,
    mes: monthKey(now),
    metodoPago: metodo,
    clienteId: cliente ? cliente.id : null,
    clienteNombre: cliente ? cliente.nombre : null,
    origen, // trazabilidad: ej. nombre de la mesa
  }

  const prods = items.filter((i) => i.tipo === 'producto' && i.cantidad > 0)
  const servs = items.filter((i) => i.tipo === 'servicio' && i.cantidad > 0)
  let total = 0

  if (prods.length) {
    const totalProd = prods.reduce((s, i) => s + i.precioVenta * i.cantidad, 0)
    const costoProd = prods.reduce((s, i) => s + (i.precioCompra || 0) * i.cantidad, 0)
    await db.ventas.add(stamp({
      id: uid(), tipo: 'producto', ...base,
      items: prods.map((i) => ({
        productoId: i.refId, nombre: i.nombre, cantidad: i.cantidad,
        precioVenta: i.precioVenta, precioCompra: i.precioCompra || 0,
      })),
      total: totalProd, costo: costoProd, ganancia: totalProd - costoProd,
    }))
    for (const i of prods) {
      const p = await db.productos.get(i.refId)
      if (p) await db.productos.update(p.id, stamp({ stock: Math.max(0, (p.stock || 0) - i.cantidad) }))
    }
    total += totalProd
  }

  for (const s of servs) {
    const comisionUnit = Math.round(s.precioVenta * ((s.comisionPct || 0) / 100))
    const totalServ = s.precioVenta * s.cantidad
    const comision = comisionUnit * s.cantidad
    await db.ventas.add(stamp({
      id: uid(), tipo: 'servicio', ...base,
      servicioId: s.refId, servicioNombre: s.nombre, cantidad: s.cantidad,
      precio: s.precioVenta, comisionPct: s.comisionPct || 0, comision,
      trabajadorId: trabajador ? trabajador.id : null,
      trabajadorNombre: trabajador ? trabajador.nombre : null,
      total: totalServ, costo: comision, ganancia: totalServ - comision,
    }))
    total += totalServ
  }

  return total
}

// Ganancia estimada de un carrito (para mostrarla antes de cobrar).
export function gananciaDe(items) {
  return items.reduce((s, i) => {
    if (i.tipo === 'producto') return s + (i.precioVenta - (i.precioCompra || 0)) * i.cantidad
    const comision = Math.round(i.precioVenta * ((i.comisionPct || 0) / 100))
    return s + (i.precioVenta - comision) * i.cantidad
  }, 0)
}

export const totalDe = (items) => items.reduce((s, i) => s + i.precioVenta * i.cantidad, 0)
