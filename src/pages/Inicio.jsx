import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, tipoGasto, esGastoPnL } from '../db'
import { money, dayKey, shortDate, currentMonthKey, monthLabel, fechaLarga } from '../format'
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
  // Cartera POR CLIENTE (fiados + préstamos − abonos), igual que la pestaña
  // Crédito: se suma solo lo positivo de cada cliente. Un clamp global daría un
  // número distinto si algún cliente abonó de más (saldo negativo).
  const saldoPorCliente = {}
  for (const v of (ventas || [])) if (v.metodoPago === 'credito' && !v.anulada) saldoPorCliente[v.clienteId] = (saldoPorCliente[v.clienteId] || 0) + v.total
  for (const g of (gastosAll || [])) if (g.categoria === 'prestamo' && !g.anulada) saldoPorCliente[g.clienteId] = (saldoPorCliente[g.clienteId] || 0) + g.monto
  for (const a of (abonos || [])) if (!a.anulada) saldoPorCliente[a.clienteId] = (saldoPorCliente[a.clienteId] || 0) - a.monto
  const porCobrar = Object.values(saldoPorCliente).reduce((s, v) => s + Math.max(0, v), 0)

  // Ganancia REAL del día: ganancia operativa de las ventas del día, menos la
  // tajada diaria de los costos del mes. Los costos se reparten ÷ 30 para que un
  // gasto grande de un solo día (compra de inventario, mantenimiento) no hunda el
  // día — es el mismo criterio para fijos y variables.
  //   - fijoDiario     = plantilla de fijos del mes ÷ 30
  //   - variableDiario = TODOS los variables del mes (excl. comisiones) ÷ 30
  // Las comisiones no se restan (ya vienen descontadas en la ganancia de servicios).
  const mesHoy = hoy.slice(0, 7)
  const esVariableMes = (g) =>
    esGastoPnL(g) && dayKey(g.fecha).slice(0, 7) === mesHoy && tipoGasto(g) === 'variable'
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
      {/* Orden: primero la plata. Antes esta pantalla abría con el logo y el
          nombre del negocio repetidos de la barra superior, y había que bajar
          para ver la primera cifra. Los KPI van de más a menos importante. */}
      {esDueno && (
        <>
          <div className="section-title">Hoy · {fechaLarga()}</div>
          <div className="kpi-row">
            <div className="kpi">
              <div className="kpi-label">Vendido</div>
              <div className="kpi-value green">{money(totalHoy)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Ganancia</div>
              <div className="kpi-value">{money(gananciaHoy)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Por cobrar</div>
              <div className="kpi-value red">{money(porCobrar)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Mesas abiertas</div>
              <div className="kpi-value">{abiertas.length}</div>
            </div>
          </div>
        </>
      )}

      {esDueno && (
        <section className="bolsillo" style={{ marginTop: 12 }}>
          <div className="bolsillo-head"><span className="bolsillo-tag">Ganancia real de hoy</span></div>
          <div className="bolsillo-cifra" style={{ color: gananciaReal >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {gananciaReal < 0 ? '−' : ''}{money(Math.abs(gananciaReal))}
          </div>
          <div className="bolsillo-pie">ya con la parte de los gastos del mes</div>
          <dl className="desglose">
            <div><dt>Ganancia de las ventas</dt><dd className="mas">+{money(gananciaHoy)}</dd></div>
            <div><dt>Gastos fijos <em>(mes ÷ 30)</em></dt><dd className="menos">−{money(fijoDiario)}</dd></div>
            <div><dt>Gastos variables <em>(mes ÷ 30)</em></dt><dd className="menos">−{money(variableDiario)}</dd></div>
          </dl>
          <div className="helper" style={{ padding: '0 0 10px' }}>
            Los gastos del mes se reparten entre 30 días para que una compra grande no hunda un solo día. Hoy se gastó {money(gastosVarHoy)} en variables.
          </div>
        </section>
      )}

      {esDueno && (
        <button className="btn ghost" style={{ marginTop: 12 }} onClick={exportarCSV}>Exportar resumen del mes (.csv)</button>
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
