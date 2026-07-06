import Dexie from 'dexie'

// Base de datos local (funciona 100% sin internet).
// Los campos `updatedAt` y `synced` quedan listos para la futura
// sincronización con Supabase: cada registro tiene id propio (UUID),
// así nunca chocan los datos creados desde varios celulares.

export const db = new Dexie('lavadero_fenix')

db.version(1).stores({
  // & = índice único (clave primaria)
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
})

// v2: movimientos de inventario (entradas/salidas) para el kardex
db.version(2).stores({
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, updatedAt',
})

// v3: crédito — clientes y abonos (fiado)
db.version(3).stores({
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, clienteId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, updatedAt',
  clientes: '&id, activo, updatedAt',
  abonos: '&id, clienteId, mes, fecha, updatedAt',
})

// v4: mesas (cuentas abiertas) para el flujo tipo restaurante
db.version(4).stores({
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, clienteId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, updatedAt',
  clientes: '&id, activo, updatedAt',
  abonos: '&id, clienteId, mes, fecha, updatedAt',
  mesas: '&id, estado, activo, updatedAt',
})

// v5: turnos (apertura y cierre de caja)
db.version(5).stores({
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, clienteId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, updatedAt',
  clientes: '&id, activo, updatedAt',
  abonos: '&id, clienteId, mes, fecha, updatedAt',
  mesas: '&id, estado, activo, updatedAt',
  turnos: '&id, estado, mes, updatedAt',
})

// v6: pagos de comisiones a lavadores (liquidación de nómina por comisión)
db.version(6).stores({
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, clienteId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, updatedAt',
  clientes: '&id, activo, updatedAt',
  abonos: '&id, clienteId, mes, fecha, updatedAt',
  mesas: '&id, estado, activo, updatedAt',
  turnos: '&id, estado, mes, updatedAt',
  pagos_comision: '&id, trabajadorId, mes, updatedAt',
})

// v7: plantilla de gastos fijos (arriendo, luz, agua…) con control mensual
db.version(7).stores({
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, clienteId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, updatedAt',
  clientes: '&id, activo, updatedAt',
  abonos: '&id, clienteId, mes, fecha, updatedAt',
  mesas: '&id, estado, activo, updatedAt',
  turnos: '&id, estado, mes, updatedAt',
  pagos_comision: '&id, trabajadorId, mes, updatedAt',
  gastos_fijos: '&id, activo, updatedAt',
})

// Unidades de medida de un producto.
export const UNIDADES = [
  { id: 'unidad', label: 'Unidad' },
  { id: 'caja', label: 'Caja' },
  { id: 'paca', label: 'Paca' },
  { id: 'docena', label: 'Docena' },
  { id: 'litro', label: 'Litro' },
  { id: 'galon', label: 'Galón' },
  { id: 'kg', label: 'Kilogramo' },
  { id: 'libra', label: 'Libra' },
]
export const labelUnidad = (id) => UNIDADES.find((u) => u.id === id)?.label || 'Unidad'

// Formas de pago de una compra a proveedor.
export const FORMAS_PAGO_COMPRA = [
  { id: 'contado', label: 'Contado' },
  { id: 'credito', label: 'Crédito' },
  { id: 'transferencia', label: 'Transferencia' },
]
export const labelFormaPagoCompra = (id) => FORMAS_PAGO_COMPRA.find((f) => f.id === id)?.label || 'Contado'

// v8: órdenes de servicio (control operativo del lavadero, base de facturación)
db.version(8).stores({
  productos: '&id, categoria, activo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, clienteId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, updatedAt',
  clientes: '&id, activo, updatedAt',
  abonos: '&id, clienteId, mes, fecha, updatedAt',
  mesas: '&id, estado, activo, updatedAt',
  turnos: '&id, estado, mes, updatedAt',
  pagos_comision: '&id, trabajadorId, mes, updatedAt',
  gastos_fijos: '&id, activo, updatedAt',
  ordenes: '&id, estado, numero, mes, fecha, updatedAt',
})

