import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { LOGO_URL, money, dayKey, shortDate, currentMonthKey, monthLabel } from '../format'
import { useAuth } from '../auth'
import { ModIcon } from '../components/icons'

const MODULOS = [
  { to: '/mesas', icon: 'mesas', label: 'Mesas' },
  { to: '/factura', icon: 'factura', label: 'Facturar' },
  { to: '/inventario', icon: 'inventario', label: 'Inventario', soloDueno: true },
  { to: '/historial', icon: 'historial', label: 'Historial', soloDueno: true },
  { to: '/credito', icon: 'credito', label: 'Créditos', soloDueno: true },
  { to: '/gastos', icon: 'gastos', label: 'Gastos', soloDueno: true },
  { to: '/balance', icon: 'balance', label: 'Balance', soloDueno: true },
  { to: '/config', icon: 'config', label: 'Admin', soloDueno: true },
]

export default function Inicio() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const esDueno = user?.rol === 'dueño'
  const modulos = MODULOS.filter((m) => esDueno || !m.soloDueno)

  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const abonos = useLiveQuery(() => db.abonos.toArray(), [], [])
  const mesas = useLiveQuery(() => db.mesas.where('activo').equals(1).toArray(), [], [])
  const abiertas = (mesas || []).filter((m) => m.estado === 'ocupada')

  const hoy = dayKey()
  const ventasHoy = (ventas || []).filter((v) => !v.anulada && dayKey(v.fecha) === hoy)
  const totalHoy = ventasHoy.reduce((s, v) => s + v.total, 0)
  const gananciaHoy = ventasHoy.reduce((s, v) => s + (v.ganancia || 0), 0)
  const debe = (ventas || []).filter((v) => v.metodoPago === 'credito' && !v.anulada).reduce((s, v) => s + v.total, 0)
  const abonado = (abonos || []).reduce((s, a) => s + a.monto, 0)
  const porCobrar = Math.max(0, debe - abonado)

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
      shortDate(v.fecha), v.tipo, detalleVenta(v), v.clienteNombre || '', v.metodoPago || 'contado', v.total, v.ganancia || 0,
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

      <div className="modgrid">
        {modulos.map((m) => (
          <button key={m.to} className="modcard" onClick={() => navigate(m.to)}>
            <ModIcon name={m.icon} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {esDueno && (
        <button className="btn ghost" style={{ marginTop: 4 }} onClick={exportarCSV}>Exportar resumen del mes (.csv)</button>
      )}

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
