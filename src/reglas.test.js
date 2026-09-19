import { describe, it, expect } from 'vitest'
import {
  cuadreTurno, decidirTocaTurno, gastoTocaTurno,
  gastoMontoCaja, gastoMontoTransfer, medioPagoGasto,
  montoEfectivo, montoTransferencia, esGastoPnL, tipoGasto,
} from './reglas'

// Cada prueba nace de un error REAL que le costó plata o confianza al dueño.
// Si alguna falla, no publiques: se está repitiendo algo que ya pasó.

const T0 = 1_000_000            // apertura del turno
const T1 = 2_000_000            // cierre del turno
const dentro = 1_500_000        // un momento dentro del turno
const turno = { abiertoEn: T0, cerradoEn: T1, base: 727_300, baseTransferencia: 100_000 }
const gasto = (o) => ({ monto: 0, fecha: dentro, medioPago: 'caja', ...o })
const venta = (o) => ({ total: 0, fecha: dentro, metodoPago: 'efectivo', ...o })

describe('reclasificar fijo/variable NO mueve un cierre ya hecho', () => {
  // 15/09: reclasificó a fijo un pago de $520.000 y apareció "Faltó $520.000"
  // en un turno cerrado días antes. Pasó DOS veces (la segunda la causé yo).
  it('un gasto que ya contaba sigue contando aunque pase a fijo', () => {
    const original = gasto({ monto: 520_000, tipo: 'variable', medioPago: 'caja' })
    // El operador solo cambia el tipo: NO toca los selectores de origen.
    const toca = decidirTocaTurno({ medioPago: 'caja', fueraDeTurno: false, salidaTurno: false, original })
    expect(toca).toBe(1)

    const yaFijo = gasto({ monto: 520_000, tipo: 'fijo', tocaTurno: toca })
    const r = cuadreTurno({ turno: { ...turno, resumen: { contadoReal: 207_300 } }, gastos: [yaFijo] })
    expect(r.gastos).toBe(520_000)
    expect(r.esperado).toBe(207_300)
    expect(r.diferencia).toBe(0)   // cuadrada, no "faltó 520.000"
  })

  it('pero si el operador dice a propósito que salió de otra plata, sí sale del turno', () => {
    const original = gasto({ monto: 520_000, tipo: 'variable', medioPago: 'caja' })
    const toca = decidirTocaTurno({ medioPago: 'caja', fueraDeTurno: true, salidaTurno: false, original })
    expect(toca).toBe(0)
  })
})

describe('de dónde salió la plata', () => {
  it('"de otra plata" nunca descuenta, aunque sea efectivo', () => {
    expect(gastoTocaTurno(gasto({ monto: 40_000, tipo: 'variable', fueraDeTurno: 1, tocaTurno: 0 }))).toBe(false)
  })

  it('un fijo nuevo desde plantilla no toca el turno', () => {
    expect(decidirTocaTurno({ medioPago: 'caja', fueraDeTurno: true, salidaTurno: false })).toBe(0)
  })

  it('un fijo que SÍ salió del cajón descuenta', () => {
    expect(decidirTocaTurno({ medioPago: 'caja', fueraDeTurno: false, salidaTurno: false })).toBe(1)
  })

  it('transferencia solo cuenta si se marcó como salida del turno', () => {
    expect(decidirTocaTurno({ medioPago: 'transferencia', fueraDeTurno: false, salidaTurno: false })).toBe(0)
    expect(decidirTocaTurno({ medioPago: 'transferencia', fueraDeTurno: false, salidaTurno: true })).toBe(1)
  })

  it('una compra por transferencia pega al banco, NO al efectivo', () => {
    // 17/09: registró una compra en transferencia y le descontó de la caja.
    const g = gasto({ monto: 90_058, ...medioPagoGasto('transferencia', 90_058), salidaTurno: 1 })
    expect(gastoMontoCaja(g)).toBe(0)
    expect(gastoMontoTransfer(g)).toBe(90_058)
  })

  it('un pago mixto se reparte entre caja y banco', () => {
    const g = gasto({ monto: 20_000, ...medioPagoGasto('mixto', 20_000, 12_000), salidaTurno: 1 })
    expect(gastoMontoCaja(g)).toBe(12_000)
    expect(gastoMontoTransfer(g)).toBe(8_000)
    expect(gastoMontoCaja(g) + gastoMontoTransfer(g)).toBe(g.monto)
  })
})

