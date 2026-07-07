import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, MOTIVOS_SALIDA, CATEGORIAS_PRODUCTO, UNIDADES, FORMAS_PAGO_COMPRA, labelFormaPagoCompra, labelCategoria, STOCK_MIN_DEFAULT } from '../db'
import { money, monthKey, shortDate, dayKey } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
import { useAuth } from '../auth'
import Productos from './Productos'

const TABS = [
  { id: 'productos', label: 'Productos' },
  { id: 'compras', label: 'Factura de entrada' },
  { id: 'saldos', label: 'Saldos iniciales' },
  { id: 'salidas', label: 'Salidas' },
  { id: 'kardex', label: 'Kardex' },
]

export default function Inventario() {
  const navigate = useNavigate()
  const { user } = useAuth()
  // Solo el dueño puede modificar inventario. El cajero lo ve pero no toca
  // (nada de facturas de entrada, saldos, salidas ni edición de productos).
  const soloVer = user?.rol !== 'dueño'
  const tabs = soloVer ? TABS.filter((t) => t.id === 'productos' || t.id === 'kardex') : TABS
  const [tab, setTab] = useState('productos')

  return (
    <>
      <Header title="Inventario" sub={soloVer ? 'Productos y kardex (solo ver)' : 'Productos, saldos, entradas, salidas y kardex'} onBack={() => navigate('/')} />
      <div className="content">
        <div className="subtabs">
          {tabs.map((t) => (
            <button key={t.id} className={`subtab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'productos' && <Productos embedded readOnly={soloVer} />}
      {tab === 'compras' && !soloVer && <Compras />}
      {tab === 'saldos' && !soloVer && <SaldosIniciales />}
      {tab === 'salidas' && !soloVer && <Salidas />}
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

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

function catId(txt) {
  const t = norm(txt)
  const c = CATEGORIAS_PRODUCTO.find((x) => x.id === t || norm(x.label) === t)
  return c ? c.id : 'otro'
}

// Número tolerante a formato colombiano: "2.500,00" → 2500, "12.000" → 12000.
function num(v) {
  if (typeof v === 'number') return Math.round(v)
  let s = String(v ?? '').trim()
  if (!s) return 0
  if (s.includes(',')) s = s.slice(0, s.indexOf(',')) // corta la parte decimal (coma COP)
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

// Busca una columna de la fila por cualquiera de sus nombres, sin tildes ni mayúsculas.
function getCol(row, ...alts) {
  const keys = Object.keys(row || {})
  for (const alt of alts) {
    const na = norm(alt)
    const k = keys.find((kk) => norm(kk) === na)
    if (k != null) return row[k]
  }
  return ''
}

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
      let creados = 0, actualizados = 0, saltados = 0
      for (const r of rows) {
        const nombre = String(getCol(r, 'Producto', 'nombre', 'descripcion', 'articulo', 'item') ?? '').trim()
        if (!nombre || nombre.toLowerCase().startsWith('ejemplo')) { saltados++; continue }
        const existencia = num(getCol(r, 'Existencia', 'stock', 'cantidad', 'exist'))
        const pc = num(getCol(r, 'Precio compra', 'precio de compra', 'compra', 'costo', 'p compra'))
        const pv = num(getCol(r, 'Precio venta', 'precio de venta', 'venta', 'precio', 'p venta'))
        const sm = num(getCol(r, 'Stock minimo', 'stock min', 'minimo', 'min'))
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
            categoria: catId(getCol(r, 'Categoria', 'categoría', 'linea')),
            precioCompra: pc, precioVenta: pv, stock: existencia,
            stockMin: sm || STOCK_MIN_DEFAULT,
          }))
          creados++
        }
      }
      if (creados === 0 && actualizados === 0) {
        show(saltados > 0 ? 'No reconocí las columnas. Usa la plantilla o encabezado "Producto".' : 'El archivo no tenía productos')
      } else {
        show(`Listo: ${actualizados} actualizados, ${creados} nuevos`)
      }
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

// ------------------- ENTRADA DE FACTURA (compras a proveedores) -------------------
const IVA_OPCIONES = [0, 5, 19]
const emptyLinea = (modo = 'existente') => ({
  key: uid(), modo, productoId: '', nombre: '',
  codigo: '', referencia: '', unidad: 'unidad', categoria: 'otro', precioVenta: 0, stockInicial: 0,
  cantidad: 0, costoUnit: 0, iva: 0, descPct: 0,
})
// Cálculos de una línea
const lineaBase = (l) => (l.costoUnit || 0) * (l.cantidad || 0)               // bruto (cant × costo)
const lineaNeto = (l) => lineaBase(l) * (1 - (l.descPct || 0) / 100)          // neto (menos % desc de línea)
const lineaIva = (l) => lineaNeto(l) * ((l.iva || 0) / 100)

function Compras() {
  const { show, node } = useToast()
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const proveedores = useLiveQuery(() => db.proveedores.where('activo').equals(1).toArray(), [], [])
  const compras = useLiveQuery(() => db.compras.toArray(), [], [])
  const excelRef = useRef(null)

  const emptyEnc = () => ({ proveedorId: '', proveedorNuevo: '', nit: '', numero: '', fecha: dayKey(), formaPago: 'contado', observaciones: '', descuentoGlobal: 0 })
  const [modo, setModo] = useState('lista') // 'lista' | 'nueva'
  const [enc, setEnc] = useState(emptyEnc())
  const [lineas, setLineas] = useState([])
  const [avanzado, setAvanzado] = useState(false) // opciones avanzadas ocultas por defecto

  const lista = (compras || []).slice().sort((a, b) => b.fecha - a.fecha).slice(0, 60)
  const nombreProv = (id) => (proveedores || []).find((p) => p.id === id)?.nombre || '—'

  // --- Totales de la factura ---
  const subtotalBruto = lineas.reduce((s, l) => s + lineaBase(l), 0)
  const descLineas = lineas.reduce((s, l) => s + (lineaBase(l) - lineaNeto(l)), 0)
  const baseNeta = lineas.reduce((s, l) => s + lineaNeto(l), 0)
  const descGlobalMonto = Math.round(baseNeta * ((enc.descuentoGlobal || 0) / 100))
  const ivaTotal = Math.round(lineas.reduce((s, l) => s + lineaIva(l), 0) * (1 - (enc.descuentoGlobal || 0) / 100))
  const totalCompra = Math.round(baseNeta - descGlobalMonto) + ivaTotal
  const descuentoTotal = Math.round(descLineas) + descGlobalMonto

  function nuevaFactura() { setEnc(emptyEnc()); setLineas([emptyLinea('existente')]); setAvanzado(false); setModo('nueva') }

  // --- Editar una factura de entrada YA guardada (proveedor, cantidades, costo,
  // N° factura y forma de pago). Ajusta el stock por la diferencia de cantidades. ---
  const [editCompra, setEditCompra] = useState(null)
  const [editEnc, setEditEnc] = useState({ proveedorId: '', proveedorNuevo: '', nit: '', numero: '', formaPago: 'contado' })
  const [editItems, setEditItems] = useState([])
  function editarCompra(c) {
    setEditCompra(c)
    setEditEnc({ proveedorId: c.proveedorId || '', proveedorNuevo: '', nit: c.nit || '', numero: c.numero || '', formaPago: c.formaPago || 'contado' })
    setEditItems((c.items || []).map((it) => ({ ...it })))
    setEditItemsBase((c.items || []).map((it) => ({ ...it })))
  }
  const [editItemsBase, setEditItemsBase] = useState([]) // cantidades originales (para el delta)
  function updateEditItem(idx, patch) { setEditItems((its) => its.map((it, i) => (i === idx ? { ...it, ...patch } : it))) }

  async function guardarEdicionCompra() {
    try {
      await db.transaction('rw', db.productos, db.movimientos_inv, db.compras, db.proveedores, async () => {
        // Proveedor (existente o nuevo)
        let proveedorId = editEnc.proveedorId
        let proveedorNombre = nombreProv(proveedorId)
        if (editEnc.proveedorNuevo.trim()) {
          proveedorId = uid(); proveedorNombre = editEnc.proveedorNuevo.trim()
          await db.proveedores.add(stamp({ id: proveedorId, activo: 1, nombre: proveedorNombre, nit: editEnc.nit.trim() }))
        }
        // Ajustar stock por la diferencia de cantidad y actualizar el movimiento.
        const movs = await db.movimientos_inv.where('compraId').equals(editCompra.id).toArray()
        for (let k = 0; k < editItems.length; k++) {
          const it = editItems[k]
          const delta = (it.cantidad || 0) - (editItemsBase[k]?.cantidad || 0)
          if (delta !== 0) {
            const prod = await db.productos.get(it.productoId)
            if (prod) await db.productos.update(prod.id, stamp({ stock: Math.max(0, (prod.stock || 0) + delta) }))
          }
          const mov = movs.find((m) => m.productoId === it.productoId)
          if (mov) await db.movimientos_inv.update(mov.id, stamp({ cantidad: it.cantidad, costoUnit: it.costoUnit }))
        }
        // Recomputar totales (misma lógica que al crear).
        const descGlobal = editCompra.descuentoGlobal || 0
        const bruto = Math.round(editItems.reduce((s, l) => s + lineaBase(l), 0))
        const iva = Math.round(editItems.reduce((s, l) => s + lineaIva(l), 0) * (1 - descGlobal / 100))
        const totalFinal = Math.round(editItems.reduce((s, l) => s + lineaNeto(l), 0) * (1 - descGlobal / 100)) + iva
        await db.compras.update(editCompra.id, stamp({
          proveedorId: proveedorId || null, proveedorNombre, nit: editEnc.nit.trim(),
          numero: editEnc.numero.trim(), formaPago: editEnc.formaPago,
          items: editItems, subtotal: bruto, iva, total: totalFinal,
        }))
      })
      setEditCompra(null)
      show('Factura actualizada')
    } catch (e) {
      show('No se pudo actualizar la factura')
    }
  }
  function agregarLineaNueva(modo) { setLineas((ls) => [...ls, emptyLinea(modo)]) }
  function updateLinea(key, patch) { setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))) }
  function quitarLinea(key) { setLineas((ls) => ls.filter((l) => l.key !== key)) }
  function elegirExistenteLinea(key, id) {
    const p = (productos || []).find((x) => x.id === id)
    updateLinea(key, { productoId: id, nombre: p?.nombre || '', costoUnit: p?.precioCompra || 0, categoria: p?.categoria || 'otro' })
  }

  async function importarExcel(e) {
    const file = e.target.files?.[0]; if (!file) return
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const nuevas = []
      for (const r of rows) {
        const nombre = String(getCol(r, 'Producto', 'nombre', 'descripcion', 'articulo') ?? '').trim()
        const cantidad = num(getCol(r, 'Cantidad', 'cant', 'unidades'))
        if (!nombre || !cantidad) continue
        const costo = num(getCol(r, 'Costo', 'costo unitario', 'precio compra', 'compra', 'costo unit'))
        const p = (productos || []).find((x) => x.nombre.trim().toLowerCase() === nombre.toLowerCase())
        nuevas.push({ ...emptyLinea(p ? 'existente' : 'nuevo'), productoId: p?.id || '', nombre, categoria: p?.categoria || 'otro', costoUnit: costo, cantidad, iva: 0 })
      }
      if (nuevas.length) setLineas((ls) => [...ls.filter((l) => l.nombre || l.productoId), ...nuevas])
      show(nuevas.length ? `${nuevas.length} producto${nuevas.length > 1 ? 's' : ''} importado${nuevas.length > 1 ? 's' : ''}` : 'No reconocí productos (usa columnas Producto, Cantidad, Costo)')
    } catch { show('No pude leer el archivo') }
    e.target.value = ''
  }

  async function guardarCompra() {
    // Una línea es válida si identifica un producto: existente por id, o nuevo
    // por nombre. La cantidad es OPCIONAL: un producto nuevo sin cantidad se
    // crea igual en el catálogo (solo registro); si trae cantidad, además suma
    // stock y registra la compra.
    const conDatos = lineas.filter((l) => (l.modo === 'existente' ? l.productoId : l.nombre.trim()))
    if (conDatos.length === 0) return show('Agrega al menos un producto (nombre o elige uno existente)')
    const codigos = conDatos.filter((l) => l.modo === 'nuevo').map((l) => l.codigo.trim()).filter(Boolean)
    if (new Set(codigos).size !== codigos.length) return show('Hay códigos de barras repetidos en la factura')

    let creadosNuevos = 0
    let huboCompra = false
    try {
      await db.transaction('rw', db.productos, db.movimientos_inv, db.compras, db.proveedores, async () => {
        const now = Date.now()
        let proveedorId = enc.proveedorId
        let proveedorNombre = nombreProv(proveedorId)
        if (enc.proveedorNuevo.trim()) {
          proveedorId = uid(); proveedorNombre = enc.proveedorNuevo.trim()
          await db.proveedores.add(stamp({ id: proveedorId, activo: 1, nombre: proveedorNombre, nit: enc.nit.trim() }))
        }

        const existentes = await db.productos.where('activo').equals(1).toArray()
        const compraId = uid()
        const itemsCompra = []

        for (const l of conDatos) {
          let prod
          if (l.modo === 'nuevo') {
            const nombreNorm = l.nombre.trim().toLowerCase()
            const codigoNorm = l.codigo.trim()
            const dupNombre = existentes.find((p) => p.nombre.trim().toLowerCase() === nombreNorm)
            const dupCodigo = codigoNorm && existentes.find((p) => (p.codigo || '').trim() === codigoNorm)
            if (dupNombre || dupCodigo) {
              // Ya existe: su stock real ya está registrado, solo sumamos lo comprado
              // (NO el "stock ya existente", que es solo para productos nuevos de verdad).
              prod = dupNombre || dupCodigo
              if (l.cantidad > 0) await db.productos.update(prod.id, stamp({ stock: (prod.stock || 0) + l.cantidad }))
            } else {
              // Producto nuevo: se crea SIEMPRE (aunque no haya cantidad), con su
              // stock ya existente + lo comprado.
              const id = uid()
              prod = {
                id, activo: 1, nombre: l.nombre.trim(), codigo: codigoNorm, referencia: l.referencia.trim(),
                unidad: l.unidad, categoria: l.categoria, precioCompra: l.costoUnit, precioVenta: l.precioVenta,
                stock: l.stockInicial + l.cantidad, stockMin: STOCK_MIN_DEFAULT,
              }
              await db.productos.add(stamp(prod))
              existentes.push(prod)
              creadosNuevos++
            }
          } else {
            prod = await db.productos.get(l.productoId)
            if (!prod) continue // el producto ya no existe: saltamos la línea en vez de romper la factura
            if (l.cantidad > 0) await db.productos.update(prod.id, stamp({ stock: (prod.stock || 0) + l.cantidad, precioCompra: l.costoUnit }))
          }
          // Movimiento de entrada y renglón de la compra SOLO si se compró cantidad.
          if (l.cantidad > 0 && prod) {
            await db.movimientos_inv.add(stamp({
              id: uid(), tipo: 'entrada', productoId: prod.id, productoNombre: prod.nombre,
              cantidad: l.cantidad, costoUnit: l.costoUnit, compraId,
              nota: `Factura ${enc.numero || 's/n'}${proveedorNombre !== '—' ? ' · ' + proveedorNombre : ''}`,
              fecha: now, mes: monthKey(now),
            }))
            itemsCompra.push({ productoId: prod.id, nombre: prod.nombre, cantidad: l.cantidad, costoUnit: l.costoUnit, iva: l.iva || 0, descPct: l.descPct || 0 })
          }
        }

        // Solo registramos la factura de compra si de verdad se compraron unidades.
        if (itemsCompra.length > 0) {
          huboCompra = true
          const comprados = conDatos.filter((l) => l.cantidad > 0)
          const bruto = Math.round(comprados.reduce((s, l) => s + lineaBase(l), 0))
          const iva = Math.round(comprados.reduce((s, l) => s + lineaIva(l), 0) * (1 - (enc.descuentoGlobal || 0) / 100))
          const totalFinal = Math.round(comprados.reduce((s, l) => s + lineaNeto(l), 0) * (1 - (enc.descuentoGlobal || 0) / 100)) + iva
          await db.compras.add(stamp({
            id: compraId, proveedorId: proveedorId || null, proveedorNombre, nit: enc.nit.trim(),
            numero: enc.numero.trim(), fecha: now, fechaFactura: enc.fecha,
            formaPago: enc.formaPago, observaciones: enc.observaciones.trim(), descuentoGlobal: enc.descuentoGlobal || 0,
            items: itemsCompra, subtotal: bruto, iva, total: totalFinal, mes: monthKey(now),
          }))
        }
      })
      const nNuevos = `${creadosNuevos} producto${creadosNuevos > 1 ? 's' : ''}`
      show(
        creadosNuevos && !huboCompra ? `${nNuevos} creado${creadosNuevos > 1 ? 's' : ''} en el catálogo`
          : creadosNuevos ? `Factura guardada · ${nNuevos} nuevo${creadosNuevos > 1 ? 's' : ''} en el catálogo`
            : huboCompra ? 'Factura guardada · inventario actualizado'
              : 'Sin cambios')
      setModo('lista')
    } catch (e) {
      show('No se pudo guardar la factura')
    }
  }

  // -------- VISTA NUEVA FACTURA --------
  if (modo === 'nueva') {
    return (
      <div className="content">
        <button className="btn ghost" style={{ marginBottom: 12 }} onClick={() => setModo('lista')}>‹ Cancelar</button>
        <div className="section-title" style={{ marginTop: 0 }}>Entrada de productos</div>
        <div className="helper" style={{ marginBottom: 8 }}>Elige el producto (o crea uno nuevo), pon la cantidad y el costo. Nada más.</div>

        {/* Proveedor: siempre visible (opcional) */}
        <label>Proveedor (opcional)</label>
        <SearchSelect value={enc.proveedorId} onChange={(v) => setEnc({ ...enc, proveedorId: v, proveedorNuevo: '' })}
          options={(proveedores || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => ({ value: p.id, label: p.nombre }))}
          placeholder="Buscar proveedor…" />
        <input value={enc.proveedorNuevo} placeholder="…o escribe un proveedor nuevo"
          onChange={(e) => setEnc({ ...enc, proveedorNuevo: e.target.value, proveedorId: e.target.value ? '' : enc.proveedorId })} />

        {/* NIT, N° factura, fecha — solo en avanzado */}
        {avanzado && (
          <>
            <label>NIT del proveedor</label>
            <input value={enc.nit} placeholder="Ej: 900123456-7"
              onChange={(e) => setEnc({ ...enc, nit: e.target.value })} />
            <div className="grid-2">
              <div>
                <label>N° factura</label>
                <input value={enc.numero} placeholder="Ej: FV-001234"
                  onChange={(e) => setEnc({ ...enc, numero: e.target.value })} />
              </div>
              <div>
                <label>Fecha</label>
                <input type="date" value={enc.fecha} onChange={(e) => setEnc({ ...enc, fecha: e.target.value })} />
              </div>
            </div>
          </>
        )}

        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Productos</span>
          <span className="btn-row" style={{ margin: 0 }}>
            {avanzado && <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={importarExcel} />}
            {avanzado && <button className="chip-lavador" onClick={() => excelRef.current?.click()}>Importar Excel</button>}
            <button className="chip-lavador" onClick={() => agregarLineaNueva('nuevo')}>+ Producto nuevo</button>
          </span>
        </div>

        {lineas.map((l) => (
          <div className="card" key={l.key} style={{ marginBottom: 10 }}>
            <div className="btn-row" style={{ marginBottom: 8 }}>
              <button className={`pill ${l.modo === 'existente' ? 'active' : ''}`} onClick={() => updateLinea(l.key, { modo: 'existente' })}>Ya existe</button>
              <button className={`pill ${l.modo === 'nuevo' ? 'active' : ''}`} onClick={() => updateLinea(l.key, { modo: 'nuevo' })}>Crear nuevo</button>
              <button className="btn ghost" style={{ width: 'auto', padding: '4px 12px', marginLeft: 'auto' }} onClick={() => quitarLinea(l.key)}>✕</button>
            </div>

            {l.modo === 'existente' ? (
              <SearchSelect value={l.productoId} onChange={(v) => elegirExistenteLinea(l.key, v)}
                options={opcionesProducto(productos)} placeholder="Buscar producto…" />
            ) : (
              <>
                <input value={l.nombre} placeholder="Nombre del producto nuevo"
                  onChange={(e) => updateLinea(l.key, { nombre: e.target.value })} />
                {/* Precio de venta: esencial para poder venderlo */}
                <div className={avanzado ? 'grid-2' : ''}>
                  <div><label style={{ margin: 0 }}>Precio de venta</label>
                    <MoneyInput value={l.precioVenta} onChange={(v) => updateLinea(l.key, { precioVenta: v })} /></div>
                  {avanzado && <div><label style={{ margin: 0 }}>Stock ya existente</label>
                    <input inputMode="numeric" value={l.stockInicial}
                      onChange={(e) => updateLinea(l.key, { stockInicial: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} /></div>}
                </div>
                {avanzado && (
                  <>
                    <div className="grid-2">
                      <input inputMode="numeric" value={l.codigo} placeholder="Código de barras (opcional)"
                        onChange={(e) => updateLinea(l.key, { codigo: e.target.value })} />
                      <input value={l.referencia} placeholder="Referencia (opcional)"
                        onChange={(e) => updateLinea(l.key, { referencia: e.target.value })} />
                    </div>
                    <div className="grid-2">
                      <SearchSelect value={l.unidad} onChange={(v) => updateLinea(l.key, { unidad: v })}
                        options={UNIDADES.map((u) => ({ value: u.id, label: u.label }))} placeholder="Unidad…" />
                      <SearchSelect value={l.categoria} onChange={(v) => updateLinea(l.key, { categoria: v })}
                        options={CATEGORIAS_PRODUCTO.map((c) => ({ value: c.id, label: c.label }))} placeholder="Categoría…" />
                    </div>
                  </>
                )}
              </>
            )}

            {l.modo === 'existente' && avanzado && (
              <SearchSelect value={l.categoria} onChange={(v) => updateLinea(l.key, { categoria: v })}
                options={CATEGORIAS_PRODUCTO.map((c) => ({ value: c.id, label: c.label }))} placeholder="Categoría…" />
            )}

            <div className={avanzado ? 'grid-4' : 'grid-2'}>
              <div><label style={{ margin: 0 }}>Cantidad</label>
                <input inputMode="numeric" value={l.cantidad}
                  onChange={(e) => updateLinea(l.key, { cantidad: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} /></div>
              <div><label style={{ margin: 0 }}>Costo unitario</label>
                <MoneyInput value={l.costoUnit} onChange={(v) => updateLinea(l.key, { costoUnit: v })} /></div>
              {avanzado && <div><label style={{ margin: 0 }}>IVA</label>
                <select value={l.iva} onChange={(e) => updateLinea(l.key, { iva: parseInt(e.target.value, 10) })}>
                  {IVA_OPCIONES.map((v) => <option key={v} value={v}>{v}%</option>)}
                </select></div>}
              {avanzado && <div><label style={{ margin: 0 }}>% Desc.</label>
                <input inputMode="numeric" value={l.descPct}
                  onChange={(e) => updateLinea(l.key, { descPct: Math.min(100, parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10)) })} /></div>}
            </div>
            <div className="helper" style={{ marginTop: 6 }}>Subtotal línea: <b>{money(lineaNeto(l))}</b>{avanzado && l.iva ? ` + IVA ${money(lineaIva(l))}` : ''}</div>
          </div>
        ))}

        <button className="btn secondary" onClick={() => agregarLineaNueva('existente')}>+ Agregar producto</button>

        {avanzado && (
          <div className="grid-2" style={{ marginTop: 12, alignItems: 'end' }}>
            <label style={{ margin: 0 }}>Descuento global sobre total (%)</label>
            <input inputMode="numeric" value={enc.descuentoGlobal}
              onChange={(e) => setEnc({ ...enc, descuentoGlobal: Math.min(100, parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10)) })} />
          </div>
        )}

        <div className="card" style={{ marginTop: 12 }}>
          <table className="tabla compacta">
            <tbody>
              {avanzado ? (
                <>
                  <tr><td>Subtotal bruto</td><td className="num">{money(subtotalBruto)}</td></tr>
                  {descuentoTotal > 0 && <tr><td>Descuento</td><td className="num" style={{ color: 'var(--red)' }}>−{money(descuentoTotal)}</td></tr>}
                  <tr><td>IVA</td><td className="num">{money(ivaTotal)}</td></tr>
                </>
              ) : null}
              <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num" style={{ fontWeight: 800, fontSize: 18 }}>{money(totalCompra)}</td></tr>
            </tbody>
          </table>
        </div>

        {avanzado && (
          <>
            <label>Forma de pago</label>
            <div className="pill-row">
              {FORMAS_PAGO_COMPRA.map((f) => (
                <button key={f.id} className={`pill ${enc.formaPago === f.id ? 'active' : ''}`}
                  onClick={() => setEnc({ ...enc, formaPago: f.id })}>{f.label}</button>
              ))}
            </div>
            <label>Observaciones (opcional)</label>
            <input value={enc.observaciones} placeholder="Notas de la compra"
              onChange={(e) => setEnc({ ...enc, observaciones: e.target.value })} />
          </>
        )}

        <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setAvanzado((a) => !a)}>
          {avanzado ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas (NIT, IVA, N° factura, Excel…)'}
        </button>

        <div style={{ height: 12 }} />
        <button className="btn" onClick={guardarCompra}>Guardar y sumar al inventario</button>
        {node}
      </div>
    )
  }

  // -------- VISTA LISTA --------
  return (
    <div className="content">
      <div className="helper" style={{ marginBottom: 10 }}>
        Registra las facturas de compra a proveedores. Cada factura suma al inventario y puede crear productos nuevos.
      </div>
      {lista.length === 0 && <div className="empty">Sin facturas de entrada registradas.</div>}
      {lista.map((c) => (
        <div className="row" key={c.id} onClick={() => editarCompra(c)} style={{ cursor: 'pointer' }}>
          <div className="main">
            <div className="title">{c.proveedorNombre || 'Proveedor s/n'}{c.numero ? ` · Factura ${c.numero}` : ''}</div>
            <div className="meta">{shortDate(c.fecha)} · {(c.items || []).length} productos · {labelFormaPagoCompra(c.formaPago)}</div>
          </div>
          <div className="right">
            <div style={{ fontWeight: 700 }}>{money(c.total)}</div>
            <div className="meta">Editar</div>
          </div>
        </div>
      ))}

      <button className="fab" onClick={nuevaFactura} aria-label="Nueva factura de entrada">+</button>

      {/* Editar una factura de entrada guardada */}
      <Sheet open={!!editCompra} onClose={() => setEditCompra(null)} title="Editar factura de entrada">
        {editCompra && (
          <>
            <label>NIT del proveedor</label>
            <input value={editEnc.nit} placeholder="Ej: 900123456-7"
              onChange={(e) => setEditEnc({ ...editEnc, nit: e.target.value })} />
            <label>Proveedor</label>
            <SearchSelect value={editEnc.proveedorId} onChange={(v) => setEditEnc({ ...editEnc, proveedorId: v, proveedorNuevo: '' })}
              options={(proveedores || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => ({ value: p.id, label: p.nombre }))}
              placeholder="Buscar proveedor…" />
            <input value={editEnc.proveedorNuevo} placeholder="…o nombre de un proveedor nuevo"
              onChange={(e) => setEditEnc({ ...editEnc, proveedorNuevo: e.target.value, proveedorId: e.target.value ? '' : editEnc.proveedorId })} />

            <label>N° factura</label>
            <input value={editEnc.numero} placeholder="Ej: FV-001234"
              onChange={(e) => setEditEnc({ ...editEnc, numero: e.target.value })} />

            <label>Forma de pago</label>
            <div className="pill-row">
              {FORMAS_PAGO_COMPRA.map((f) => (
                <button key={f.id} className={`pill ${editEnc.formaPago === f.id ? 'active' : ''}`}
                  onClick={() => setEditEnc({ ...editEnc, formaPago: f.id })}>{f.label}</button>
              ))}
            </div>

            <div className="section-title">Productos (cantidad y costo)</div>
            <div className="helper" style={{ marginTop: -4, marginBottom: 8 }}>Si cambias la cantidad, el inventario se ajusta por la diferencia.</div>
            {editItems.map((it, idx) => (
              <div className="card" key={idx} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{it.nombre}</div>
                <div className="grid-2">
                  <div><label style={{ margin: 0 }}>Cantidad</label>
                    <input inputMode="numeric" value={it.cantidad}
                      onChange={(e) => updateEditItem(idx, { cantidad: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} /></div>
                  <div><label style={{ margin: 0 }}>Costo unitario</label>
                    <MoneyInput value={it.costoUnit} onChange={(v) => updateEditItem(idx, { costoUnit: v })} /></div>
                </div>
              </div>
            ))}

            <div style={{ height: 12 }} />
            <button className="btn" onClick={guardarEdicionCompra}>Guardar cambios</button>
          </>
        )}
      </Sheet>
      {node}
    </div>
  )
}
