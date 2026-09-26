// REGLAS DE PLATA — funciones puras, sin React ni Dexie.
//
// Todo lo que decide de qué bolsillo sale o entra el dinero vive AQUÍ, para que
// se pueda probar sin abrir la app. El motivo es concreto: estas reglas se
// rompieron tres veces en tres días (un gasto reclasificado a fijo sacaba plata
// de un cierre ya hecho, un botón cambiaba en silencio el origen del dinero…) y
// nada lo detectaba hasta que el dueño veía un número raro días después.
//
// Si tocas algo de este archivo, corre `npm test` antes de publicar.

/* ─────────────── Ventas: cuánto entró por cada medio ─────────────── */

export const esEfectivo = (v) =>
  v.metodoPago === 'efectivo' || v.metodoPago === 'contado' || !v.metodoPago

export const montoEfectivo = (v) =>
  v.metodoPago === 'mixto' ? (v.pagoEfectivo || 0) : (esEfectivo(v) ? v.total : 0)

export const montoTransferencia = (v) =>
  v.metodoPago === 'mixto' ? (v.pagoTransferencia || 0)
    : (v.metodoPago === 'transferencia' ? v.total : 0)

/* ─────────────── Gastos: clasificación y bolsillo ─────────────── */

// Fijo = se repite cada mes. Si el gasto no lo trae guardado (registros viejos)
// se deduce por la categoría.
export const CATEGORIAS_FIJAS = ['arriendo', 'luz', 'agua', 'nomina']
export function tipoGasto(g) {
  if (g.tipo === 'fijo' || g.tipo === 'variable') return g.tipo
  return CATEGORIAS_FIJAS.includes(g.categoria) ? 'fijo' : 'variable'
}
export function tipoPorCategoria(catId) {
  return CATEGORIAS_FIJAS.includes(catId) ? 'fijo' : 'variable'
}

// Categorías que SÍ mueven la caja pero NO son gasto del negocio (P&L):
// comisiones (ya descontadas del neto de servicios), inventario (su costo entra
// al vender), retiro (plata del dueño) y prestamo (es cartera, no gasto).
export const CATEGORIAS_NO_PNL = ['comisiones', 'inventario', 'retiro', 'prestamo']
export const esGastoPnL = (g) => !g.anulada && !CATEGORIAS_NO_PNL.includes(g.categoria)

// ¿Sale del efectivo físico? Los registros viejos sin medio se toman como caja.
export function gastoDeCaja(g) {
  return !g.medioPago || g.medioPago === 'caja'
}

export const gastoMontoCaja = (g) =>
  g.medioPago === 'mixto' ? (g.pagoEfectivo || 0) : (gastoDeCaja(g) ? g.monto : 0)
export const gastoMontoTransfer = (g) =>
  g.medioPago === 'mixto' ? (g.pagoTransferencia || 0) : (gastoDeCaja(g) ? 0 : g.monto)

export function medioPagoGasto(medio, monto, efectivo = 0) {
  if (medio === 'transferencia') return { medioPago: 'transferencia' }
  if (medio === 'mixto') {
    const ef = Math.max(0, Math.min(efectivo || 0, monto))
    return { medioPago: 'mixto', pagoEfectivo: ef, pagoTransferencia: monto - ef }
  }
  return { medioPago: 'caja' }
}

// ¿Este movimiento toca el cuadre del turno?
//  - `fueraDeTurno` manda: es el operador diciendo "esta plata no salió de aquí".
//  - `tocaTurno` es una marca CONGELADA al registrar el gasto. Existe para que
//    reclasificar fijo/variable (que es contable) no mueva un cierre ya hecho.
//  - Sin marca (gastos viejos) se deduce como siempre: los fijos del mes nunca
//    tocaron el turno; los variables, según de dónde salió la plata.
export function gastoTocaTurno(g) {
  if (g.fueraDeTurno === 1) return false
  if (g.tocaTurno === 1) return true
  if (g.tocaTurno === 0) return false
  return tipoGasto(g) === 'variable' && (gastoDeCaja(g) || g.salidaTurno === 1)
}

