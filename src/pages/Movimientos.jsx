import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, stamp, esLavador } from '../db'
import { money, dayKey, fechaLarga } from '../format'
import { folio, labelMedio, montoEfectivo, montoTransferencia } from '../ventas'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
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
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.toArray(), [], [])

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
  // Ventas del día separadas: lavadas (servicios) vs nevera y mecatos (productos)
  const ventaServDia = delDia.filter((v) => v.tipo === 'servicio').reduce((s, v) => s + v.total, 0)
  const ventaProdDia = delDia.filter((v) => v.tipo === 'producto').reduce((s, v) => s + v.total, 0)
  const numLavadasDia = delDia.filter((v) => v.tipo === 'servicio').reduce((s, v) => s + (v.cantidad || 1), 0)

  const cambiarDia = (n) => { const d = new Date(fecha + 'T12:00'); d.setDate(d.getDate() + n); setFecha(dayKey(d.getTime())) }

  // --- Eliminar / editar factura (admin) ---
  async function eliminarFactura(g) {
    // Transaccional e idempotente: si una línea ya está anulada (p. ej. un
    // doble toque o dos dispositivos), NO se vuelve a devolver el stock.
    await db.transaction('rw', db.ventas, db.productos, async () => {
      for (const x of g.rows) {
        const fresh = await db.ventas.get(x.id)
        if (!fresh || fresh.anulada) continue
        await db.ventas.update(x.id, stamp({ anulada: 1 }))
        if (x.tipo === 'producto') {
          for (const it of x.items || []) {
            const p = await db.productos.get(it.productoId)
            if (p) await db.productos.update(p.id, stamp({ stock: (p.stock || 0) + it.cantidad }))
          }
        }
      }
    })
    show('Factura eliminada')
  }

  const [editG, setEditG] = useState(null)   // grupo en edición
  const [editMetodo, setEditMetodo] = useState('efectivo')
  const [editEfectivo, setEditEfectivo] = useState(0)
  const [editLavador, setEditLavador] = useState({}) // { ventaId: trabajadorId } para líneas de servicio
  function abrirEditar(g) {
    setEditG(g)
    // OJO: si la venta era a CRÉDITO hay que arrancar en 'credito', si no,
    // "Editar pago" (aunque solo sea para cambiar el lavador) la convertía a
    // efectivo → borraba la deuda del cliente y metía efectivo falso al turno.
    setEditMetodo(g.metodoPago === 'mixto' ? 'mixto' : g.metodoPago === 'credito' ? 'credito' : (g.metodoPago === 'transferencia' ? 'transferencia' : 'efectivo'))
    setEditEfectivo(g.metodoPago === 'mixto' ? g.ef : 0)
    const lav = {}
    for (const x of g.rows) if (x.tipo === 'servicio') lav[x.id] = x.trabajadorId || ''
    setEditLavador(lav)
  }
  async function guardarMetodo() {
    const total = editG.rows.reduce((s, x) => s + x.total, 0)
    const ef = Math.max(0, Math.min(editEfectivo, total))
    const efPct = editMetodo === 'mixto' && total > 0 ? ef / total : 0
    for (const x of editG.rows) {
      const patch = { metodoPago: editMetodo }
      if (editMetodo === 'mixto') { const e = Math.round(x.total * efPct); patch.pagoEfectivo = e; patch.pagoTransferencia = Math.max(0, x.total - e) }
      else if (editMetodo === 'transferencia') { patch.pagoEfectivo = 0; patch.pagoTransferencia = x.total }
      else if (editMetodo === 'credito') { patch.pagoEfectivo = 0; patch.pagoTransferencia = 0 } // sigue siendo deuda: no entra plata
      else { patch.pagoEfectivo = x.total; patch.pagoTransferencia = 0 }
      // Reasignar lavador de una línea de servicio (recalcula su comisión).
      if (x.tipo === 'servicio' && (editLavador[x.id] || '') !== (x.trabajadorId || '')) {
        const t = (trabajadores || []).find((w) => w.id === editLavador[x.id])
        // % propio del lavador si lo tiene; si no, el % BASE del servicio (no el
        // % que traía la línea, que podía ser el % personal del lavador anterior).
        const pctServ = (servicios || []).find((s) => s.id === x.servicioId)?.comisionPct
        const pct = (t && t.comisionPct != null && t.comisionPct !== '') ? Number(t.comisionPct)
          : (pctServ != null && pctServ !== '' ? Number(pctServ) : (x.comisionPct || 0))
        const comision = Math.round((x.total || 0) * (pct / 100))
        patch.trabajadorId = t ? t.id : null
        patch.trabajadorNombre = t ? t.nombre : null
        patch.comisionPct = pct
        patch.comision = comision
        patch.costo = comision
        patch.ganancia = (x.total || 0) - comision
      }
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

        {/* Ventas del día por tipo: lavadas vs nevera */}
        <div className="kpi-row" style={{ marginTop: 4 }}>
          <div className="kpi">
            <div className="kpi-label">LAVADAS (SERVICIOS)</div>
            <div className="kpi-value green" style={{ fontSize: 18 }}>{money(ventaServDia)}</div>
            <div className="meta" style={{ fontSize: 11 }}>{numLavadasDia} {numLavadasDia === 1 ? 'lavada' : 'lavadas'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">NEVERA Y MECATOS</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>{money(ventaProdDia)}</div>
          </div>
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
      <Sheet open={!!editG} onClose={() => setEditG(null)} title="Editar factura">
        {editG && (() => {
          const total = editG.rows.reduce((s, x) => s + x.total, 0)
          const servicios = editG.rows.filter((x) => x.tipo === 'servicio')
          const lavadores = (trabajadores || []).filter(esLavador).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
          return (
            <>
              <div className="dato-fuerte">Total de la factura: <b>{money(total)}</b></div>
              <label>Forma de pago</label>
              <div className="pill-row">
                <button className={`pill ${editMetodo === 'efectivo' ? 'active' : ''}`} onClick={() => setEditMetodo('efectivo')}>Efectivo</button>
                <button className={`pill ${editMetodo === 'transferencia' ? 'active' : ''}`} onClick={() => setEditMetodo('transferencia')}>Transferencia</button>
                <button className={`pill ${editMetodo === 'mixto' ? 'active' : ''}`} onClick={() => setEditMetodo('mixto')}>Mixto</button>
                <button className={`pill ${editMetodo === 'credito' ? 'active' : ''}`} onClick={() => setEditMetodo('credito')}>Crédito (fiado)</button>
              </div>
              {editMetodo === 'credito' && (
                <div className="helper" style={{ color: 'var(--amber)' }}>
                  {editG.metodoPago === 'credito' ? 'Sigue como fiado: la deuda del cliente no cambia.' : 'Pasará a fiado: se sumará a la deuda del cliente de esta factura.'}
                </div>
              )}
              {editMetodo === 'mixto' && (
                <>
                  <label>¿Cuánto en efectivo?</label>
                  <MoneyInput value={editEfectivo} onChange={setEditEfectivo} />
                  <div className="helper">Va a transferencia: <b>{money(Math.max(0, total - Math.min(editEfectivo, total)))}</b></div>
                </>
              )}

              {servicios.length > 0 && (
                <>
                  <label>Lavador de cada lavada</label>
                  {servicios.map((x) => (
                    <div key={x.id} style={{ marginBottom: 8 }}>
                      <div className="muted-cell" style={{ marginBottom: 4 }}>{x.servicioNombre || 'Servicio'} · {money(x.total)}</div>
                      <SearchSelect
                        value={editLavador[x.id] || ''}
                        placeholder="Sin lavador"
                        onChange={(v) => setEditLavador((m) => ({ ...m, [x.id]: v }))}
                        options={[{ value: '', label: 'Sin lavador' }, ...lavadores.map((t) => ({ value: t.id, label: t.nombre }))]}
                      />
                    </div>
                  ))}
                  <div className="helper" style={{ marginBottom: 8 }}>Cambiar el lavador le recalcula la comisión.</div>
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
