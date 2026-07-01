// Formato de moneda colombiana (COP) y fechas

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

export function money(n) {
  return cop.format(Math.round(Number(n) || 0))
}

// Solo el número con separador de miles, sin símbolo (para inputs)
export function thousands(n) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(n) || 0)
}

// Convierte texto del usuario ("12.000" o "12000") a número
export function parseMoney(str) {
  if (typeof str === 'number') return str
  const clean = String(str).replace(/[^\d]/g, '')
  return clean ? parseInt(clean, 10) : 0
}

// Clave de mes "2026-06" desde un timestamp
export function monthKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function currentMonthKey() {
  return monthKey(Date.now())
}

const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export function monthLabel(key) {
  const [y, m] = key.split('-')
  return `${meses[parseInt(m, 10) - 1]} ${y}`
}

export function shortDate(ts) {
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