// Qué marca `tocaTurno` guardar al crear o editar un gasto.
// `original` = el gasto tal como estaba antes de editarlo (null si es nuevo).
// Regla: al editar se CONGELA lo que ya hacía, salvo que el operador cambie a
// propósito de dónde salió la plata (medio de pago o los selectores de origen).
export function decidirTocaTurno({ medioPago, fueraDeTurno, salidaTurno, original = null }) {
  const fuera = fueraDeTurno ? 1 : 0
  const salida = salidaTurno ? 1 : 0
  const elegido = fuera === 1 ? 0 : (medioPago === 'caja' ? 1 : (salida === 1 ? 1 : 0))
  if (!original) return elegido
  const cambioOrigen = (original.medioPago || 'caja') !== medioPago
    || (original.fueraDeTurno === 1) !== (fuera === 1)
    || (original.salidaTurno === 1) !== (salida === 1)
  return cambioOrigen ? elegido : (gastoTocaTurno(original) ? 1 : 0)
}

// Un abono ENTRA a la caja o al banco del turno. Se marca `fueraDeTurno` cuando
// esa plata no llegó ahí (ej. el cliente le transfirió a la cuenta personal del
// dueño, o le pagó en la casa). Ojo: NO se puede reutilizar `gastoTocaTurno`
// aquí — esa función exige `salidaTurno` para lo que no es efectivo, y dejaría
// de contar los abonos por transferencia, que sí entran.
export const abonoEntraAlTurno = (a) => a.fueraDeTurno !== 1

/* ─────────────── Cuadre del turno ─────────────── */

// La aritmética del arqueo, una sola vez para el turno abierto y para uno ya
// cerrado (antes estaba duplicada en Turno.jsx y las dos copias podían separarse).
// Un turno abierto no tiene `cerradoEn`: cuenta todo lo posterior a la apertura.
export function cuadreTurno({ turno, ventas = [], abonos = [], gastos = [] }) {
  const desde = turno?.abiertoEn || 0
  const hasta = turno?.cerradoEn ?? Infinity
  const enRango = (ts) => ts >= desde && ts <= hasta

  const vs = ventas.filter((v) => !v.anulada && enRango(v.fecha))
  const efectivo = vs.reduce((s, v) => s + montoEfectivo(v), 0)
  const transferencias = vs.reduce((s, v) => s + montoTransferencia(v), 0)
  const credito = vs.filter((v) => v.metodoPago === 'credito').reduce((s, v) => s + v.total, 0)

  const abonosRango = abonos.filter((a) => !a.anulada && enRango(a.fecha) && abonoEntraAlTurno(a))
  const abonosCaja = abonosRango.reduce((s, a) => s + gastoMontoCaja(a), 0)
  const abonosTransfer = abonosRango.reduce((s, a) => s + gastoMontoTransfer(a), 0)

  // Solo los gastos VARIABLES del periodo que de verdad movieron este turno.
  const salidas = gastos
    .filter((g) => !g.anulada && enRango(g.fecha) && gastoTocaTurno(g))
    .sort((a, b) => b.fecha - a.fecha)
  const gastosCaja = salidas.reduce((s, g) => s + gastoMontoCaja(g), 0)
  const gastosTransfer = salidas.reduce((s, g) => s + gastoMontoTransfer(g), 0)

  const esperado = (turno?.base || 0) + efectivo + abonosCaja - gastosCaja
  const totalTransfer = (turno?.baseTransferencia || 0) + transferencias + abonosTransfer - gastosTransfer

  // El conteo físico es manual: se conserva del cierre, nunca se recalcula.
  const contadoReal = turno?.resumen?.contadoReal || 0
  const contadoTransfer = turno?.resumen?.contadoTransfer ?? null

  return {
    contado: efectivo, transferencias, credito,
    abonos: abonosCaja, abonosTransfer,
    gastos: gastosCaja, gastosTransfer,
    esperado, totalTransfer,
    contadoReal, diferencia: contadoReal - esperado,
    contadoTransfer,
    diferenciaTransfer: contadoTransfer == null ? null : contadoTransfer - totalTransfer,
    ventasCount: vs.length,
    salidasLista: salidas,
    abonosLista: abonosRango.slice().sort((a, b) => b.fecha - a.fecha),
  }
}

/* ─────────────── Cierres: lo que dio ESA noche vs lo que daría hoy ─────────────── */

