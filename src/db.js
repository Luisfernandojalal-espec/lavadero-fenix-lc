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

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2)
}

// Sello que se aplica a todo registro que se crea o modifica.
export function stamp(obj) {
  return { ...obj, updatedAt: Date.now(), synced: 0 }
}

export const CATEGORIAS_PRODUCTO = [
  { id: 'cerveza', label: 'Cerveza', emoji: '🍺' },
  { id: 'gaseosa', label: 'Gaseosa', emoji: '🥤' },
  { id: 'agua', label: 'Agua', emoji: '💧' },
  { id: 'mecato', label: 'Mecato', emoji: '🍟' },
  { id: 'otro', label: 'Otro', emoji: '📦' },
]

export const CATEGORIAS_GASTO = [
  { id: 'arriendo', label: 'Arriendo', emoji: '🏠' },
  { id: 'luz', label: 'Luz', emoji: '💡' },
  { id: 'agua', label: 'Agua', emoji: '🚰' },
  { id: 'nomina', label: 'Nómina', emoji: '👷' },
  { id: 'insumos', label: 'Insumos', emoji: '🧴' },
  { id: 'otro', label: 'Otro', emoji: '📋' },
]

export function emojiCategoria(catId) {
  const c = CATEGORIAS_PRODUCTO.find((x) => x.id === catId)
  return c ? c.emoji : '📦'
}

// Mínimo de stock por defecto si el producto no tiene uno configurado.
export const STOCK_MIN_DEFAULT = 5

// ¿Al producto le queda poco (igual o menos que su mínimo)?
export function stockBajo(p) {
  const min = p.stockMin ?? STOCK_MIN_DEFAULT
  return (p.stock ?? 0) <= min
}

// Datos de ejemplo la primera vez que se abre la app.
// Guard a nivel de módulo + transacción para evitar el doble sembrado
// que provoca React StrictMode (monta el efecto dos veces en desarrollo).
let seedPromise = null
export function seedIfEmpty() {
  if (!seedPromise) seedPromise = doSeed()
  return seedPromise
}

async function doSeed() {
  const productos = [
    { nombre: 'Cerveza Águila', categoria: 'cerveza', precioCompra: 2500, precioVenta: 4000, stock: 24 },
    { nombre: 'Cerveza Poker', categoria: 'cerveza', precioCompra: 2500, precioVenta: 4000, stock: 24 },
    { nombre: 'Gaseosa Postobón 400ml', categoria: 'gaseosa', precioCompra: 1800, precioVenta: 3000, stock: 18 },
    { nombre: 'Coca-Cola 400ml', categoria: 'gaseosa', precioCompra: 2000, precioVenta: 3500, stock: 18 },
    { nombre: 'Agua Cristal 600ml', categoria: 'agua', precioCompra: 900, precioVenta: 2000, stock: 12 },
    { nombre: 'Papas Margarita', categoria: 'mecato', precioCompra: 1500, precioVenta: 2500, stock: 20 },
    { nombre: 'Detodito', categoria: 'mecato', precioCompra: 1700, precioVenta: 2800, stock: 15 },
  ]

  const servicios = [
    { nombre: 'Lavado carro sencillo', precio: 20000, comisionPct: 40 },
    { nombre: 'Lavado carro + brillado', precio: 35000, comisionPct: 40 },
    { nombre: 'Lavado moto', precio: 10000, comisionPct: 50 },
    { nombre: 'Lavado camioneta', precio: 28000, comisionPct: 40 },
  ]

  const trabajadores = [
    { nombre: 'Trabajador 1', activo: 1 },
  ]

  await db.transaction('rw', db.productos, db.servicios, db.trabajadores, async () => {
    // Las transacciones rw se serializan: si otra ya sembró, aquí ya hay datos.
    if ((await db.productos.count()) > 0) return
    await db.productos.bulkAdd(productos.map((p) => stamp({ id: uid(), activo: 1, ...p })))
    await db.servicios.bulkAdd(servicios.map((s) => stamp({ id: uid(), activo: 1, ...s })))
    await db.trabajadores.bulkAdd(trabajadores.map((t) => stamp({ id: uid(), ...t })))
  })
}
