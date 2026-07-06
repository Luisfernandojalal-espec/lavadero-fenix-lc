import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { money, dayKey, monthKey, shortDate, fechaLarga } from '../format'
import { esEfectivo } from '../ventas'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import { useAuth } from '../auth'

const iniciales = (nombre) => String(nombre || '')
  .trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·'

// embedded: se muestra dentro de otra página (Inicio), sin Header ni KPIs.
export default function Lavadores({ embedded }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { show, node } = useToast()

  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const pagos = useLiveQuery(() => db.pagos_comision.toArray(), [], [])

  const hoy = dayKey()
  const ventasHoy = (ventas || []).filter((v) => !v.anulada && dayKey(v.fecha) === hoy)
  const ventasServHoy = ventasHoy.filter((v) => v.tipo === 'servicio')
  const ventasServ = (ventas || []).filter((v) => v.tipo === 'servicio' && !v.anulada && v.trabajadorId)

  // KPIs de HOY
  const kServicios = ventasServHoy.reduce((s, v) => s + (v.cantidad || 1), 0)
  const kEfectivo = ventasHoy.filter(esEfectivo).reduce((s, v) => s + v.total, 0)
  const kTransfer = ventasHoy.filter((v) => v.metodoPago === 'transferencia').reduce((s, v) => s + v.total, 0)
  const kTotal = ventasHoy.reduce((s, v) => s + v.total, 0)

  function statsDe(tId) {
    const mias = ventasServHoy.filter((v) => v.trabajadorId === tId)
    const servicios = mias.reduce((s, v) => s + (v.cantidad || 1), 0)
    const total = mias.reduce((s, v) => s + v.total, 0)
    const comisionHoy = mias.reduce((s, v) => s + (v.comision || 0), 0)
    const generado = ventasServ.filter((v) => v.trabajadorId === tId).reduce((s, v) => s + (v.comision || 0), 0)
    const pagado = (pagos || []).filter((p) => p.trabajadorId === tId).reduce((s, p) => s + p.monto, 0)
    return { servicios, total, comisionHoy, pendiente: Math.max(0, generado - pagado) }
  }

  // Planilla de lavadas desde el último pago (para "Ver detalle")
  function planillaDe(tId) {
    const ultimoPago = (pagos || []).filter((p) => p.trabajadorId === tId).reduce((m, p) => Math.max(m, p.fecha), 0)
    return ventasServ.filter((v) => v.trabajadorId === tId && v.fecha > ultimoPago).sort((a, b) => b.fecha - a.fecha)
  }

  const [detalle, setDetalle] = useState(null)
  const [pagoA, setPagoA] = useState(null)
  const [montoPago, setMontoPago] = useState(0)

  function abrirPago(t) { setPagoA(t); setMontoPago(statsDe(t.id).pendiente) }
  async function pagar() {
    if (montoPago <= 0) return show('Escribe el valor a pagar')
    const now = Date.now()
    await db.pagos_comision.add(stamp({
      id: uid(), trabajadorId: pagoA.id, trabajadorNombre: pagoA.nombre,
      monto: montoPago, fecha: now, mes: monthKey(now), pagadoPor: user?.nombre || '',
    }))
    await db.gastos.add(stamp({
      id: uid(), concepto: `Comisiones ${pagoA.nombre}`, categoria: 'comisiones',
      monto: montoPago, tipo: 'variable', medioPago: 'caja', fecha: now, mes: monthKey(now),
    }))
    setPagoA(null); setMontoPago(0); show('Pago de comisiones registrado')
  }

  const lista = (trabajadores || []).filter((t) => t.rol !== 'dueño')
    .slice().sort((a, b) => a.nombre.localeCompare(b.nombre))

  const vacio = lista.length === 0 && (
    embedded
      ? <div className="helper">Aún no hay lavadores. Créalos en Admin → Trabajadores.</div>
      : (
        <div className="empty">
          No hay lavadores todavía.
          <div style={{ height: 12 }} />
          <button className="btn" style={{ maxWidth: 320 }} onClick={() => navigate('/config')}>Crear lavadores (Admin)</button>
        </div>
      )
  )

  const tarjetas = (
    <div className="lav-grid">
      {lista.map((t) => {
        const st = statsDe(t.id)
        return (
          <div className="lav-card" key={t.id}>
            <div className="lav-avatar">{iniciales(t.nombre)}</div>
            <div className="lav-nombre">{t.nombre}</div>
            <div className="lav-serv">{st.servicios} servicio{st.servicios === 1 ? '' : 's'} hoy</div>
            <div className="lav-total">{money(st.total)}</div>
            <div className="lav-meta">Comisión hoy {money(st.comisionHoy)}</div>
            <div className="lav-meta">
              Pendiente <b style={{ color: st.pendiente > 0 ? 'var(--red)' : 'var(--green)' }}>{money(st.pendiente)}</b>
            </div>
            <div className="lav-actions">
              <button className="chip-lavador" onClick={() => setDetalle(t)}>Ver detalle</button>
              {st.pendiente > 0 && <button className="chip-lavador" onClick={() => abrirPago(t)}>Pagar</button>}
            </div>
          </div>
        )
      })}
    </div>
  )

  const hojas = (
    <>
      {/* Detalle de lavadas (planilla) */}
      <Sheet open={!!detalle} onClose={() => setDetalle(null)} title={detalle ? `Lavadas de ${detalle.nombre}` : ''}>
        {detalle && (() => {
          const filas = planillaDe(detalle.id)
          const total = filas.reduce((s, v) => s + (v.comision || 0), 0)
          return (
            <>
              <div className="helper" style={{ marginBottom: 8 }}>Servicios desde el último pago. Cada lavada con su comisión.</div>
              {filas.length === 0 && <div className="empty">Sin lavadas pendientes de pago.</div>}
              {filas.length > 0 && (
                <table className="tabla compacta">
                  <thead><tr><th>Fecha</th><th>Servicio</th><th className="num">%</th><th className="num">Comisión</th></tr></thead>
                  <tbody>
                    {filas.map((v) => (
                      <tr key={v.id}>
                        <td className="muted-cell" style={{ whiteSpace: 'nowrap' }}>{shortDate(v.fecha)}</td>
                        <td>{(v.cantidad || 1) > 1 ? `${v.cantidad}x ` : ''}{v.servicioNombre}<div className="muted-cell">{money(v.total)}</div></td>
                        <td className="num muted-cell">{v.comisionPct}%</td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(v.comision || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="dato-fuerte" style={{ marginTop: 10 }}>Total a pagar: <b style={{ color: 'var(--red)' }}>{money(total)}</b></div>
              {total > 0 && (
                <>
                  <div style={{ height: 10 }} />
                  <button className="btn" onClick={() => { const t = detalle; setDetalle(null); abrirPago(t) }}>Pagar comisión</button>
                </>
              )}
            </>
          )
        })()}
      </Sheet>

      {/* Pagar comisión */}
      <Sheet open={!!pagoA} onClose={() => setPagoA(null)} title={pagoA ? `Pagar comisión · ${pagoA.nombre}` : ''}>
        {pagoA && (
          <>
            <div className="dato-fuerte">Pendiente: <b style={{ color: 'var(--red)' }}>{money(statsDe(pagoA.id).pendiente)}</b></div>
            <label>Valor a pagar (puede ser parcial)</label>
            <MoneyInput value={montoPago} onChange={setMontoPago} />
            <div className="helper">Queda registrado como salida de caja y se descuenta del pendiente.</div>
            <div style={{ height: 14 }} />
            <button className="btn" onClick={pagar}>Registrar pago de {money(montoPago)}</button>
          </>
        )}
      </Sheet>
    </>
  )

  // --- Modo embebido (dentro de Inicio) ---
  if (embedded) {
    return (
      <>
        <div className="section-title">Lavadores · hoy</div>
        {vacio}
        {lista.length > 0 && tarjetas}
        {hojas}
        {node}
      </>
    )
  }

  // --- Página completa (pestaña Lavadores) ---
  return (
    <>
      <Header title="Lavadores" sub={fechaLarga()} onBack={() => navigate('/')} />
      <div className="content">
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-label">SERVICIOS DE HOY</div><div className="kpi-value">{kServicios}</div></div>
          <div className="kpi"><div className="kpi-label">EFECTIVO</div><div className="kpi-value green">{money(kEfectivo)}</div></div>
          <div className="kpi"><div className="kpi-label">TRANSFERENCIA</div><div className="kpi-value">{money(kTransfer)}</div></div>
          <div className="kpi"><div className="kpi-label">TOTAL DE HOY</div><div className="kpi-value">{money(kTotal)}</div></div>
        </div>
        {vacio}
        {lista.length > 0 && tarjetas}
      </div>
      {hojas}
      {node}
    </>
  )
}