// v9: facturas de entrada (compras a proveedores) + código de barras
db.version(9).stores({
  productos: '&id, categoria, activo, codigo, updatedAt',
  servicios: '&id, activo, updatedAt',
  trabajadores: '&id, activo, updatedAt',
  ventas: '&id, tipo, mes, fecha, trabajadorId, clienteId, updatedAt',
  gastos: '&id, categoria, mes, fecha, updatedAt',
  movimientos_inv: '&id, productoId, tipo, mes, fecha, compraId, updatedAt',
  clientes: '&id, activo, updatedAt',
  abonos: '&id, clienteId, mes, fecha, updatedAt',
  mesas: '&id, estado, activo, updatedAt',
  turnos: '&id, estado, mes, updatedAt',
  pagos_comision: '&id, trabajadorId, mes, updatedAt',
  gastos_fijos: '&id, activo, updatedAt',
  ordenes: '&id, estado, numero, mes, fecha, updatedAt',
  proveedores: '&id, activo, updatedAt',
  compras: '&id, proveedorId, mes, fecha, updatedAt',
})

// Estados de una orden de servicio (flujo operativo).
export const ESTADOS_ORDEN = [
  { id: 'pendiente', label: 'Pendiente' },
  { id: 'proceso', label: 'En proceso' },
  { id: 'terminado', label: 'Terminado' },
  { id: 'entregado', label: 'Entregado' },
]
export const labelEstadoOrden = (id) => ESTADOS_ORDEN.find((e) => e.id === id)?.label || id

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2)
}

// Sello que se aplica a todo registro que se crea o modifica.
export function stamp(obj) {
  return { ...obj, updatedAt: Date.now(), synced: 0 }
}

// Tipos de vehículo del lavadero. El precio de cada servicio depende del tipo.
export const TIPOS_VEHICULO = [
  { id: 'automovil', label: 'Automóvil' },
  { id: 'camioneta', label: 'Camioneta' },
  { id: 'moto100', label: 'Moto pequeña' },  // 100/125
  { id: 'moto150', label: 'Moto grande' },   // 150/300
]
export const labelTipoVeh = (id) => TIPOS_VEHICULO.find((t) => t.id === id)?.label || ''

// Precio de un servicio para un tipo de vehículo. Soporta el modelo nuevo
// (servicio.precios = { [tipoVeh]: valor }) y el viejo (servicio.precio escalar,
// que aplica a cualquier vehículo). Devuelve 0 si el servicio no se ofrece.
export function precioServicio(servicio, tipoVehId) {
  if (!servicio) return 0
  if (servicio.precios && typeof servicio.precios === 'object') {
    const p = servicio.precios[tipoVehId]
    return p != null && p !== '' ? Number(p) || 0 : 0
  }
  return Number(servicio.precio) || 0
}
// ¿El servicio se ofrece para este tipo de vehículo? (tiene precio > 0)
export function servicioAplica(servicio, tipoVehId) {
  return precioServicio(servicio, tipoVehId) > 0
}

// ¿Es una lavada PRINCIPAL (servicio "madre") o una adición que se suma?
// Usa el flag esBase; los servicios viejos sin flag se clasifican por nombre.
export function esServicioBase(s) {
  if (s?.esBase != null) return !!s.esBase
  return /lavado general|con todo/i.test(String(s?.nombre || ''))
}
// Precio mínimo ofrecido (para ordenar/mostrar y como campo legacy `precio`).
export function precioMinServicio(servicio) {
  if (servicio?.precios && typeof servicio.precios === 'object') {
    const vals = Object.values(servicio.precios).map(Number).filter((n) => n > 0)
    return vals.length ? Math.min(...vals) : 0
  }
  return Number(servicio?.precio) || 0
}

export const CATEGORIAS_PRODUCTO = [
  { id: 'cerveza', label: 'Cerveza' },
  { id: 'gaseosa', label: 'Gaseosa' },
  { id: 'agua', label: 'Agua' },
  { id: 'mecato', label: 'Mecato' },
  { id: 'otro', label: 'Otro' },
]

