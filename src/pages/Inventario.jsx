import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, MOTIVOS_SALIDA, emojiCategoria } from '../db'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import Productos from './Productos'

export default function Inventario() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('productos')

  return (
    <>
      <Header title="Inventario" sub="Productos, entradas, salidas y kardex" onBack={() => navigate('/')} />
      <div className="content">
        <div className="pill-row">
          <button className={`pill ${tab === 'productos' ? 'active' : ''}`} onClick={() => setTab('productos')}>📦 Productos</button>
          <button className={`pill ${tab === 'entradas' ? 'active' : ''}`} onClick={() => setTab('entradas')}>⬇️ Entradas</button>
          <button className={`pill ${tab === 'salidas' ? 'active' : ''}`} onClick={() => setTab('salidas')}>⬆️ Salidas</button>
          <button className={`pill ${tab === 'kardex' ? 'active' : ''}`} onClick={() => setTab('kardex')}>📒 Kardex</button>
        </div>
      </div>

      {tab === 'productos' && <Productos embedded />}
      {tab === 'entradas' && <Entradas />}
      {tab === 'salidas' && <Salidas />}
      {tab === 'kardex' && <Kardex />}
    </>
  )
}

// ------------------- ENTRADAS (compras / reposición) -------------------
function Entradas() {
  const { show, node } = useToast()
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const movs = useLiveQuery(() => db.movimientos_inv.where('tipo').equals('entrada').toArray(), [], [])

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ productoId: '', cantidad: 0, costoUnit: 0, nota: '' })

  const lista = (movs || []).sort((a, b) => b.fecha - a.fecha).slice(0, 30)

  function elegirProducto(id) {
    const p = (productos || []).find((x) => x.id === id)
    setForm({ ...form, productoId: id, costoUnit: p ? p.precioCompra : 0 })
  }

  async function guardar() {
    if (!form.productoId) return show('Elige un producto')
    if (form.cantidad <= 0) return show('Falta la cantidad')
    const p = productos.find((x) => x.id === form.productoId)
    const now = Date.now()
    await db.movimientos_inv.add(stamp({
      id: uid(), tipo: 'entrada',
      productoId: p.id, productoNombre: p.nombre,
      cantidad: form.cantidad, costoUnit: form.costoUnit, nota: form.nota.trim(),
      fecha: now, mes: monthKey(now),
    }))
    await db.productos.update(p.id, stamp({ stock: (p.stock || 0) + form.cantidad }))
    setOpen(false)
    setForm({ productoId: '', cantidad: 0, costoUnit: 0, nota: '' })
    show(`Entrada registrada · +${form.cantidad}`)
  }

  return (
    <div className="content">
      <div className="helper" style={{ marginBottom: 10 }}>Registra la mercancía que compras o repones. Sube el stock.</div>
      {lista.length === 0 && <div className="empty">Sin entradas registradas.</div>}
      {lista.map((m) => (
        <div className="row" key={m.id}>
          <div className="main">
            <div className="title">{m.productoNombre}</div>
            <div className="meta">{shortDate(m.fecha)}{m.nota ? ` · ${m.nota}` : ''}</div>
          </div>
          <div className="right">
            <div style={{ fontWeight: 700, color: 'var(--green)' }}>+{m.cantidad}</div>
            <div className="meta">{money(m.costoUnit * m.cantidad)}</div>
          </div>
        </div>
      ))}

      <button className="fab" onClick={() => setOpen(true)} aria-label="Nueva entrada">+</button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Nueva entrada (compra)">
        <label>Producto</label>
        <select value={form.productoId} onChange={(e) => elegirProducto(e.target.value)}>
          <option value="">Elige…</option>
          {(productos || []).map((p) => (
            <option key={p.id} value={p.id}>{emojiCategoria(p.categoria)} {p.nombre} (stock {p.stock})</option>
          ))}
        </select>

        <div className="grid-2">
          <div>
            <label>Cantidad</label>
            <input inputMode="numeric" value={form.cantidad}
              onChange={(e) => setForm({ ...form, cantidad: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} />
          </div>
          <div>
            <label>Costo por unidad</label>
            <MoneyInput value={form.costoUnit} onChange={(v) => setForm({ ...form, costoUnit: v })} />
          </div>
        </div>

        <label>Nota (proveedor, factura…) — opcional</label>
        <input value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} placeholder="Ej: Distribuidora XYZ" />

        <div className="helper" style={{ marginTop: 8 }}>Total de la compra: <b>{money(form.costoUnit * form.cantidad)}</b></div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardar}>Registrar entrada</button>
      </Sheet>
      {node}
    </div>
  )
}

