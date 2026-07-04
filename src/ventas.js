import { db, uid, stamp } from './db'
import { monthKey } from './format'

// Medios de pago del sistema.
// 'contado' es el valor histórico (ventas viejas): se trata como efectivo.
export const MEDIOS_PAGO = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'credito', label: 'Crédito (fiado)' },
]
export const esEfectivo = (v) => v.metodoPago === 'efectivo' || v.metodoPago === 'contado' || !v.metodoPago
export const labelMedio = (id) =>
  id === 'transferencia' ? 'Transferencia' : id === 'credito' ? 'Crédito (fiado)' : 'Efectivo'

// Consecutivo de factura: máximo conocido + 1. Con la sincronización todos
// los dispositivos convergen al mismo consecutivo; si dos venden exactamente
// a la vez sin internet puede repetirse un número (limitación aceptada).
async function siguienteFactura() {
  const ventas = await db.ventas.toArray()
  return ventas.reduce((m, v) => Math.max(m, v.factura || 0), 0) + 1
}
export const folio = (n) => 'F-' + String(n || 0).padStart(4, '0')

// Factura un carrito mixto (productos y servicios) en un solo paso.
// - Todas las ventas del mismo cobro comparten el número de factura.
// - Crea UNA venta de productos (con sus items) si hay productos.
// - Crea UNA venta por cada línea de servicio (conserva comisión/trabajador).
// - Descuenta stock de los productos vendidos.
// Devuelve { total, factura }.
export async function facturarItems({ items, trabajador = null, metodo = 'efectivo', cliente = null, origen = null }) {
  const now = Date.now()
  const factura = await siguienteFactura()
  const base = {
    fecha: now,
    mes: monthKey(now),
    factura,
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

  return { total, factura }
}

// Texto del recibo para compartir (WhatsApp, etc.).
export function textoRecibo({ factura, fecha, items, total, metodo, cliente, origen }) {
  const f = new Date(fecha || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  const cop = (n) => '$' + Math.round(n).toLocaleString('es-CO')
  const lineas = items.map((i) => `${i.cantidad} x ${i.nombre}  ${cop(i.precioVenta * i.cantidad)}`)
  return [
    'LAVADERO FÉNIX LC — Villa Caribe',
    `Recibo ${folio(factura)} · ${p(f.getDate())}/${p(f.getMonth() + 1)}/${f.getFullYear()} ${p(f.getHours())}:${p(f.getMinutes())}`,
    origen ? `Cuenta: ${origen}` : null,
    cliente ? `Cliente: ${cliente}` : null,
    '--------------------------',
    ...lineas,
    '--------------------------',
    `TOTAL: ${cop(total)}`,
    `Pago: ${labelMedio(metodo)}`,
    '¡Gracias por su visita!',
  ].filter(Boolean).join('\n')
}

// Comparte el recibo (Web Share) o lo copia al portapapeles.
// Devuelve 'compartido' | 'copiado' | 'error'.
export async function compartirRecibo(datos) {
  const texto = textoRecibo(datos)
  try {
    if (navigator.share) { await navigator.share({ text: texto }); return 'compartido' }
    await navigator.clipboard.writeText(texto)
    return 'copiado'
  } catch (e) {
    try { await navigator.clipboard.writeText(texto); return 'copiado' } catch { return 'error' }
  }
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