export const MOTIVOS_SALIDA = [
  { id: 'merma', label: 'Merma / vencido' },
  { id: 'dañado', label: 'Dañado' },
  { id: 'consumo', label: 'Consumo propio' },
  { id: 'ajuste', label: 'Ajuste de inventario' },
  { id: 'otro', label: 'Otro' },
]

export const CATEGORIAS_GASTO = [
  { id: 'arriendo', label: 'Arriendo' },
  { id: 'luz', label: 'Luz' },
  { id: 'agua', label: 'Agua' },
  { id: 'nomina', label: 'Nómina' },
  { id: 'comisiones', label: 'Comisiones' },
  // Insumos y gastos variables típicos de un lavadero
  { id: 'jabon', label: 'Jabón' },
  { id: 'silicona', label: 'Silicona' },
  { id: 'desengrasante', label: 'Desengrasante' },
  { id: 'trapos', label: 'Trapos' },
  { id: 'cepillos', label: 'Cepillos' },
  { id: 'combustible', label: 'Combustible' },
  { id: 'transporte', label: 'Transporte' },
  { id: 'insumos', label: 'Otros insumos' },
  { id: 'otro', label: 'Otro' },
]

// Medio con que se PAGA un gasto. 'caja' = sale del efectivo de la caja física
// (descuadra el turno); transferencia/banco NO tocan el efectivo de la caja.
export const MEDIOS_PAGO_GASTO = [
  { id: 'caja', label: 'Caja (efectivo)' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'banco', label: 'Cuenta bancaria' },
]
export const labelMedioGasto = (id) => {
  const m = MEDIOS_PAGO_GASTO.find((x) => x.id === id)
  return m ? m.label : 'Caja (efectivo)'
}
// ¿Este gasto sale del efectivo de la caja física? Los registros viejos sin
// medio de pago se consideran de caja (así el cierre de turno no cambia).
export function gastoDeCaja(g) {
  return !g.medioPago || g.medioPago === 'caja'
}

// Clasificación fijo/variable de un gasto. Si el gasto no la trae guardada
// (registros viejos), se deduce por la categoría.
const CATEGORIAS_FIJAS = ['arriendo', 'luz', 'agua', 'nomina']
export function tipoGasto(g) {
  if (g.tipo === 'fijo' || g.tipo === 'variable') return g.tipo
  return CATEGORIAS_FIJAS.includes(g.categoria) ? 'fijo' : 'variable'
}
export function tipoPorCategoria(catId) {
  return CATEGORIAS_FIJAS.includes(catId) ? 'fijo' : 'variable'
}

export function labelCategoria(catId) {
  const c = CATEGORIAS_PRODUCTO.find((x) => x.id === catId)
  return c ? c.label : 'Otro'
}

// Mínimo de stock por defecto si el producto no tiene uno configurado.
export const STOCK_MIN_DEFAULT = 5

// ¿Al producto le queda poco (igual o menos que su mínimo)?
export function stockBajo(p) {
  const min = p.stockMin ?? STOCK_MIN_DEFAULT
  return (p.stock ?? 0) <= min
}

// Sin datos de ejemplo: el sistema arranca vacío y el dueño carga sus
// productos (con la plantilla de Excel), servicios y trabajadores reales.
export async function seedIfEmpty() {
  // No-op a propósito. Se conserva por compatibilidad con la inicialización.
}

// Borra TODOS los datos (local y nube) para dejar el sistema en blanco.
// Después de esto la app pide crear el usuario administrador de nuevo.
export async function borrarTodo(supabase) {
  const tablas = ['productos', 'ventas', 'gastos', 'movimientos_inv', 'clientes', 'abonos', 'servicios', 'trabajadores', 'mesas', 'turnos', 'pagos_comision', 'gastos_fijos', 'ordenes', 'proveedores', 'compras']
  for (const t of tablas) await db[t].clear()
  if (supabase) {
    for (const t of tablas) await supabase.from('registros').delete().eq('tabla', t)
  }
  localStorage.removeItem('fenix_session')
  localStorage.removeItem('fenix_last_pull')
}
