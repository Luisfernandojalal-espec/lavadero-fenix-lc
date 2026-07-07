import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, stamp } from '../db'
import { money, dayKey, fechaLarga } from '../format'
import { folio, labelMedio, esEfectivo, montoEfectivo, montoTransferencia } from '../ventas'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import { useAuth } from '../auth'

const horaAmPm = (ts) => new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
const itemsTexto = (rows) => rows.map((v) => v.tipo === 'producto'
  ? (v.items || []).map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')
  : `${(v.cantidad || 1) > 1 ? v.cantidad + '× ' : ''}${v.servicioNombre}`).join(', ')

export default function Movimientos() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const esDueno = user?.rol === 'dueño'
  const { show, node } = useToast()

  const [fecha, setFecha] = useState(dayKey())        // 'YYYY-MM-DD' (día seleccionado)
  const mes = fecha.slice(0, 7)
  const ventas = useLiveQuery(() => db.ventas.where('mes').equals(mes).toArray(), [mes], [])

  const delDia = (ventas || []).filter((v) => !v.anulada && dayKey(v.fecha) === fecha)

  // Agrupar por factura → una tarjeta por venta
  const grupos = {}
  for (const v of delDia) {
    const k = v.factura != null ? 'F' + v.factura : v.id
    if (!grupos[k]) grupos[k] = { key: k, factura: v.factura, fecha: v.fecha, metodoPago: v.metodoPago, clienteNombre: v.clienteNombre, origen: v.origen, rows: [], total: 0, ef: 0, tr: 0 }
    grupos[k].rows.push(v)
    grupos[k].total += v.total
    grupos[k].ef += montoEfectivo(v)
    grupos[k].tr += montoTransferencia(v)
  }
  const facturas = Object.values(grupos).sort((a, b) => b.fecha - a.fecha)

  const totalDia = delDia.reduce((s, v) => s + v.total, 0)
  const totEf = delDia.reduce((s, v) => s + montoEfectivo(v), 0)
  const totTr = delDia.reduce((s, v) => s + montoTransferencia(v), 0)
  const totCr = delDia.filter((v) => v.metodoPago === 'credito').reduce((s, v) => s + v.total, 0)

  const cambiarDia = (n) => { const d = new Date(fecha + 'T12:00'); d.setDate(d.getDate() + n); setFecha(dayKey(d.getTime())) }

  // --- Eliminar / editar factura (admin) ---
  async function eliminarFactura(g) {
    for (const x of g.rows) {
      await db.ventas.update(x.id, stamp({ anulada: 1 }))
      if (x.tipo === 'producto') {
        for (const it of x.items || []) {
          const p = await db.productos.get(it.productoId)
          if (p) await db.productos.update(p.id, stamp({ stock: (p.stock || 0) + it.cantidad }))
        }
      }
    }
    show('Factura eliminada')
  }

  const [editG, setEditG] = useState(null)   // grupo en edición
  const [editMetodo, setEditMetodo] = useState('efectivo')
  const [editEfectivo, setEditEfectivo] = useState(0)
  function abrirEditar(g) {
    setEditG(g)
    setEditMetodo(g.metodoPago === 'mixto' ? 'mixto' : (esEfectivo({ metodoPago: g.metodoPago }) ? 'efectivo' : g.metodoPago === 'transferencia' ? 'transferencia' : 'efectivo'))
    setEditEfectivo(g.metodoPago === 'mixto' ? g.ef : 0)
  }
  async function guardarMetodo() {
    const total = editG.rows.reduce((s, x) => s + x.total, 0)
    const ef = Math.max(0, Math.min(editEfectivo, total))
    const efPct = editMetodo === 'mixto' && total > 0 ? ef / total : 0
    for (const x of editG.rows) {
      const patch = { metodoPago: editMetodo }
      if (editMetodo === 'mixto') { const e = Math.round(x.total * efPct); patch.pagoEfectivo = e; patch.pagoTransferencia = Math.max(0, x.total - e) }
      else if (editMetodo === 'transferencia') { patch.pagoEfectivo = 0; patch.pagoTransferencia = x.total }
      else { patch.pagoEfectivo = x.total; patch.pagoTransferencia = 0 }
      await db.ventas.update(x.id, stamp(patch))
    }
    setEditG(null); show('Factura actualizada')
  }

  return (
    <>
      <Header title="Historial de ventas" sub="Ventas por día" onBack={() => navigate('/')} />

      <div className="content">
        {/* Selector de día */}
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <button className="btn ghost" style={{ width: 'auto', padding: '8px 14px' }} onClick={() => cambiarDia(-1)}>‹</button>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ flex: 1 }} />
          <button className="btn ghost" style={{ width: 'auto', padding: '8px 14px' }} onClick={() => cambiarDia(1)}>›</button>
        </div>
        <div className="helper" style={{ textAlign: 'center', marginBottom: 8 }}>
          {fechaLarga(new Date(fecha + 'T12:00').getTime())}{fecha !== dayKey() ? '' : ' · hoy'}
        </div>

        {/* Total del día + cuentas */}
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="meta">TOTAL DEL DÍA</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--green)' }}>{money(totalDia)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="meta">CUENTAS</div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{facturas.length}</div>
          </div>
        </div>

        {/* Formas de pago del día */}
        <div className="kpi-row" style={{ marginTop: 4 }}>
          <div className="kpi"><div className="kpi-label">EFECTIVO</div><div className="kpi-value green" style={{ fontSize: 18 }}>{money(totEf)}</div></div>
          <div className="kpi"><div className="kpi-label">TRANSFERENCIA</div><div className="kpi-value" style={{ fontSize: 18 }}>{money(totTr)}</div></div>
          <div className="kpi"><div className="kpi-label">CRÉDITO (FIADO)</div><div className="kpi-value red" style={{ fontSize: 18 }}>{money(totCr)}</div></div>
        </div>

        <button className="btn ghost" style={{ margin: '6px 0 12px' }} onClick={() => navigate('/turno')}>Base de caja y cierre de turno</button>

        {facturas.length === 0 && <div className="empty">Sin ventas este día.</div>}

        {facturas.map((g) => (
          <div className="card" key={g.key} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="title" style={{ fontWeight: 700 }}>{itemsTexto(g.rows)}</div>
                <div className="meta">
                  {g.factura ? folio(g.factura) + ' · ' : ''}{horaAmPm(g.fecha)} · {labelMedio(g.metodoPago)}
                  {g.metodoPago === 'mixto' ? ` (ef ${money(g.ef)} · tr ${money(g.tr)})` : ''}
                  {g.clienteNombre ? ` · ${g.clienteNombre}` : ''}{g.origen ? ` · ${g.origen}` : ''}
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 18, marginLeft: 8 }}>{money(g.total)}</div>
            </div>
            {esDueno && (
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="chip-lavador" onClick={() => abrirEditar(g)}>Editar pago</button>
                <button className="chip-lavador" style={{ color: 'var(--red)' }} onClick={() => eliminarFactura(g)}>Eliminar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Editar forma de pago de la factura */}
      <Sheet open={!!editG} onClose={() => setEditG(null)} title="Editar forma de pago">
        {editG && (() => {
          const total = editG.rows.reduce((s, x) => s + x.total, 0)
          return (
            <>
              <div className="dato-fuerte">Total de la factura: <b>{money(total)}</b></div>
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
                  <div className="helper">Va a transferencia: <b>{money(Math.max(0, total - Math.min(editEfectivo, total)))}</b></div>
                </>
              )}
              <div style={{ height: 14 }} />
              <button className="btn" onClick={guardarMetodo}>Guardar</button>
            </>
          )
        })()}
      </Sheet>

      {node}
    </>
  )
}
