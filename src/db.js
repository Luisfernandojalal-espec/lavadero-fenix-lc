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

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2)
}

// Sello que se aplica a todo registro que se crea o modifica.
export function stamp(obj) {
  return { ...obj, updatedAt: Date.now(), synced: 0 }
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
  { id: 'insumos', label: 'Insumos' },
  { id: 'otro', label: 'Otro' },
]

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
  const tablas = ['productos', 'ventas', 'gastos', 'movimientos_inv', 'clientes', 'abonos', 'servicios', 'trabajadores', 'mesas', 'turnos', 'pagos_comision']
  for (const t of tablas) await db[t].clear()
  if (supabase) {
    for (const t of tablas) await supabase.from('registros').delete().eq('tabla', t)
  }
  localStorage.removeItem('fenix_session')
  localStorage.removeItem('fenix_last_pull')
}
