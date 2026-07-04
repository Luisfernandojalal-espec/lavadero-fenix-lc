import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, MOTIVOS_SALIDA, CATEGORIAS_PRODUCTO, labelCategoria, STOCK_MIN_DEFAULT } from '../db'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
import Productos from './Productos'

const TABS = [
  { id: 'productos', label: 'Productos' },
  { id: 'saldos', label: 'Saldos iniciales' },
  { id: 'entradas', label: 'Entradas' },
  { id: 'salidas', label: 'Salidas' },
  { id: 'kardex', label: 'Kardex' },
]

export default function Inventario() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('productos')

  return (
    <>
      <Header title="Inventario" sub="Productos, saldos, entradas, salidas y kardex" onBack={() => navigate('/')} />
      <div className="content">
        <div className="subtabs">
          {TABS.map((t) => (
            <button key={t.id} className={`subtab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'productos' && <Productos embedded />}
      {tab === 'saldos' && <SaldosIniciales />}
      {tab === 'entradas' && <Entradas />}
      {tab === 'salidas' && <Salidas />}
      {tab === 'kardex' && <Kardex />}
    </>
  )
}

function opcionesProducto(productos) {
  return (productos || [])
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map((p) => ({ value: p.id, label: `${p.nombre} — existencia ${p.stock ?? 0}` }))
}

// ------------------- SALDOS INICIALES -------------------
const COLS = ['Producto', 'Categoria', 'Precio compra', 'Precio venta', 'Existencia', 'Stock minimo']

function catId(txt) {
  const t = String(txt || '').trim().toLowerCase()
  const c = CATEGORIAS_PRODUCTO.find((x) => x.id === t || x.label.toLowerCase() === t)
  return c ? c.id : 'otro'
}
function num(v) { const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n }

function SaldosIniciales() {
  const { show, node } = useToast()
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const [valores, setValores] = useState({})
  const fileRef = useRef(null)

  const lista = (productos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))

  useEffect(() => {
    if (!productos) return
    setValores((prev) => {
      const next = { ...prev }
      for (const p of productos) if (next[p.id] === undefined) next[p.id] = p.stock ?? 0
      return next
    })
  }, [productos])

  async function guardar() {
    let n = 0
    for (const p of lista) {
      const v = parseInt(valores[p.id] ?? 0, 10)
      if (v !== (p.stock ?? 0)) { await db.productos.update(p.id, stamp({ stock: v })); n++ }
    }
    show(n ? `Guardado (${n} productos)` : 'Sin cambios')
  }

  async function descargarPlantilla() {
    const XLSX = await import('xlsx')
    // Pre-llenamos con los productos actuales; el dueño solo edita la existencia.
    const filas = lista.length
      ? lista.map((p) => [p.nombre, labelCategoria(p.categoria), p.precioCompra, p.precioVenta, p.stock ?? 0, p.stockMin ?? ''])
      : [['Ejemplo: Cerveza Águila', 'Cerveza', 2500, 4000, 24, 5]]
    const aoa = [COLS, ...filas]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Saldos')
    XLSX.writeFile(wb, 'Plantilla saldos iniciales.xlsx')
  }

  async function subirArchivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const XLSX = await import('xlsx')
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data)
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const existentes = await db.productos.where('activo').equals(1).toArray()
      let creados = 0, actualizados = 0
      for (const r of rows) {
        const nombre = String(r['Producto'] ?? '').trim()
        if (!nombre || nombre.toLowerCase().startsWith('ejemplo')) continue
        const existencia = num(r['Existencia'])
        const pc = num(r['Precio compra'])
        const pv = num(r['Precio venta'])
        const sm = num(r['Stock minimo'])
        const prev = existentes.find((p) => p.nombre.trim().toLowerCase() === nombre.toLowerCase())
        if (prev) {
          const cambios = { stock: existencia }
          if (pc) cambios.precioCompra = pc
          if (pv) cambios.precioVenta = pv
          if (sm) cambios.stockMin = sm
          await db.productos.update(prev.id, stamp(cambios))
          actualizados++
        } else {
          await db.productos.add(stamp({
            id: uid(), activo: 1, nombre,
            categoria: catId(r['Categoria']),
            precioCompra: pc, precioVenta: pv, stock: existencia,
            stockMin: sm || STOCK_MIN_DEFAULT,
          }))
          creados++
        }
      }
      show(`Listo: ${actualizados} actualizados, ${creados} nuevos`)
    } catch (err) {
      show('No pude leer el archivo')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="content">
      <div className="helper" style={{ marginBottom: 10 }}>
        Carga la existencia real de cada producto para empezar. Puedes escribirla abajo, o usar la plantilla de Excel para subir todo de una vez.
      </div>

      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn secondary" onClick={descargarPlantilla}>Descargar plantilla Excel</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Subir archivo</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={subirArchivo} />
      </div>
      <div className="helper" style={{ marginBottom: 16 }}>
        La plantilla trae columnas: Producto, Categoría, Precio compra, Precio venta, Existencia y Stock mínimo. Los productos que ya existan se actualizan; los nuevos se crean.
      </div>

      <table className="tabla">
        <thead><tr><th>Producto</th><th className="num">Existencia</th></tr></thead>
        <tbody>
          {lista.map((p) => (
            <tr key={p.id}>
              <td>{p.nombre}</td>
              <td className="num">
                <input className="celda-num" inputMode="numeric" value={valores[p.id] ?? ''}
                  onChange={(e) => setValores({ ...valores, [p.id]: e.target.value.replace(/[^\d]/g, '') })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {lista.length === 0 && <div className="empty">No hay productos. Créalos en Productos o súbelos con la plantilla.</div>}
      {lista.length > 0 && <button className="btn" style={{ marginTop: 14 }} onClick={guardar}>Guardar saldos escritos</button>}
      {node}
    </div>
  )
}

// ------------------- ENTRADAS (compras / reposición) -------------------
function Entradas() {
  const { show, node } = useToast()
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const movs = useLiveQuery(() => db.movimientos_inv.where('tipo').equals('entrada').toArray(), [], [])

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ productoId: '', cantidad: 0, costoUnit: 0, nota: '' })

  const lista = (movs || []).sort((a, b) => b.fecha - a.fecha).slice(0, 40)

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
    show(`Entrada registrada (+${form.cantidad})`)
  }

  return (
    <div className="content">
      <div className="helper" style={{ marginBottom: 10 }}>Mercancía que compras o repones. Aumenta la existencia.</div>
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Producto</th><th className="num">Cant.</th><th className="num">Total</th></tr></thead>
        <tbody>
          {lista.map((m) => (
            <tr key={m.id}>
              <td className="muted-cell">{shortDate(m.fecha)}</td>
              <td>{m.productoNombre}{m.nota ? <div className="muted-cell">{m.nota}</div> : null}</td>
              <td className="num" style={{ color: 'var(--green)' }}>+{m.cantidad}</td>
              <td className="num">{money(m.costoUnit * m.cantidad)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lista.length === 0 && <div className="empty">Sin entradas registradas.</div>}

      <button className="fab" onClick={() => setOpen(true)} aria-label="Nueva entrada">+</button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Nueva entrada (compra)">
        <label>Producto</label>
        <SearchSelect value={form.productoId} onChange={elegirProducto}
          options={opcionesProducto(productos)} placeholder="Buscar producto…" />
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
        <label>Nota (proveedor, factura) — opcional</label>
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

  const lista = (movs || []).sort((a, b) => b.fecha - a.fecha).slice(0, 40)
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
    show(`Salida registrada (-${form.cantidad})`)
  }

  return (
    <div className="content">
      <div className="helper" style={{ marginBottom: 10 }}>Mermas, dañados o ajustes. Disminuye la existencia (no es una venta).</div>
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Producto</th><th>Motivo</th><th className="num">Cant.</th></tr></thead>
        <tbody>
          {lista.map((m) => (
            <tr key={m.id}>
              <td className="muted-cell">{shortDate(m.fecha)}</td>
              <td>{m.productoNombre}</td>
              <td className="muted-cell">{motivoLabel(m.motivo)}</td>
              <td className="num" style={{ color: 'var(--red)' }}>-{m.cantidad}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lista.length === 0 && <div className="empty">Sin salidas registradas.</div>}

      <button className="fab" onClick={() => setOpen(true)} aria-label="Nueva salida">+</button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Nueva salida">
        <label>Producto</label>
        <SearchSelect value={form.productoId} onChange={(id) => setForm({ ...form, productoId: id })}
          options={opcionesProducto(productos)} placeholder="Buscar producto…" />
        <div className="grid-2">
          <div>
            <label>Cantidad</label>
            <input inputMode="numeric" value={form.cantidad}
              onChange={(e) => setForm({ ...form, cantidad: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} />
          </div>
          <div>
            <label>Motivo</label>
            <SearchSelect value={form.motivo} onChange={(v) => setForm({ ...form, motivo: v })}
              options={MOTIVOS_SALIDA.map((m) => ({ value: m.id, label: m.label }))} placeholder="Motivo…" />
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

// ------------------- KARDEX -------------------
function Kardex() {
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const [prodId, setProdId] = useState('')

  const movs = useLiveQuery(
    () => (prodId ? db.movimientos_inv.where('productoId').equals(prodId).toArray() : Promise.resolve([])),
    [prodId], []
  )
  const ventas = useLiveQuery(() => db.ventas.where('tipo').equals('producto').toArray(), [], [])

  const prod = (productos || []).find((p) => p.id === prodId)

  let filas = []
  if (prod) {
    for (const m of movs || []) {
      filas.push({ fecha: m.fecha, concepto: m.tipo === 'entrada' ? 'Entrada' : 'Salida', delta: m.tipo === 'entrada' ? m.cantidad : -m.cantidad })
    }
    for (const v of ventas || []) {
      if (v.anulada) continue
      const cant = (v.items || []).filter((i) => i.productoId === prodId).reduce((s, i) => s + i.cantidad, 0)
      if (cant > 0) filas.push({ fecha: v.fecha, concepto: 'Venta', delta: -cant })
    }
    filas.sort((a, b) => a.fecha - b.fecha)
  }

  const sumaDelta = filas.reduce((s, f) => s + f.delta, 0)
  const saldoInicial = prod ? (prod.stock ?? 0) - sumaDelta : 0
  let saldo = saldoInicial

  return (
    <div className="content">
      <label>Producto</label>
      <SearchSelect value={prodId} onChange={setProdId}
        options={opcionesProducto(productos)} placeholder="Buscar producto…" />

      {!prod && <div className="empty">Elige un producto para ver su kardex.</div>}

      {prod && (
        <>
          <div className="dato-fuerte">Existencia actual: <b>{prod.stock ?? 0}</b> unidades</div>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Entra</th><th className="num">Sale</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              <tr className="saldo-ini-row">
                <td>—</td><td>Saldo inicial</td><td className="num"></td><td className="num"></td><td className="num"><b>{saldoInicial}</b></td>
              </tr>
              {filas.map((f, i) => {
                saldo += f.delta
                return (
                  <tr key={i}>
                    <td className="muted-cell">{shortDate(f.fecha)}</td>
                    <td>{f.concepto}</td>
                    <td className="num" style={{ color: 'var(--green)' }}>{f.delta > 0 ? '+' + f.delta : ''}</td>
                    <td className="num" style={{ color: 'var(--red)' }}>{f.delta < 0 ? f.delta : ''}</td>
                    <td className="num"><b>{saldo}</b></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
