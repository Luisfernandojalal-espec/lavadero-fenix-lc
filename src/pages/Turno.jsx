import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import { descargarCierrePDF } from '../pdf'
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
  const contado = vTurno.filter((v) => v.metodoPago !== 'credito').reduce((s, v) => s + v.total, 0)
  const credito = vTurno.filter((v) => v.metodoPago === 'credito').reduce((s, v) => s + v.total, 0)
  const abonosT = (abonos || []).filter((a) => a.fecha >= desde).reduce((s, a) => s + a.monto, 0)
  const gastosT = (gastos || []).filter((g) => !g.anulada && g.fecha >= desde).reduce((s, g) => s + g.monto, 0)
  const esperado = (abierto?.base || 0) + contado + abonosT - gastosT

  // --- Abrir turno ---
  const [abrirOpen, setAbrirOpen] = useState(false)
  const [base, setBase] = useState(0)
  async function abrirTurno() {
    const now = Date.now()
    await db.turnos.add(stamp({
      id: uid(), estado: 'abierto', mes: monthKey(now),
      abiertoEn: now, abiertoPor: user?.nombre || '', base,
    }))
    setAbrirOpen(false); setBase(0)
    show('Turno abierto')
  }

  // --- Cerrar turno ---
  const [cerrarOpen, setCerrarOpen] = useState(false)
  const [contadoReal, setContadoReal] = useState(0)
  async function cerrarTurno() {
    const diferencia = contadoReal - esperado
    const cerrado = {
      estado: 'cerrado', cerradoEn: Date.now(), cerradoPor: user?.nombre || '',
      resumen: {
        contado, credito, abonos: abonosT, gastos: gastosT,
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
            <button className="btn" onClick={() => { setBase(0); setAbrirOpen(true) }}>Abrir turno</button>
          </>
        )}

        {abierto && (
          <>
            <div className="dato-fuerte">
              Turno abierto por <b>{abierto.abiertoPor}</b> · {shortDate(abierto.abiertoEn)}
            </div>

            <table className="tabla">
              <tbody>
                <tr><td>Base de caja</td><td className="num">{money(abierto.base)}</td></tr>
                <tr><td>Ventas de contado ({vTurno.filter((v) => v.metodoPago !== 'credito').length})</td><td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>{money(contado)}</td></tr>
                <tr><td>Abonos recibidos</td><td className="num" style={{ color: 'var(--green)' }}>{money(abonosT)}</td></tr>
                <tr><td>Gastos pagados</td><td className="num" style={{ color: 'var(--red)' }}>−{money(gastosT)}</td></tr>
                <tr><td><b>Efectivo esperado en caja</b></td><td className="num"><b>{money(esperado)}</b></td></tr>
                <tr><td className="muted-cell">Ventas a crédito (no es efectivo)</td><td className="num muted-cell">{money(credito)}</td></tr>
              </tbody>
            </table>

            {mesasAbiertas.length > 0 && (
              <div className="helper" style={{ color: 'var(--amber)', margin: '10px 0' }}>
                Atención: hay {mesasAbiertas.length} {mesasAbiertas.length === 1 ? 'mesa abierta' : 'mesas abiertas'} sin cobrar.
              </div>
            )}

            <button className="btn" style={{ marginTop: 12 }} onClick={() => { setContadoReal(0); setCerrarOpen(true) }}>
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

      {/* Abrir turno */}
      <Sheet open={abrirOpen} onClose={() => setAbrirOpen(false)} title="Abrir turno">
        <label>Base de caja (efectivo con el que arrancas)</label>
        <MoneyInput value={base} onChange={setBase} />
        <div className="helper">Cuenta el efectivo que hay en la caja al empezar el turno.</div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={abrirTurno}>Abrir turno</button>
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
                <tr><td>Base de caja</td><td className="num">{money(det.base)}</td></tr>
                <tr><td>Ventas de contado</td><td className="num">{money(det.resumen?.contado)}</td></tr>
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
