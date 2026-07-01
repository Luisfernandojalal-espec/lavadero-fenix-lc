import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, stamp } from '../db'
import { money, currentMonthKey, monthLabel, shortDate } from '../format'
import { Header, Sheet, useToast } from '../components/ui'

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
  const { show, node } = useToast()
  const [mes, setMes] = useState(currentMonthKey())
  const meses = ultimosMeses(6)
  const [detalle, setDetalle] = useState(null) // venta seleccionada

  const ventas = useLiveQuery(() => db.ventas.where('mes').equals(mes).toArray(), [mes], [])
  const gastos = useLiveQuery(() => db.gastos.where('mes').equals(mes).toArray(), [mes], [])

  // Solo movimientos vigentes (no anulados), más recientes primero
  const movs = [
    ...(ventas || []).filter((v) => !v.anulada).map((v) => ({ ...v, _tipo: v.tipo })),
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

  async function anularVenta() {
    const v = detalle
    // Anulación (soft-delete): se sincroniza; NO se borra de verdad.
    await db.ventas.update(v.id, stamp({ anulada: 1 }))
    // Devolver el stock de los productos vendidos
    if (v.tipo === 'producto') {
      for (const it of v.items || []) {
        const p = await db.productos.get(it.productoId)
        if (p) await db.productos.update(p.id, stamp({ stock: (p.stock || 0) + it.cantidad }))
      }
    }
    setDetalle(null)
    show('Venta anulada')
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

      {/* Detalle de venta con opción de anular */}
      <Sheet open={!!detalle} onClose={() => setDetalle(null)} title="Detalle de la venta">
        {detalle && (
          <>
            <div className="meta" style={{ marginBottom: 10 }}>{shortDate(detalle.fecha)}</div>
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
                    <div className="title">{detalle.servicioNombre}</div>
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
            <div style={{ height: 12 }} />
            <button className="btn danger" onClick={anularVenta}>Anular esta venta</button>
            <div className="helper" style={{ textAlign: 'center', marginTop: 6 }}>
              Si fue un error. {detalle.tipo === 'producto' ? 'El stock se devuelve.' : ''}
            </div>
          </>
        )}
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
        <div className="meta">{esProd ? 'Productos' : (mov.trabajadorNombre || 'Servicio')} · {shortDate(mov.fecha)}</div>
      </div>
      <div className="right" style={{ fontWeight: 700 }}>{money(mov.total)}</div>
    </div>
  )
}