// ------------------- SALIDAS (mermas / ajustes) -------------------
function Salidas() {
  const { show, node } = useToast()
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const movs = useLiveQuery(() => db.movimientos_inv.where('tipo').equals('salida').toArray(), [], [])

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ productoId: '', cantidad: 0, motivo: 'merma', nota: '' })

  const lista = (movs || []).sort((a, b) => b.fecha - a.fecha).slice(0, 30)
  const motivoLabel = (id) => (MOTIVOS_SALIDA.find((m) => m.id === id) || {}).label || id

  async function guardar() {
    if (!form.productoId) return show('Elige un producto')
    if (form.cantidad <= 0) return show('Falta la cantidad')
    const p = productos.find((x) => x.id === form.productoId)
    const now = Date.now()
    await db.movimientos_inv.add(stamp({
      id: uid(), tipo: 'salida',
      productoId: p.id, productoNombre: p.nombre,
      cantidad: form.cantidad, motivo: form.motivo, nota: form.nota.trim(),
      fecha: now, mes: monthKey(now),
    }))
    await db.productos.update(p.id, stamp({ stock: Math.max(0, (p.stock || 0) - form.cantidad) }))
    setOpen(false)
    setForm({ productoId: '', cantidad: 0, motivo: 'merma', nota: '' })
    show(`Salida registrada · −${form.cantidad}`)
  }

  return (
    <div className="content">
      <div className="helper" style={{ marginBottom: 10 }}>Registra mermas, dañados o ajustes. Baja el stock (no es una venta).</div>
      {lista.length === 0 && <div className="empty">Sin salidas registradas.</div>}
      {lista.map((m) => (
        <div className="row" key={m.id}>
          <div className="main">
            <div className="title">{m.productoNombre}</div>
            <div className="meta">{motivoLabel(m.motivo)} · {shortDate(m.fecha)}</div>
          </div>
          <div className="right" style={{ fontWeight: 700, color: 'var(--red)' }}>−{m.cantidad}</div>
        </div>
      ))}

      <button className="fab" onClick={() => setOpen(true)} aria-label="Nueva salida">+</button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Nueva salida">
        <label>Producto</label>
        <select value={form.productoId} onChange={(e) => setForm({ ...form, productoId: e.target.value })}>
          <option value="">Elige…</option>
          {(productos || []).map((p) => (
            <option key={p.id} value={p.id}>{emojiCategoria(p.categoria)} {p.nombre} (stock {p.stock})</option>
          ))}
        </select>

        <div className="grid-2">
          <div>
            <label>Cantidad</label>
            <input inputMode="numeric" value={form.cantidad}
              onChange={(e) => setForm({ ...form, cantidad: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} />
          </div>
          <div>
            <label>Motivo</label>
            <select value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}>
              {MOTIVOS_SALIDA.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <label>Nota — opcional</label>
        <input value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} />

        <div style={{ height: 14 }} />
        <button className="btn danger" onClick={guardar}>Registrar salida</button>
      </Sheet>
      {node}
    </div>
  )
}

// ------------------- KARDEX (movimiento por producto) -------------------
function Kardex() {
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const [prodId, setProdId] = useState('')

  const movs = useLiveQuery(
    () => (prodId ? db.movimientos_inv.where('productoId').equals(prodId).toArray() : Promise.resolve([])),
    [prodId], []
  )
  const ventas = useLiveQuery(() => db.ventas.where('tipo').equals('producto').toArray(), [], [])

  const prod = (productos || []).find((p) => p.id === prodId)

  // Construir filas del kardex
  let filas = []
  if (prod) {
    for (const m of movs || []) {
      const delta = m.tipo === 'entrada' ? m.cantidad : -m.cantidad
      filas.push({
        fecha: m.fecha,
        concepto: m.tipo === 'entrada' ? 'Entrada' : 'Salida',
        delta,
      })
    }
    for (const v of ventas || []) {
      if (v.anulada) continue
      const cant = (v.items || []).filter((i) => i.productoId === prodId).reduce((s, i) => s + i.cantidad, 0)
      if (cant > 0) filas.push({ fecha: v.fecha, concepto: 'Venta', delta: -cant })
    }
    filas.sort((a, b) => a.fecha - b.fecha)
  }

  // Saldo inicial = stock actual − suma de todos los movimientos (cuadra al stock real)
  const sumaDelta = filas.reduce((s, f) => s + f.delta, 0)
  const saldoInicial = prod ? (prod.stock ?? 0) - sumaDelta : 0
  let saldo = saldoInicial

  return (
    <div className="content">
      <label>Producto</label>
      <select value={prodId} onChange={(e) => setProdId(e.target.value)}>
        <option value="">Elige un producto…</option>
        {(productos || []).map((p) => (
          <option key={p.id} value={p.id}>{emojiCategoria(p.categoria)} {p.nombre}</option>
        ))}
      </select>

      {!prod && <div className="empty">Elige un producto para ver su kardex.</div>}

      {prod && (
        <>
          <div className="card stat-card" style={{ marginTop: 12 }}>
            <div className="label">Stock actual de {prod.nombre}</div>
            <div className="value">{prod.stock ?? 0} unidades</div>
          </div>

          <div className="kardex-head">
            <span>Fecha</span><span>Concepto</span><span className="num">Entra</span><span className="num">Sale</span><span className="num">Saldo</span>
          </div>
          <div className="kardex-row saldo-ini">
            <span>—</span><span>Saldo inicial</span><span className="num"></span><span className="num"></span><span className="num">{saldoInicial}</span>
          </div>
          {filas.map((f, i) => {
            saldo += f.delta
            return (
              <div className="kardex-row" key={i}>
                <span>{shortDate(f.fecha)}</span>
                <span>{f.concepto}</span>
                <span className="num" style={{ color: 'var(--green)' }}>{f.delta > 0 ? '+' + f.delta : ''}</span>
                <span className="num" style={{ color: 'var(--red)' }}>{f.delta < 0 ? f.delta : ''}</span>
                <span className="num"><b>{saldo}</b></span>
              </div>
            )
          })}
          {filas.length === 0 && <div className="empty">Sin movimientos todavía.</div>}
        </>
      )}
    </div>
  )
}