// Un cierre muestra lo que dio al cerrar (la foto guardada en `resumen`), NO la
// cuenta rehecha con los datos de hoy. Antes se rehacía en vivo: si días
// después alguien editaba un gasto o una venta de ese turno (pasarlo a fijo,
// cambiarle el medio de pago…), el cierre viejo cambiaba SOLO y sin avisar —
// el dueño anotaba "cuadrada" esa noche y luego la app decía "faltó $100.000".
//
// `hoy` = cuadreTurno(...) con los datos actuales. Si difiere de la foto, se
// marca `cambio` para mostrar el aviso; el dueño decide si acepta el cambio.
// Los conteos físicos (contadoReal / contadoTransfer) siempre salen de la foto:
// "Corregir conteo" los reescribe ahí mismo.
export function cierreGuardado(turno, hoy) {
  const r0 = turno?.resumen
  // Cierres muy viejos sin foto completa: no hay contra qué comparar.
  if (!r0 || r0.esperado == null) {
    return { ...hoy, cambio: false, cambioEfectivo: 0, cambioTransfer: 0, hoy }
  }
  const foto = (k) => (r0[k] != null ? r0[k] : hoy[k])
  const esperado = r0.esperado
  const contadoReal = r0.contadoReal || 0
  const conTransfer = r0.totalTransfer != null
  const totalTransfer = conTransfer ? r0.totalTransfer : hoy.totalTransfer
  const contadoTransfer = r0.contadoTransfer != null ? r0.contadoTransfer : null
  const cambioEfectivo = hoy.esperado - esperado
  const cambioTransfer = conTransfer ? hoy.totalTransfer - totalTransfer : 0
  return {
    ...hoy, // las listas (salidas, abonos) son las de hoy
    contado: foto('contado'), transferencias: foto('transferencias'), credito: foto('credito'),
    abonos: foto('abonos'), abonosTransfer: foto('abonosTransfer'),
    gastos: foto('gastos'), gastosTransfer: foto('gastosTransfer'), ventasCount: foto('ventasCount'),
    esperado, totalTransfer, contadoReal, contadoTransfer,
    diferencia: contadoReal - esperado,
    diferenciaTransfer: contadoTransfer == null ? null : contadoTransfer - totalTransfer,
    cambio: cambioEfectivo !== 0 || cambioTransfer !== 0,
    cambioEfectivo, cambioTransfer, hoy,
  }
}

// Movimientos de un turno cerrado que se editaron DESPUÉS del cierre (con un
// minuto de gracia por relojes). Son los sospechosos cuando un cierre cambió.
export function editadosDespues(turno, { ventas = [], gastos = [], abonos = [] }) {
  if (!turno?.cerradoEn) return []
  const enRango = (x) => x.fecha >= turno.abiertoEn && x.fecha <= turno.cerradoEn
  const tarde = (x) => (x.updatedAt || 0) > turno.cerradoEn + 60_000
  return [
    ...ventas.filter((x) => enRango(x) && tarde(x)).map((x) => ({ clase: 'venta', x })),
    ...gastos.filter((x) => enRango(x) && tarde(x)).map((x) => ({ clase: 'gasto', x })),
    ...abonos.filter((x) => enRango(x) && tarde(x)).map((x) => ({ clase: 'abono', x })),
  ].sort((a, b) => b.x.updatedAt - a.x.updatedAt)
}

// Foto nueva del cierre con la cuenta de hoy, conservando lo que se CONTÓ. Es
// lo que guarda "Actualizar el cierre" cuando el cambio fue una corrección.
export function resumenActualizado(turno, hoy) {
  const r0 = turno?.resumen || {}
  return {
    ...r0,
    contado: hoy.contado, transferencias: hoy.transferencias, credito: hoy.credito,
    abonos: hoy.abonos, abonosTransfer: hoy.abonosTransfer, gastos: hoy.gastos,
    gastosTransfer: hoy.gastosTransfer, totalTransfer: hoy.totalTransfer, esperado: hoy.esperado,
    ventasCount: hoy.ventasCount,
    contadoReal: r0.contadoReal || 0,
    contadoTransfer: r0.contadoTransfer != null ? r0.contadoTransfer : null,
    diferencia: (r0.contadoReal || 0) - hoy.esperado,
    diferenciaTransfer: r0.contadoTransfer != null ? r0.contadoTransfer - hoy.totalTransfer : null,
  }
}
