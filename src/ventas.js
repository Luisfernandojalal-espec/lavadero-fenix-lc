import { db, uid, stamp } from './db'
import { monthKey } from './format'

// Medios de pago del sistema.
// 'contado' es el valor histórico (ventas viejas): se trata como efectivo.
export const MEDIOS_PAGO = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'mixto', label: 'Mixto (efectivo + transferencia)' },
  { id: 'credito', label: 'Crédito (fiado)' },
]
export const esEfectivo = (v) => v.metodoPago === 'efectivo' || v.metodoPago === 'contado' || !v.metodoPago
export const labelMedio = (id) =>
  id === 'transferencia' ? 'Transferencia' : id === 'credito' ? 'Crédito (fiado)' : id === 'mixto' ? 'Mixto' : 'Efectivo'

// Parte de una venta pagada en efectivo / transferencia (soporta el pago mixto).
export const montoEfectivo = (v) =>
  v.metodoPago === 'mixto' ? (v.pagoEfectivo || 0) : (esEfectivo(v) ? v.total : 0)
export const montoTransferencia = (v) =>
  v.metodoPago === 'mixto' ? (v.pagoTransferencia || 0) : (v.metodoPago === 'transferencia' ? v.total : 0)

// Asigna un lavador a una línea de servicio resolviendo el % de comisión:
// manda el % propio del trabajador; si no tiene, aplica el % del servicio.
export function asignarComision(linea, trabajador) {
  const pctServicio = linea.comisionPctServicio ?? linea.comisionPct ?? 0
  const pctTrabajador = trabajador && trabajador.comisionPct != null && trabajador.comisionPct !== ''
    ? Number(trabajador.comisionPct) : null
  return {
    ...linea,
    trabajadorId: trabajador ? trabajador.id : null,
    trabajadorNombre: trabajador ? trabajador.nombre : null,
    comisionPctServicio: pctServicio,
    comisionPct: pctTrabajador ?? pctServicio,
  }
}

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
export async function facturarItems({ items, trabajador = null, metodo = 'efectivo', cliente = null, origen = null, pago = null }) {
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

  // Total del ticket (para repartir el pago mixto proporcional por línea).
  const totalProd = prods.reduce((s, i) => s + i.precioVenta * i.cantidad, 0)
  const totalesServ = servs.map((s) => Math.max(0, s.precioVenta * s.cantidad - Math.max(0, s.descuento || 0)))
  const ticketTotal = totalProd + totalesServ.reduce((a, b) => a + b, 0)

  // Parte en efectivo / transferencia de una línea, según el método.
  const efPct = metodo === 'mixto' && pago && ticketTotal > 0 ? (pago.efectivo || 0) / ticketTotal : 0
  const splitDe = (rowTotal) => {
    if (metodo === 'mixto') { const ef = Math.round(rowTotal * efPct); return { pagoEfectivo: ef, pagoTransferencia: Math.max(0, rowTotal - ef) } }
    if (metodo === 'transferencia') return { pagoEfectivo: 0, pagoTransferencia: rowTotal }
    if (metodo === 'credito') return { pagoEfectivo: 0, pagoTransferencia: 0 }
    return { pagoEfectivo: rowTotal, pagoTransferencia: 0 } // efectivo / contado
  }
  let total = 0

  if (prods.length) {
    const costoProd = prods.reduce((s, i) => s + (i.precioCompra || 0) * i.cantidad, 0)
    await db.ventas.add(stamp({
      id: uid(), tipo: 'producto', ...base, ...splitDe(totalProd),
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

  for (let k = 0; k < servs.length; k++) {
    const s = servs[k]
    const totalServ = totalesServ[k]
    const descuento = Math.max(0, s.descuento || 0)
    // La comisión se calcula sobre lo realmente cobrado (neto de descuento).
    const comision = Math.round(totalServ * ((s.comisionPct || 0) / 100))
    // Cada línea de servicio lleva SU lavador (si no trae, usa el general)
    const t = s.trabajadorId ? { id: s.trabajadorId, nombre: s.trabajadorNombre } : trabajador
    await db.ventas.add(stamp({
      id: uid(), tipo: 'servicio', ...base, ...splitDe(totalServ),
      servicioId: s.refId, servicioNombre: s.nombre, cantidad: s.cantidad,
      precio: s.precioVenta, precioBase: s.precioBase ?? s.precioVenta,
      tipoVehiculo: s.tipoVehiculo || null, descuento, observacion: s.observacion || '',
      comisionPct: s.comisionPct || 0, comision,
      trabajadorId: t ? t.id : null,
      trabajadorNombre: t ? t.nombre : null,
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
  const lineas = items.map((i) => {
    const desc = i.tipo === 'servicio' && i.descuento ? ` (−${cop(i.descuento)})` : ''
    return `${i.cantidad} x ${i.nombre}${desc}  ${cop(totalLinea(i))}`
  })
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

// Total neto de una línea (aplica descuento en servicios).
export const totalLinea = (i) =>
  Math.max(0, i.precioVenta * i.cantidad - (i.tipo === 'servicio' ? (i.descuento || 0) : 0))

// Ganancia estimada de un carrito (para mostrarla antes de cobrar).
export function gananciaDe(items) {
  return items.reduce((s, i) => {
    if (i.tipo === 'producto') return s + (i.precioVenta - (i.precioCompra || 0)) * i.cantidad
    const neto = totalLinea(i)
    const comision = Math.round(neto * ((i.comisionPct || 0) / 100))
    return s + (neto - comision)
  }, 0)
}

export const totalDe = (items) => items.reduce((s, i) => s + totalLinea(i), 0)
