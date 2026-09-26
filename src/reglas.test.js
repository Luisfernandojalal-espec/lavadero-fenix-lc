import { describe, it, expect } from 'vitest'
import {
  cuadreTurno, decidirTocaTurno, gastoTocaTurno,
  gastoMontoCaja, gastoMontoTransfer, medioPagoGasto,
  montoEfectivo, montoTransferencia, esGastoPnL, tipoGasto,
  cierreGuardado, editadosDespues, resumenActualizado, origenGasto,
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

  it('pasar a fijo un gasto pagado con el Nequi del turno NO lo saca del turno', () => {
    // 22/09: "INSUMOS 19 DE SEPTIEMBRE" $100.000 por Nequi pasó a fijo y el
    // cierre del sábado quedó en "Nequi: faltó $100.000".
    const original = gasto({ monto: 100_000, tipo: 'variable', medioPago: 'transferencia', salidaTurno: 1, tocaTurno: 1 })
    // Lo que manda la pantalla al guardarlo como fijo sin tocar nada más:
    const origen = origenGasto({ medioPago: 'transferencia', salidaTurno: true, fueraDeTurno: false })
    expect(origen.salidaTurno).toBe(1)
    const toca = decidirTocaTurno({ medioPago: 'transferencia', fueraDeTurno: origen.fueraDeTurno === 1, salidaTurno: origen.salidaTurno === 1, original })
    expect(toca).toBe(1)
    const r = cuadreTurno({ turno, gastos: [{ ...original, tipo: 'fijo', ...origen, tocaTurno: toca }] })
    expect(r.gastosTransfer).toBe(100_000)
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

  it('un FIJO pagado con la transferencia del turno baja el banco del turno, no el efectivo', () => {
    // 23/09: factura de Tigo (fijo) pagada con el Nequi del turno; la pantalla
    // solo dejaba decir "salió del turno" en gastos variables.
    const tocaTurno = decidirTocaTurno({ medioPago: 'transferencia', fueraDeTurno: false, salidaTurno: true })
    const tigo = gasto({ monto: 120_000, tipo: 'fijo', medioPago: 'transferencia', salidaTurno: 1, tocaTurno })
    const r = cuadreTurno({ turno, ventas: [], abonos: [], gastos: [tigo] })
    expect(r.totalTransfer).toBe(100_000 - 120_000)
    expect(r.esperado).toBe(727_300)
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

describe('pago de comisión al lavador', () => {
  // 19/09: si el dueño le paga la comisión a un lavador con plata de su
  // bolsillo, no tiene por qué descuadrarle la caja del turno.
  it('pagada del turno, descuenta del bolsillo que corresponda', () => {
    const efectivo = gasto({ categoria: 'comisiones', monto: 30_000, tipo: 'variable', medioPago: 'caja' })
    efectivo.tocaTurno = decidirTocaTurno({ medioPago: 'caja', fueraDeTurno: false, salidaTurno: true })
    const transfer = gasto({ categoria: 'comisiones', monto: 30_000, tipo: 'variable', medioPago: 'transferencia' })
    transfer.tocaTurno = decidirTocaTurno({ medioPago: 'transferencia', fueraDeTurno: false, salidaTurno: true })

    const rEf = cuadreTurno({ turno: { ...turno, base: 100_000 }, gastos: [efectivo] })
    expect(rEf.gastos).toBe(30_000)
    const rTr = cuadreTurno({ turno: { ...turno, baseTransferencia: 100_000 }, gastos: [transfer] })
    expect(rTr.gastosTransfer).toBe(30_000)
  })

  it('pagada de otra plata, NO toca el turno', () => {
    const toca = decidirTocaTurno({ medioPago: 'caja', fueraDeTurno: true, salidaTurno: false })
    expect(toca).toBe(0)
    const g = gasto({ categoria: 'comisiones', monto: 30_000, tipo: 'variable', medioPago: 'caja', fueraDeTurno: 1, tocaTurno: toca })
    const r = cuadreTurno({ turno: { ...turno, base: 100_000 }, gastos: [g] })
    expect(r.gastos).toBe(0)
    expect(r.esperado).toBe(100_000)
  })

  it('en cualquier caso la comisión NO es gasto del negocio: ya está en el neto de servicios', () => {
    expect(esGastoPnL(gasto({ categoria: 'comisiones' }))).toBe(false)
  })
})

describe('abono de un cliente (plata que ENTRA)', () => {
  it('en efectivo sube el efectivo esperado; por transferencia sube el banco', () => {
    const r = cuadreTurno({
      turno: { ...turno, base: 100_000, baseTransferencia: 50_000 },
      abonos: [
        { monto: 20_000, medioPago: 'caja', fecha: dentro },
        { monto: 30_000, medioPago: 'transferencia', fecha: dentro },
      ],
    })
    expect(r.esperado).toBe(120_000)
    expect(r.totalTransfer).toBe(80_000)
  })

  it('si esa plata no llegó al turno, no lo sube', () => {
    const r = cuadreTurno({
      turno: { ...turno, base: 100_000 },
      abonos: [{ monto: 20_000, medioPago: 'caja', fecha: dentro, fueraDeTurno: 1 }],
    })
    expect(r.abonos).toBe(0)
    expect(r.esperado).toBe(100_000)
  })

  it('los abonos viejos (sin la marca) siguen entrando al turno', () => {
    const r = cuadreTurno({
      turno: { ...turno, base: 100_000 },
      abonos: [{ monto: 20_000, fecha: dentro }], // sin medioPago ni marca
    })
    expect(r.esperado).toBe(120_000)
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

describe('un cierre muestra lo que dio ESA noche', () => {
  // 25/09: el dueño anotaba "cuadrada" al cerrar y días después la lista decía
  // "Nequi: faltó $100.000" porque se editó un movimiento de ese turno.
  const cerrado = {
    ...turno, estado: 'cerrado', updatedAt: T1,
    resumen: { esperado: 727_300, contadoReal: 727_300, totalTransfer: 100_000, contadoTransfer: 100_000 },
  }
  const editado = gasto({ monto: 100_000, tipo: 'fijo', medioPago: 'transferencia', salidaTurno: 1, tocaTurno: 1, updatedAt: T1 + 86_400_000 })

  it('editar un movimiento después NO cambia el resultado del cierre', () => {
    const hoy = cuadreTurno({ turno: cerrado, ventas: [], abonos: [], gastos: [editado] })
    const r = cierreGuardado(cerrado, hoy)
    expect(r.diferencia).toBe(0)
    expect(r.diferenciaTransfer).toBe(0)
    expect(hoy.diferenciaTransfer).toBe(100_000)  // la cuenta de hoy sí cambió…
    expect(r.cambio).toBe(true)                    // …y se avisa
    expect(r.cambioTransfer).toBe(-100_000)
  })

  it('y señala cuál movimiento se editó después del cierre', () => {
    const antes = gasto({ monto: 5_000, updatedAt: dentro })
    const fuera = gasto({ monto: 9_000, fecha: T1 + 10, updatedAt: T1 + 86_400_000 })
    const lista = editadosDespues(cerrado, { gastos: [editado, antes, fuera] })
    expect(lista.map((m) => m.x)).toEqual([editado])
  })

  it('si nada cambió, no hay aviso', () => {
    const hoy = cuadreTurno({ turno: cerrado, ventas: [], abonos: [], gastos: [] })
    expect(cierreGuardado(cerrado, hoy).cambio).toBe(false)
  })

  it('corregir el conteo recalcula la diferencia contra lo de esa noche', () => {
    const corregido = { ...cerrado, resumen: { ...cerrado.resumen, contadoReal: 700_000 } }
    const hoy = cuadreTurno({ turno: corregido, ventas: [], abonos: [], gastos: [editado] })
    expect(cierreGuardado(corregido, hoy).diferencia).toBe(700_000 - 727_300)
  })

  it('aceptar el cambio actualiza la foto y conserva lo contado', () => {
    const hoy = cuadreTurno({ turno: cerrado, ventas: [], abonos: [], gastos: [editado] })
    const nuevo = { ...cerrado, resumen: resumenActualizado(cerrado, hoy) }
    const r = cierreGuardado(nuevo, cuadreTurno({ turno: nuevo, ventas: [], abonos: [], gastos: [editado] }))
    expect(r.cambio).toBe(false)
    expect(r.contadoTransfer).toBe(100_000)
    expect(r.diferenciaTransfer).toBe(100_000)
  })

  it('un cierre viejo sin foto completa sigue mostrando la cuenta de hoy', () => {
    const viejo = { ...turno, resumen: { contadoReal: 727_300 } }
    const hoy = cuadreTurno({ turno: viejo, ventas: [], abonos: [], gastos: [] })
    const r = cierreGuardado(viejo, hoy)
    expect(r.diferencia).toBe(0)
    expect(r.cambio).toBe(false)
  })
})
