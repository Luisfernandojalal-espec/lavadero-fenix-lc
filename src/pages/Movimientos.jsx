import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, stamp } from '../db'
import { money, currentMonthKey, monthLabel, shortDate } from '../format'
import { folio, labelMedio, esEfectivo, montoEfectivo, montoTransferencia } from '../ventas'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import { useAuth } from '../auth'

function ultimosMeses(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabel(ts) {
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const d = new Date(ts)
  return `${dias[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Movimientos() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const esDueno = user?.rol === 'dueño'
  const { show, node } = useToast()
  const [mes, setMes] = useState(currentMonthKey())
  const meses = ultimosMeses(6)
  const [detalle, setDetalle] = useState(null) // venta seleccionada

  const ventas = useLiveQuery(() => db.ventas.where('mes').equals(mes).toArray(), [mes], [])
  const gastos = useLiveQuery(() => db.gastos.where('mes').equals(mes).toArray(), [mes], [])

  const vVig = (ventas || []).filter((v) => !v.anulada)

  // --- Resumen de formas de pago del mes (con desglose del mixto) ---
  const totEfectivo = vVig.filter((v) => esEfectivo(v)).reduce((s, v) => s + v.total, 0)
  const totTransfer = vVig.filter((v) => v.metodoPago === 'transferencia').reduce((s, v) => s + v.total, 0)
  const mixtos = vVig.filter((v) => v.metodoPago === 'mixto')
  const totMixto = mixtos.reduce((s, v) => s + v.total, 0)
  const mixtoEf = mixtos.reduce((s, v) => s + (v.pagoEfectivo || 0), 0)
  const mixtoTr = mixtos.reduce((s, v) => s + (v.pagoTransferencia || 0), 0)
  const totCredito = vVig.filter((v) => v.metodoPago === 'credito').reduce((s, v) => s + v.total, 0)
  const entraCaja = vVig.reduce((s, v) => s + montoEfectivo(v), 0)      // efectivo total (incluye parte de mixtos)
  const entraBanco = vVig.reduce((s, v) => s + montoTransferencia(v), 0) // transferencia total (incluye parte de mixtos)

  // Solo movimientos vigentes (no anulados), más recientes primero
  const movs = [
    ...vVig.map((v) => ({ ...v, _tipo: v.tipo })),
    ...(gastos || []).filter((g) => !g.anulada).map((g) => ({ ...g, _tipo: 'gasto' })),
  ].sort((a, b) => b.fecha - a.fecha)

  // Agrupar por día
  const dias = {}
  for (const m of movs) {
    const k = dayKey(m.fecha)
    if (!dias[k]) dias[k] = { label: dayLabel(m.fecha), items: [], ingresos: 0, egresos: 0 }
    dias[k].items.push(m)
    if (m._tipo === 'gasto') dias[k].egresos += m.monto
    else dias[k].ingresos += m.total
  }
  const diasOrden = Object.keys(dias).sort((a, b) => (a < b ? 1 : -1))

  // Filas de la MISMA factura (para editar/eliminar la factura completa)
  const filasFactura = (v) =>
    v.factura != null ? vVig.filter((x) => x.factura === v.factura) : [v]

  async function eliminarFactura() {
    const rows = filasFactura(detalle)
    for (const x of rows) {
      await db.ventas.update(x.id, stamp({ anulada: 1 }))
      if (x.tipo === 'producto') {
        for (const it of x.items || []) {
          const p = await db.productos.get(it.productoId)
          if (p) await db.productos.update(p.id, stamp({ stock: (p.stock || 0) + it.cantidad }))
        }
      }
    }
    setDetalle(null)
    show(rows.length > 1 ? 'Factura eliminada' : 'Venta eliminada')
  }

  // --- Editar método de pago de la factura ---
  const [editOpen, setEditOpen] = useState(false)
  const [editMetodo, setEditMetodo] = useState('efectivo')
  const [editEfectivo, setEditEfectivo] = useState(0)
  const totalFacturaSel = detalle ? filasFactura(detalle).reduce((s, x) => s + x.total, 0) : 0

  function abrirEditar() {
    setEditMetodo(detalle.metodoPago === 'mixto' ? 'mixto' : (esEfectivo(detalle) ? 'efectivo' : detalle.metodoPago === 'transferencia' ? 'transferencia' : 'efectivo'))
    setEditEfectivo(detalle.metodoPago === 'mixto' ? filasFactura(detalle).reduce((s, x) => s + (x.pagoEfectivo || 0), 0) : 0)
    setEditOpen(true)
  }
  async function guardarMetodo() {
    const rows = filasFactura(detalle)
    const total = rows.reduce((s, x) => s + x.total, 0)
    const ef = Math.max(0, Math.min(editEfectivo, total))
    const efPct = editMetodo === 'mixto' && total > 0 ? ef / total : 0
    for (const x of rows) {
      const patch = { metodoPago: editMetodo }
      if (editMetodo === 'mixto') { const e = Math.round(x.total * efPct); patch.pagoEfectivo = e; patch.pagoTransferencia = Math.max(0, x.total - e) }
      else if (editMetodo === 'transferencia') { patch.pagoEfectivo = 0; patch.pagoTransferencia = x.total }
      else { patch.pagoEfectivo = x.total; patch.pagoTransferencia = 0 }
      await db.ventas.update(x.id, stamp(patch))
    }
    setEditOpen(false); setDetalle(null); show('Factura actualizada')
  }

  return (
    <>
      <Header title="Historial de ventas" sub="Ventas y gastos · cierre por día" onBack={() => navigate('/')} />

      <div className="content">
        <div className="pill-row">
          {meses.map((m) => (
            <button key={m} className={`pill ${mes === m ? 'active' : ''}`} onClick={() => setMes(m)}>
              {monthLabel(m).split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Resumen de formas de pago (desglose del mixto) */}
        {vVig.length > 0 && (
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>Formas de pago · {monthLabel(mes)}</div>
            <table className="tabla compacta">
              <tbody>
                <tr><td>Efectivo</td><td className="num" style={{ fontWeight: 700 }}>{money(totEfectivo)}</td></tr>
                <tr><td>Transferencia</td><td className="num" style={{ fontWeight: 700 }}>{money(totTransfer)}</td></tr>
                {totMixto > 0 && (
                  <tr>
                    <td>Mixto <span className="muted-cell">(efectivo {money(mixtoEf)} · transf. {money(mixtoTr)})</span></td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(totMixto)}</td>
                  </tr>
                )}
                <tr><td>Crédito (fiado)</td><td className="num" style={{ fontWeight: 700, color: 'var(--red)' }}>{money(totCredito)}</td></tr>
              </tbody>
            </table>
            <div className="helper" style={{ marginTop: 6 }}>
              Total a caja (efectivo) {money(entraCaja)} · al banco (transferencia) {money(entraBanco)}. Los mixtos se reparten entre ambos.
            </div>
          </div>
        )}

        {diasOrden.length === 0 && <div className="empty">Sin movimientos en {monthLabel(mes)}.</div>}

        {diasOrden.map((k) => {
          const d = dias[k]
          return (
            <div key={k}>
              <div className="dia-header">
                <span>{d.label}</span>
                <span className="dia-total">{money(d.ingresos)}{d.egresos > 0 ? ` · −${money(d.egresos)}` : ''}</span>
              </div>
              {d.items.map((m) => (
                <MovRow key={m.id} mov={m} onClick={() => m._tipo !== 'gasto' && setDetalle(m)} />
              ))}
            </div>
          )
        })}
      </div>

      {/* Detalle de venta: ver, y (admin) editar método / eliminar factura */}
      <Sheet open={!!detalle} onClose={() => setDetalle(null)} title="Detalle de la venta">
        {detalle && (
          <>
            <div className="meta" style={{ marginBottom: 10 }}>
              {detalle.factura ? folio(detalle.factura) + ' · ' : ''}{shortDate(detalle.fecha)} · {labelMedio(detalle.metodoPago)}
              {detalle.metodoPago === 'mixto' ? ` (efectivo ${money(detalle.pagoEfectivo || 0)} · transf. ${money(detalle.pagoTransferencia || 0)})` : ''}
              {detalle.origen ? ` · ${detalle.origen}` : ''}
              {detalle.clienteNombre ? ` · ${detalle.clienteNombre}` : ''}
            </div>
            {detalle.tipo === 'producto' ? (
              <>
                {(detalle.items || []).map((it, i) => (
                  <div className="row" key={i}>
                    <div className="main">
                      <div className="title">{it.nombre}</div>
                      <div className="meta">{it.cantidad} × {money(it.precioVenta)}</div>
                    </div>
                    <div className="right" style={{ fontWeight: 700 }}>{money(it.precioVenta * it.cantidad)}</div>
                  </div>
                ))}
                <div className="row">
                  <div className="main"><div className="title">Ganancia</div></div>
                  <div className="right" style={{ fontWeight: 700, color: 'var(--green)' }}>+{money(detalle.ganancia)}</div>
                </div>
              </>
            ) : (
              <>
                <div className="row">
                  <div className="main">
                    <div className="title">{(detalle.cantidad || 1) > 1 ? `${detalle.cantidad} × ` : ''}{detalle.servicioNombre}</div>
                    <div className="meta">{detalle.trabajadorNombre || 'Sin asignar'}</div>
                  </div>
                  <div className="right" style={{ fontWeight: 700 }}>{money(detalle.total)}</div>
                </div>
                <div className="row">
                  <div className="main"><div className="title">Comisión ({detalle.comisionPct}%)</div></div>
                  <div className="right" style={{ color: 'var(--amber)', fontWeight: 700 }}>{money(detalle.comision)}</div>
                </div>
              </>
            )}

            {esDueno ? (
              <>
                <div style={{ height: 12 }} />
                <div className="btn-row">
                  <button className="btn secondary" onClick={abrirEditar}>Editar forma de pago</button>
                  <button className="btn danger" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={eliminarFactura}>Eliminar factura</button>
                </div>
                <div className="helper" style={{ textAlign: 'center', marginTop: 6 }}>
                  Eliminar afecta toda la factura{detalle.tipo === 'producto' || filasFactura(detalle).some((x) => x.tipo === 'producto') ? ' y devuelve el stock' : ''}.
                </div>
              </>
            ) : (
              <div className="helper" style={{ textAlign: 'center', marginTop: 12 }}>Solo un administrador puede editar o eliminar facturas.</div>
            )}
          </>
        )}
      </Sheet>

      {/* Editar forma de pago de la factura */}
      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title="Editar forma de pago">
        <div className="dato-fuerte">Total de la factura: <b>{money(totalFacturaSel)}</b></div>
        <label>Forma de pago</label>
        <div className="pill-row">
          <button className={`pill ${editMetodo === 'efectivo' ? 'active' : ''}`} onClick={() => setEditMetodo('efectivo')}>Efectivo</button>
          <button className={`pill ${editMetodo === 'transferencia' ? 'active' : ''}`} onClick={() => setEditMetodo('transferencia')}>Transferencia</button>
          <button className={`pill ${editMetodo === 'mixto' ? 'active' : ''}`} onClick={() => setEditMetodo('mixto')}>Mixto</button>
        </div>
        {editMetodo === 'mixto' && (
          <>
            <label>¿Cuánto en efectivo?</label>
            <MoneyInput value={editEfectivo} onChange={setEditEfectivo} />
            <div className="helper">Va a transferencia: <b>{money(Math.max(0, totalFacturaSel - Math.min(editEfectivo, totalFacturaSel)))}</b></div>
          </>
        )}
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarMetodo}>Guardar</button>
      </Sheet>

      {node}
    </>
  )
}

function MovRow({ mov, onClick }) {
  if (mov._tipo === 'gasto') {
    return (
      <div className="row">
        <div className="main">
          <div className="title">{mov.concepto}</div>
          <div className="meta">Gasto · {shortDate(mov.fecha)}</div>
        </div>
        <div className="right" style={{ fontWeight: 700, color: 'var(--red)' }}>−{money(mov.monto)}</div>
      </div>
    )
  }
  const esProd = mov.tipo === 'producto'
  const titulo = esProd
    ? (mov.items || []).map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')
    : mov.servicioNombre
  return (
    <div className="row" onClick={onClick}>
      <div className="main">
        <div className="title">{titulo}</div>
        <div className="meta">{esProd ? 'Productos' : (mov.trabajadorNombre || 'Servicio')} · {labelMedio(mov.metodoPago)} · {shortDate(mov.fecha)}</div>
      </div>
      <div className="right" style={{ fontWeight: 700 }}>{money(mov.total)}</div>
    </div>
  )
}