describe('gasto pagado MIXTO (parte efectivo, parte transferencia)', () => {
  // 19/09: el dueño pagó un gasto con un poco de efectivo y el resto por Nequi,
  // y en Gastos solo podía elegir uno de los dos.
  it('del turno: la parte en efectivo baja la caja y el resto baja el Nequi', () => {
    const g = gasto({ monto: 50_000, tipo: 'variable', ...medioPagoGasto('mixto', 50_000, 20_000), salidaTurno: 1 })
    g.tocaTurno = decidirTocaTurno({ medioPago: 'mixto', fueraDeTurno: false, salidaTurno: true })
    const r = cuadreTurno({ turno: { ...turno, base: 100_000, baseTransferencia: 80_000 }, gastos: [g] })
    expect(r.gastos).toBe(20_000)          // de la caja
    expect(r.gastosTransfer).toBe(30_000)  // del Nequi
    expect(r.esperado).toBe(80_000)
    expect(r.totalTransfer).toBe(50_000)
  })

  it('de otra plata: no toca ninguno de los dos bolsillos', () => {
    const toca = decidirTocaTurno({ medioPago: 'mixto', fueraDeTurno: false, salidaTurno: false })
    expect(toca).toBe(0)
    const g = gasto({ monto: 50_000, tipo: 'variable', ...medioPagoGasto('mixto', 50_000, 20_000), tocaTurno: toca })
    const r = cuadreTurno({ turno: { ...turno, base: 100_000, baseTransferencia: 80_000 }, gastos: [g] })
    expect(r.gastos).toBe(0)
    expect(r.gastosTransfer).toBe(0)
  })

  it('si el efectivo declarado supera el total, no se inventa plata', () => {
    const m = medioPagoGasto('mixto', 30_000, 99_999)
    expect(m.pagoEfectivo).toBe(30_000)
    expect(m.pagoTransferencia).toBe(0)
  })
})

describe('la cuenta del turno cierra', () => {
  it('base + ventas + abonos − gastos = efectivo esperado', () => {
    const r = cuadreTurno({
      turno: { ...turno, base: 205_000, baseTransferencia: 186_000 },
      ventas: [venta({ total: 37_000 }), venta({ total: 65_000, metodoPago: 'transferencia' })],
      abonos: [{ monto: 20_000, medioPago: 'caja', fecha: dentro }],
      gastos: [gasto({ monto: 38_500, tipo: 'variable', tocaTurno: 1 })],
    })
    expect(r.esperado).toBe(205_000 + 37_000 + 20_000 - 38_500)
    expect(r.totalTransfer).toBe(186_000 + 65_000)
    expect(r.contado + r.credito + r.transferencias).toBe(37_000 + 65_000)
  })

  it('el fiado no entra al arqueo: esa plata no llegó', () => {
    const r = cuadreTurno({ turno, ventas: [venta({ total: 40_000, metodoPago: 'credito' })] })
    expect(r.credito).toBe(40_000)
    expect(r.contado).toBe(0)
    expect(r.esperado).toBe(turno.base)
  })

  it('lo de fuera del rango del turno no cuenta', () => {
    const r = cuadreTurno({
      turno,
      ventas: [venta({ total: 50_000, fecha: T0 - 1 }), venta({ total: 70_000, fecha: T1 + 1 })],
      gastos: [gasto({ monto: 99_000, tipo: 'variable', fecha: T1 + 1, tocaTurno: 1 })],
    })
    expect(r.contado).toBe(0)
    expect(r.gastos).toBe(0)
  })

  it('lo anulado no cuenta', () => {
    const r = cuadreTurno({
      turno,
      ventas: [venta({ total: 50_000, anulada: 1 })],
      abonos: [{ monto: 10_000, medioPago: 'caja', fecha: dentro, anulada: 1 }],
      gastos: [gasto({ monto: 30_000, tipo: 'variable', tocaTurno: 1, anulada: 1 })],
    })
    expect(r.esperado).toBe(turno.base)
  })

  it('el conteo físico se conserva; la diferencia se recalcula', () => {
    const r = cuadreTurno({
      turno: { ...turno, base: 100_000, resumen: { contadoReal: 95_000 } },
      gastos: [],
    })
    expect(r.contadoReal).toBe(95_000)     // no se recalcula: es un conteo manual
    expect(r.diferencia).toBe(-5_000)      // faltó 5.000
  })

  it('sin conteo de transferencia no se inventa un descuadre', () => {
    const r = cuadreTurno({ turno: { ...turno, resumen: { contadoReal: 0 } } })
    expect(r.contadoTransfer).toBeNull()
    expect(r.diferenciaTransfer).toBeNull()
  })
})

describe('qué es gasto del negocio (P&L)', () => {
  it('comisiones, inventario, retiro y préstamo mueven caja pero no son gasto', () => {
    for (const categoria of ['comisiones', 'inventario', 'retiro', 'prestamo']) {
      expect(esGastoPnL(gasto({ categoria }))).toBe(false)
    }
    expect(esGastoPnL(gasto({ categoria: 'otro' }))).toBe(true)
  })

  it('reclasificar cambia el P&L pero no el arqueo', () => {
    const g = gasto({ monto: 520_000, tipo: 'fijo', categoria: 'otro', tocaTurno: 1 })
    expect(tipoGasto(g)).toBe('fijo')      // contablemente es fijo
    expect(gastoTocaTurno(g)).toBe(true)   // pero la plata sí salió del cajón
  })
})

describe('ventas por medio de pago', () => {
  it('un pago mixto reparte la venta sin perder ni inventar plata', () => {
    const v = venta({ total: 25_000, metodoPago: 'mixto', pagoEfectivo: 10_000, pagoTransferencia: 15_000 })
    expect(montoEfectivo(v)).toBe(10_000)
    expect(montoTransferencia(v)).toBe(15_000)
    expect(montoEfectivo(v) + montoTransferencia(v)).toBe(v.total)
  })

  it('una venta vieja sin medio de pago cuenta como efectivo', () => {
    const v = { total: 12_000, fecha: dentro }
    expect(montoEfectivo(v)).toBe(12_000)
  })
})
