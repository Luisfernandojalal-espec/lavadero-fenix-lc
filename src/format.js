// Ruta del logo que funciona tanto en local ("/") como publicado
// en una subcarpeta ("/lavadero-fenix-lc/"). BASE_URL lo resuelve solo.
export const LOGO_URL = import.meta.env.BASE_URL + 'logo.jpg'

// Formato de moneda colombiana (COP) y fechas

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

export function money(n) {
  return cop.format(Math.round(Number(n) || 0))
}

// Clave de mes "2026-06" desde un timestamp
export function monthKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function currentMonthKey() {
  return monthKey(Date.now())
}

// Devuelve las últimas N claves de mes ("2026-06", "2026-05", ...)
export function ultimosMeses(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export function monthLabel(key) {
  const [y, m] = key.split('-')
  return `${meses[parseInt(m, 10) - 1]} ${y}`
}

const mesesCortos = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// "01 Jul 2026"
export function fechaLarga(ts = Date.now()) {
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')} ${mesesCortos[d.getMonth()]} ${d.getFullYear()}`
}

// Clave de día "2026-07-01"
export function dayKey(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function shortDate(ts) {
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
