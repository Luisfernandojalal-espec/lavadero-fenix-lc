import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, tipoGasto } from '../db'
import { LOGO_URL, money, dayKey, shortDate, currentMonthKey, monthLabel } from '../format'
import { labelMedio } from '../ventas'
import { useAuth } from '../auth'
import Lavadores from './Lavadores'

export default function Inicio() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const esDueno = user?.rol === 'dueño'
  // El cajero también registra cobros en las tarjetas de lavadores.
  const veLavadores = esDueno || user?.rol === 'cajero'

  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const abonos = useLiveQuery(() => db.abonos.toArray(), [], [])
  const mesas = useLiveQuery(() => db.mesas.where('activo').equals(1).toArray(), [], [])
  const abiertas = (mesas || []).filter((m) => m.estado === 'ocupada')
  const gastosAll = useLiveQuery(() => db.gastos.toArray(), [], [])
  const fijosPlantilla = useLiveQuery(() => db.gastos_fijos.where('activo').equals(1).toArray(), [], [])

  const hoy = dayKey()
  const ventasHoy = (ventas || []).filter((v) => !v.anulada && dayKey(v.fecha) === hoy)
  const totalHoy = ventasHoy.reduce((s, v) => s + v.total, 0)
  const gananciaHoy = ventasHoy.reduce((s, v) => s + (v.ganancia || 0), 0)
  const debe = (ventas || []).filter((v) => v.metodoPago === 'credito' && !v.anulada).reduce((s, v) => s + v.total, 0)
  const abonado = (abonos || []).reduce((s, a) => s + a.monto, 0)
  const porCobrar = Math.max(0, debe - abonado)

  // Ganancia REAL del día: ganancia operativa de las ventas del día, menos la
  // tajada diaria de los costos del mes. Los costos se reparten ÷ 30 para que un
  // gasto grande de un solo día (compra de inventario, mantenimiento) no hunda el
  // día — es el mismo criterio para fijos y variables.
  //   - fijoDiario     = plantilla de fijos del mes ÷ 30
  //   - variableDiario = TODOS los variables del mes (excl. comisiones) ÷ 30
  // Las comisiones no se restan (ya vienen descontadas en la ganancia de servicios).
  const mesHoy = hoy.slice(0, 7)
  const esVariableMes = (g) =>
    !g.anulada && g.categoria !== 'comisiones' && dayKey(g.fecha).slice(0, 7) === mesHoy && tipoGasto(g) === 'variable'
  // Lo realmente gastado en variables HOY (solo para mostrarlo en la nota).
  const gastosVarHoy = (gastosAll || [])
    .filter((g) => esVariableMes(g) && dayKey(g.fecha) === hoy)
    .reduce((s, g) => s + g.monto, 0)
  const variablesMes = (gastosAll || []).filter(esVariableMes).reduce((s, g) => s + g.monto, 0)
  const variableDiario = Math.round(variablesMes / 30)
  const fijoDiario = Math.round((fijosPlantilla || []).reduce((s, f) => s + (f.montoEstimado || 0), 0) / 30)
  const gananciaReal = gananciaHoy - fijoDiario - variableDiario

  const recientes = ventasHoy.slice().sort((a, b) => b.fecha - a.fecha).slice(0, 6)

  function detalleVenta(v) {
    if (v.tipo === 'servicio') return v.servicioNombre || 'Servicio'
    return (v.items || []).map((i) => `${i.cantidad}x ${i.nombre}`).join(', ')
  }

  function exportarCSV() {
    const mes = currentMonthKey()
    const filas = (ventas || []).filter((v) => !v.anulada && v.mes === mes)
      .sort((a, b) => a.fecha - b.fecha)
    const cab = ['Fecha', 'Tipo', 'Detalle', 'Cliente', 'Metodo', 'Total', 'Ganancia']
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const lineas = filas.map((v) => [
      shortDate(v.fecha), v.tipo, detalleVenta(v), v.clienteNombre || '', labelMedio(v.metodoPago), v.total, v.ganancia || 0,
    ].map(esc).join(','))
    const csv = '﻿' + [cab.join(','), ...lineas].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `Resumen ${monthLabel(mes)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="content">
      <div className="dash-logo">
        <img src={LOGO_URL} alt="Lavadero Fénix" />
        <div>
          <div className="dash-title">Lavadero Fénix LC</div>
          <div className="dash-sub">Villa Caribe · Sistema POS</div>
        </div>
      </div>

      {esDueno && (
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">ABIERTAS</div>
            <div className="kpi-value">{abiertas.length}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">VENTAS DE HOY</div>
            <div className="kpi-value green">{money(totalHoy)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">GANANCIA DE HOY</div>
            <div className="kpi-value">{money(gananciaHoy)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">POR COBRAR</div>
            <div className="kpi-value red">{money(porCobrar)}</div>
          </div>
        </div>
      )}

      {esDueno && (
        <div className="card stat-card">
          <div className="label">Ganancia real de hoy</div>
          <div className="value" style={{ fontSize: 30, fontWeight: 800, marginTop: 2, color: gananciaReal >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {gananciaReal < 0 ? '−' : ''}{money(Math.abs(gananciaReal))}
          </div>
          <table className="tabla" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>Ganancia (ventas)</td><td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>+{money(gananciaHoy)}</td></tr>
              <tr><td>Gastos fijos (mes ÷ 30)</td><td className="num" style={{ color: 'var(--red)' }}>−{money(fijoDiario)}</td></tr>
              <tr><td>Gastos variables (mes ÷ 30)</td><td className="num" style={{ color: 'var(--red)' }}>−{money(variableDiario)}</td></tr>
            </tbody>
          </table>
          <div className="meta" style={{ fontSize: 12, marginTop: 8 }}>
            Los fijos y los variables del mes se reparten entre 30 días, así un gasto grande de un solo día (compra de inventario, mantenimiento) no hunde el día. Hoy gastaste {money(gastosVarHoy)} en variables (se reparte en el mes).
          </div>
        </div>
      )}

      {esDueno && (
        <button className="btn ghost" style={{ marginTop: 4 }} onClick={exportarCSV}>Exportar resumen del mes (.csv)</button>
      )}

      {veLavadores && <Lavadores embedded />}

      {abiertas.length > 0 && (
        <>
          <div className="section-title">Mesas abiertas</div>
          {abiertas.map((m) => {
            const total = (m.items || []).reduce((s, l) => s + l.precioVenta * l.cantidad, 0)
            return (
              <div className="row" key={m.id} onClick={() => navigate('/mesas')} style={{ cursor: 'pointer' }}>
                <div className="main">
                  <div className="title">{m.nombre}{m.cliente ? ` · ${m.cliente}` : ''}</div>
                  <div className="meta">
                    {(m.items || []).map((l) => `${l.cantidad}x ${l.nombre}`).join(', ') || 'Sin consumos'}
                  </div>
                </div>
                <div className="right" style={{ fontWeight: 700 }}>{money(total)}</div>
              </div>
            )
          })}
        </>
      )}

      {esDueno && (
        <>
          <div className="section-title">Ventas de hoy</div>
          {recientes.length === 0 && <div className="empty">Aún no hay ventas hoy.</div>}
          {recientes.map((v) => (
            <div className="row" key={v.id}>
              <div className="main">
                <div className="title">{detalleVenta(v)}</div>
                <div className="meta">
                  {shortDate(v.fecha)}
                  {v.metodoPago === 'credito' ? ` · Fiado a ${v.clienteNombre}` : ''}
                </div>
              </div>
              <div className="right" style={{ fontWeight: 700, color: v.metodoPago === 'credito' ? 'var(--red)' : 'var(--text)' }}>
                {money(v.total)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
