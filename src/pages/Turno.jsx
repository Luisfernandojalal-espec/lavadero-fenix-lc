import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, gastoDeCaja, tipoGasto, labelMedioGasto } from '../db'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import { descargarCierrePDF } from '../pdf'
import { montoEfectivo, montoTransferencia } from '../ventas'
import { useAuth } from '../auth'

export default function Turno() {
  const { user } = useAuth()
  const { show, node } = useToast()
  const esDueno = user?.rol === 'dueño'

  const turnos = useLiveQuery(() => db.turnos.toArray(), [], [])
  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const abonos = useLiveQuery(() => db.abonos.toArray(), [], [])
  const gastos = useLiveQuery(() => db.gastos.toArray(), [], [])
  const mesas = useLiveQuery(() => db.mesas.where('activo').equals(1).toArray(), [], [])

  const abierto = (turnos || []).find((t) => t.estado === 'abierto')
  const cerrados = (turnos || []).filter((t) => t.estado === 'cerrado').sort((a, b) => b.cerradoEn - a.cerradoEn)
  const mesasAbiertas = (mesas || []).filter((m) => m.estado === 'ocupada')

  // Resumen en vivo del turno abierto
  const desde = abierto?.abiertoEn || 0
  const vTurno = (ventas || []).filter((v) => !v.anulada && v.fecha >= desde)
  // Efectivo y transferencia consideran la parte de cada uno en los pagos mixtos.
  const efectivoV = vTurno.filter((v) => montoEfectivo(v) > 0)
  const efectivo = vTurno.reduce((s, v) => s + montoEfectivo(v), 0)
  const transferencias = vTurno.reduce((s, v) => s + montoTransferencia(v), 0)
  const credito = vTurno.filter((v) => v.metodoPago === 'credito').reduce((s, v) => s + v.total, 0)
  const abonosT = (abonos || []).filter((a) => a.fecha >= desde).reduce((s, a) => s + a.monto, 0)
  // Salidas/pagos del turno = TODO gasto VARIABLE hecho durante el turno: lo
  // registrado con "Registrar salida / pago", las comisiones pagadas y los gastos
  // variables de la pestaña Gastos (efectivo baja la caja, transferencia baja el
  // banco). Los gastos FIJOS del mes (arriendo, luz, agua, nómina) NO cuentan: son
  // costos mensuales, no plata que salió de esta caja/turno.
  const salidasT = (gastos || []).filter((g) => !g.anulada && g.fecha >= desde && tipoGasto(g) === 'variable').sort((a, b) => b.fecha - a.fecha)
  // Los gastos pagados DE CAJA descuadran el efectivo; los de transferencia/banco (Nequi) bajan el saldo digital.
  const gastosT = salidasT.filter(gastoDeCaja).reduce((s, g) => s + g.monto, 0)
  const gastosTransferT = salidasT.filter((g) => !gastoDeCaja(g)).reduce((s, g) => s + g.monto, 0)
  // Solo el efectivo entra a la caja física (transferencias van al banco)
  const esperado = (abierto?.base || 0) + efectivo + abonosT - gastosT
  // Transferencia/banco (Nequi): base + ventas por transferencia − pagos hechos por transferencia.
  const baseTransferAbierto = abierto?.baseTransferencia || 0
  const totalTransfer = baseTransferAbierto + transferencias - gastosTransferT

  // --- Abrir turno ---
  const [abrirOpen, setAbrirOpen] = useState(false)
  const [base, setBase] = useState(0)                 // efectivo con el que se abre
  const [baseTransfer, setBaseTransfer] = useState(0) // transferencia/banco con la que se abre
  async function abrirTurno() {
    // Evita dos turnos abiertos (ej. otro dispositivo lo abrió hace un momento)
    const yaAbierto = (await db.turnos.toArray()).some((t) => t.estado === 'abierto')
    if (yaAbierto) { setAbrirOpen(false); return show('Ya hay un turno abierto') }
    const now = Date.now()
    await db.turnos.add(stamp({
      id: uid(), estado: 'abierto', mes: monthKey(now),
      abiertoEn: now, abiertoPor: user?.nombre || '', base, baseTransferencia: baseTransfer,
    }))
    setAbrirOpen(false); setBase(0); setBaseTransfer(0)
    show('Turno abierto')
  }

  // --- Editar la apertura de un turno YA abierto (ajustar bases sin cerrarlo) ---
  const [editApOpen, setEditApOpen] = useState(false)
  function abrirEditarApertura() {
    setBase(abierto.base || 0)
    setBaseTransfer(abierto.baseTransferencia || 0)
    setEditApOpen(true)
  }
  async function guardarApertura() {
    await db.turnos.update(abierto.id, stamp({ base, baseTransferencia: baseTransfer }))
    setEditApOpen(false)
    show('Apertura del turno actualizada')
  }

  // --- Registrar / editar una salida / pago del turno (ej. pagos por Nequi) ---
  const [salidaOpen, setSalidaOpen] = useState(false)
  const [salEditId, setSalEditId] = useState(null) // null = nueva; id = editando
  const [salConcepto, setSalConcepto] = useState('')
  const [salMonto, setSalMonto] = useState(0)
  const [salMedio, setSalMedio] = useState('transferencia') // Nequi por defecto (el caso del cliente)
  function nuevaSalida() { setSalEditId(null); setSalConcepto(''); setSalMonto(0); setSalMedio('transferencia'); setSalidaOpen(true) }
  function editarSalida(g) { setSalEditId(g.id); setSalConcepto(g.concepto || ''); setSalMonto(g.monto || 0); setSalMedio(g.medioPago || 'transferencia'); setSalidaOpen(true) }
  async function guardarSalida() {
    if (!salConcepto.trim()) return show('Escribe qué se pagó')
    if (salMonto <= 0) return show('Escribe el valor')
    if (salEditId) {
      await db.gastos.update(salEditId, stamp({ concepto: salConcepto.trim(), monto: salMonto, medioPago: salMedio }))
      show('Salida actualizada')
    } else {
      const now = Date.now()
      await db.gastos.add(stamp({
        id: uid(), concepto: salConcepto.trim(), categoria: 'otro', monto: salMonto,
        tipo: 'variable', medioPago: salMedio, responsable: user?.nombre || '',
        salidaTurno: 1, // salió de la caja/transferencia de ESTE turno
        fecha: now, mes: monthKey(now),
      }))
      show('Salida registrada')
    }
    setSalidaOpen(false)
  }
  async function eliminarSalida() {
    if (!salEditId) return
    await db.gastos.update(salEditId, stamp({ anulada: 1 }))
    setSalidaOpen(false)
    show('Salida eliminada')
  }

  // --- Cerrar turno ---
  const [cerrarOpen, setCerrarOpen] = useState(false)
  const [contadoReal, setContadoReal] = useState(0)
  async function cerrarTurno() {
    const diferencia = contadoReal - esperado
    const cerrado = {
      estado: 'cerrado', cerradoEn: Date.now(), cerradoPor: user?.nombre || '',
      resumen: {
        contado: efectivo, transferencias, credito, abonos: abonosT, gastos: gastosT,
        gastosTransfer: gastosTransferT, totalTransfer,
        esperado, contadoReal, diferencia, ventasCount: vTurno.length,
      },
    }
    await db.turnos.update(abierto.id, stamp(cerrado))
    setCerrarOpen(false); setContadoReal(0)
    show(diferencia === 0 ? 'Turno cerrado · caja cuadrada' : 'Turno cerrado')
    // Descarga automática del comprobante
    descargarCierrePDF({ ...abierto, ...cerrado })
  }

  // Detalle de un cierre anterior
  const [det, setDet] = useState(null)

  const difColor = (d) => (d === 0 ? 'var(--green)' : d > 0 ? 'var(--amber)' : 'var(--red)')

  return (
    <>
      <Header title="Turno" sub="Apertura y cierre de caja" />
      <div className="content">

        {!abierto && (
          <>
            <div className="empty" style={{ paddingBottom: 12 }}>No hay un turno abierto.</div>
            <button className="btn" onClick={() => { setBase(0); setBaseTransfer(0); setAbrirOpen(true) }}>Abrir turno</button>
          </>
        )}

        {abierto && (
          <>
            <div className="dato-fuerte">
              Turno abierto por <b>{abierto.abiertoPor}</b> · {shortDate(abierto.abiertoEn)}
            </div>

            <table className="tabla">
              <tbody>
                <tr><td>Base efectivo (apertura)</td><td className="num">{money(abierto.base)}</td></tr>
                <tr><td>Ventas en efectivo ({efectivoV.length})</td><td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>{money(efectivo)}</td></tr>
                <tr><td>Abonos recibidos</td><td className="num" style={{ color: 'var(--green)' }}>{money(abonosT)}</td></tr>
                <tr><td>Gastos pagados de caja</td><td className="num" style={{ color: 'var(--red)' }}>−{money(gastosT)}</td></tr>
                <tr><td><b>Efectivo esperado en caja</b></td><td className="num"><b>{money(esperado)}</b></td></tr>
                <tr><td className="muted-cell">Base transferencia (apertura)</td><td className="num muted-cell">{money(baseTransferAbierto)}</td></tr>
                <tr><td className="muted-cell">Ventas por transferencia (al banco)</td><td className="num muted-cell">{money(transferencias)}</td></tr>
                <tr><td className="muted-cell">Pagos por transferencia (Nequi)</td><td className="num muted-cell" style={{ color: 'var(--red)' }}>−{money(gastosTransferT)}</td></tr>
                <tr><td><b>Debe quedar en transferencia</b></td><td className="num"><b>{money(totalTransfer)}</b></td></tr>
                <tr><td className="muted-cell">Ventas a crédito (fiado)</td><td className="num muted-cell">{money(credito)}</td></tr>
              </tbody>
            </table>

            {mesasAbiertas.length > 0 && (
              <div className="helper" style={{ color: 'var(--amber)', margin: '10px 0' }}>
                Atención: hay {mesasAbiertas.length} {mesasAbiertas.length === 1 ? 'mesa abierta' : 'mesas abiertas'} sin cobrar.
              </div>
            )}

            {esDueno && (
              <button className="btn secondary" style={{ marginTop: 12 }} onClick={nuevaSalida}>
                Registrar salida / pago (Nequi o caja)
              </button>
            )}

            {salidasT.length > 0 && (
              <>
                <div className="section-title">Salidas del turno</div>
                <div className="helper" style={{ marginTop: -4, marginBottom: 6 }}>Gastos variables del turno: lo registrado aquí, las comisiones pagadas y los gastos variables de la pestaña Gastos hechos durante el turno. Los gastos fijos del mes (arriendo, luz…) NO cuentan.{esDueno ? ' Toca una salida para corregirla.' : ''}</div>
                <table className="tabla">
                  <tbody>
                    {salidasT.slice(0, 20).map((g) => {
                      const editable = esDueno && g.categoria !== 'comisiones'
                      return (
                        <tr key={g.id} onClick={editable ? () => editarSalida(g) : undefined} style={editable ? { cursor: 'pointer' } : undefined}>
                          <td>{g.concepto || 'Salida'}<div className="muted-cell">{labelMedioGasto(g.medioPago)}{g.responsable ? ' · ' + g.responsable : ''}{editable ? ' · toca para editar' : ''}</div></td>
                          <td className="num" style={{ color: 'var(--red)', fontWeight: 700, whiteSpace: 'nowrap' }}>−{money(g.monto)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}

            <button className="btn secondary" style={{ marginTop: 12 }} onClick={abrirEditarApertura}>
              Editar apertura (efectivo / transferencia)
            </button>

            <button className="btn" style={{ marginTop: 10 }} onClick={() => { setContadoReal(0); setCerrarOpen(true) }}>
              Cerrar turno
            </button>
          </>
        )}

        {esDueno && cerrados.length > 0 && (
          <>
            <div className="section-title">Cierres anteriores</div>
            {cerrados.slice(0, 20).map((t) => (
              <div className="row" key={t.id} onClick={() => setDet(t)} style={{ cursor: 'pointer' }}>
                <div className="main">
                  <div className="title">{shortDate(t.cerradoEn)}</div>
                  <div className="meta">{t.abiertoPor} → {t.cerradoPor} · {t.resumen?.ventasCount ?? 0} ventas</div>
                </div>
                <div className="right">
                  <div style={{ fontWeight: 700 }}>{money(t.resumen?.contadoReal)}</div>
                  <div className="meta" style={{ color: difColor(t.resumen?.diferencia || 0) }}>
                    {(t.resumen?.diferencia || 0) === 0 ? 'Cuadrada' :
                      (t.resumen.diferencia > 0 ? `Sobró ${money(t.resumen.diferencia)}` : `Faltó ${money(-t.resumen.diferencia)}`)}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Registrar salida / pago del turno */}
      <Sheet open={salidaOpen} onClose={() => setSalidaOpen(false)} title={salEditId ? 'Editar salida' : 'Registrar salida / pago'}>
        <div className="helper" style={{ marginBottom: 8 }}>Un pago que hiciste durante el turno (pago de factura, recarga, domicilio, insumo…). Se descuenta de la caja y queda registrado.</div>
        <label>¿Qué se pagó?</label>
        <input value={salConcepto} placeholder="Ej: Pago factura proveedor, recarga…"
          onChange={(e) => setSalConcepto(e.target.value)} />
        <label>Valor</label>
        <MoneyInput value={salMonto} onChange={setSalMonto} />
        <label>¿De dónde salió?</label>
        <div className="pill-row">
          <button className={`pill ${salMedio === 'transferencia' ? 'active' : ''}`} onClick={() => setSalMedio('transferencia')}>Transferencia (Nequi)</button>
          <button className={`pill ${salMedio === 'caja' ? 'active' : ''}`} onClick={() => setSalMedio('caja')}>Efectivo (caja)</button>
        </div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarSalida}>{salEditId ? 'Guardar cambios' : 'Registrar salida'}</button>
        {salEditId && <><div style={{ height: 10 }} /><button className="btn danger" onClick={eliminarSalida}>Eliminar salida</button></>}
      </Sheet>

      {/* Abrir turno */}
      <Sheet open={abrirOpen} onClose={() => setAbrirOpen(false)} title="Abrir turno">
        <label>Efectivo con el que abres</label>
        <MoneyInput value={base} onChange={setBase} />
        <div className="helper">El efectivo que hay en la caja al empezar el turno.</div>
        <label>Transferencia con la que abres (banco)</label>
        <MoneyInput value={baseTransfer} onChange={setBaseTransfer} />
        <div className="helper">Saldo inicial en transferencia / banco. Opcional.</div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={abrirTurno}>Abrir turno</button>
      </Sheet>

      {/* Editar apertura del turno ya abierto (ajusta bases sin cerrarlo) */}
      <Sheet open={editApOpen} onClose={() => setEditApOpen(false)} title="Editar apertura del turno">
        <label>Efectivo con el que abriste</label>
        <MoneyInput value={base} onChange={setBase} />
        <label>Transferencia con la que abriste (banco)</label>
        <MoneyInput value={baseTransfer} onChange={setBaseTransfer} />
        <div className="helper">Ajusta las bases del turno abierto. No cambia las ventas ya registradas; solo recalcula el efectivo esperado y el total en transferencia.</div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarApertura}>Guardar</button>
      </Sheet>

      {/* Cerrar turno */}
      <Sheet open={cerrarOpen} onClose={() => setCerrarOpen(false)} title="Cerrar turno">
        <div className="dato-fuerte">Efectivo esperado: <b>{money(esperado)}</b></div>
        <label>Efectivo contado (lo que hay realmente en caja)</label>
        <MoneyInput value={contadoReal} onChange={setContadoReal} />
        {contadoReal > 0 && (
          <div className="helper" style={{ marginTop: 8, fontSize: 14, color: difColor(contadoReal - esperado) }}>
            {contadoReal - esperado === 0 ? 'Caja cuadrada.' :
              contadoReal - esperado > 0 ? `Sobrante de ${money(contadoReal - esperado)}` :
                `Faltante de ${money(esperado - contadoReal)}`}
          </div>
        )}
        {mesasAbiertas.length > 0 && (
          <div className="helper" style={{ color: 'var(--amber)', marginTop: 8 }}>
            Hay {mesasAbiertas.length} {mesasAbiertas.length === 1 ? 'mesa abierta' : 'mesas abiertas'}. Se recomienda cobrarlas antes de cerrar.
          </div>
        )}
        <div style={{ height: 14 }} />
        <button className="btn" onClick={cerrarTurno}>Confirmar cierre</button>
        <div className="helper" style={{ textAlign: 'center', marginTop: 6 }}>Se descarga el comprobante en PDF.</div>
      </Sheet>

      {/* Detalle de cierre anterior */}
      <Sheet open={!!det} onClose={() => setDet(null)} title={det ? `Cierre · ${shortDate(det.cerradoEn)}` : ''}>
        {det && (
          <>
            <table className="tabla">
              <tbody>
                <tr><td>Apertura</td><td className="num">{shortDate(det.abiertoEn)} · {det.abiertoPor}</td></tr>
                <tr><td>Cierre</td><td className="num">{shortDate(det.cerradoEn)} · {det.cerradoPor}</td></tr>
                <tr><td>Base efectivo (apertura)</td><td className="num">{money(det.base)}</td></tr>
                <tr><td>Ventas en efectivo</td><td className="num">{money(det.resumen?.contado)}</td></tr>
                <tr><td>Base transferencia (apertura)</td><td className="num">{money(det.baseTransferencia || 0)}</td></tr>
                <tr><td>Ventas por transferencia</td><td className="num">{money(det.resumen?.transferencias || 0)}</td></tr>
                {(det.resumen?.gastosTransfer || 0) > 0 && <tr><td>Pagos por transferencia (Nequi)</td><td className="num" style={{ color: 'var(--red)' }}>−{money(det.resumen.gastosTransfer)}</td></tr>}
                <tr><td>Debe quedar en transferencia</td><td className="num">{money(det.resumen?.totalTransfer ?? ((det.baseTransferencia || 0) + (det.resumen?.transferencias || 0) - (det.resumen?.gastosTransfer || 0)))}</td></tr>
                <tr><td>Abonos recibidos</td><td className="num">{money(det.resumen?.abonos)}</td></tr>
                <tr><td>Gastos pagados</td><td className="num">−{money(det.resumen?.gastos)}</td></tr>
                <tr><td><b>Efectivo esperado</b></td><td className="num"><b>{money(det.resumen?.esperado)}</b></td></tr>
                <tr><td>Efectivo contado</td><td className="num">{money(det.resumen?.contadoReal)}</td></tr>
                <tr>
                  <td style={{ color: difColor(det.resumen?.diferencia || 0), fontWeight: 700 }}>
                    {(det.resumen?.diferencia || 0) === 0 ? 'Caja cuadrada' : det.resumen.diferencia > 0 ? 'Sobrante' : 'Faltante'}
                  </td>
                  <td className="num" style={{ color: difColor(det.resumen?.diferencia || 0), fontWeight: 700 }}>
                    {money(Math.abs(det.resumen?.diferencia || 0))}
                  </td>
                </tr>
                <tr><td className="muted-cell">Ventas a crédito</td><td className="num muted-cell">{money(det.resumen?.credito)}</td></tr>
              </tbody>
            </table>
            <div style={{ height: 12 }} />
            <button className="btn" onClick={() => descargarCierrePDF(det)}>Descargar comprobante (PDF)</button>
          </>
        )}
      </Sheet>

      {node}
    </>
  )
}
