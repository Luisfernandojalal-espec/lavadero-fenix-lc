import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, MOTIVOS_SALIDA, CATEGORIAS_PRODUCTO, UNIDADES, FORMAS_PAGO_COMPRA, labelFormaPagoCompra, labelCategoria, STOCK_MIN_DEFAULT } from '../db'
import { money, monthKey, shortDate, dayKey } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
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
      {tab === 'compras' && <Compras />}
      {tab === 'saldos' && <SaldosIniciales />}
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

// ------------------- FACTURA DE ENTRADA (compras a proveedores) -------------------
const emptyLinea = () => ({
  key: uid(), modo: 'existente', productoId: '', nombre: '',
  codigo: '', referencia: '', unidad: 'unidad', categoria: 'otro', precioVenta: 0, stockInicial: 0,
  cantidad: 1, costoUnit: 0,
})

function Compras() {
  const { show, node } = useToast()
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const proveedores = useLiveQuery(() => db.proveedores.where('activo').equals(1).toArray(), [], [])
  const compras = useLiveQuery(() => db.compras.toArray(), [], [])

  const [modo, setModo] = useState('lista') // 'lista' | 'nueva'
  const [enc, setEnc] = useState({ proveedorId: '', proveedorNuevo: '', numero: '', fecha: dayKey(), formaPago: 'contado', observaciones: '' })
  const [lineas, setLineas] = useState([])

  // Editor de una línea (sheet)
  const [lineaSheet, setLineaSheet] = useState(false)
  const [linea, setLinea] = useState(emptyLinea())

  const lista = (compras || []).slice().sort((a, b) => b.fecha - a.fecha).slice(0, 60)
  const nombreProv = (id) => (proveedores || []).find((p) => p.id === id)?.nombre || '—'
  const totalCompra = lineas.reduce((s, l) => s + l.costoUnit * l.cantidad, 0)

  function nuevaFactura() {
    setEnc({ proveedorId: '', proveedorNuevo: '', numero: '', fecha: dayKey(), formaPago: 'contado', observaciones: '' })
    setLineas([]); setModo('nueva')
  }
  function abrirLinea() { setLinea(emptyLinea()); setLineaSheet(true) }
  function elegirExistente(id) {
    const p = (productos || []).find((x) => x.id === id)
    setLinea((l) => ({ ...l, productoId: id, nombre: p?.nombre || '', costoUnit: p?.precioCompra || 0 }))
  }
  function agregarLinea() {
    if (linea.modo === 'existente' && !linea.productoId) return show('Elige un producto')
    if (linea.modo === 'nuevo' && !linea.nombre.trim()) return show('Ponle nombre al producto nuevo')
    if (linea.cantidad <= 0) return show('Falta la cantidad')
    // Validar código duplicado dentro de la misma factura (productos nuevos)
    if (linea.modo === 'nuevo' && linea.codigo.trim() &&
      lineas.some((l) => l.modo === 'nuevo' && l.codigo.trim() === linea.codigo.trim()))
      return show('Ese código ya está en otra línea de esta factura')
    setLineas((ls) => [...ls, linea])
    setLineaSheet(false)
  }
  function quitarLinea(key) { setLineas((ls) => ls.filter((l) => l.key !== key)) }

  async function guardarCompra() {
    if (lineas.length === 0) return show('Agrega al menos un producto')
    const nuevos = lineas.filter((l) => l.modo === 'nuevo')
    const codigos = nuevos.map((l) => l.codigo.trim()).filter(Boolean)
    if (new Set(codigos).size !== codigos.length) return show('Hay códigos de barras repetidos en la factura')

    try {
      await db.transaction('rw', db.productos, db.movimientos_inv, db.compras, db.proveedores, async () => {
        const now = Date.now()
        // Proveedor (crear si es nuevo)
        let proveedorId = enc.proveedorId
        let proveedorNombre = nombreProv(proveedorId)
        if (enc.proveedorNuevo.trim()) {
          proveedorId = uid(); proveedorNombre = enc.proveedorNuevo.trim()
          await db.proveedores.add(stamp({ id: proveedorId, activo: 1, nombre: proveedorNombre }))
        }

        const existentes = await db.productos.where('activo').equals(1).toArray()
        const compraId = uid()
        const itemsCompra = []

        for (const l of lineas) {
          let prod
          if (l.modo === 'nuevo') {
            const nombreNorm = l.nombre.trim().toLowerCase()
            const codigoNorm = l.codigo.trim()
            const dupNombre = existentes.find((p) => p.nombre.trim().toLowerCase() === nombreNorm)
            const dupCodigo = codigoNorm && existentes.find((p) => (p.codigo || '').trim() === codigoNorm)
            if (dupNombre || dupCodigo) {
              // Ya existe: se trata como reposición del producto encontrado.
              prod = dupNombre || dupCodigo
              await db.productos.update(prod.id, stamp({ stock: (prod.stock || 0) + l.stockInicial + l.cantidad }))
            } else {
              const id = uid()
              prod = {
                id, activo: 1, nombre: l.nombre.trim(), codigo: codigoNorm, referencia: l.referencia.trim(),
                unidad: l.unidad, categoria: l.categoria, precioCompra: l.costoUnit, precioVenta: l.precioVenta,
                stock: l.stockInicial + l.cantidad, stockMin: STOCK_MIN_DEFAULT,
              }
              await db.productos.add(stamp(prod))
              existentes.push(prod)
            }
          } else {
            prod = await db.productos.get(l.productoId)
            await db.productos.update(prod.id, stamp({ stock: (prod.stock || 0) + l.cantidad, precioCompra: l.costoUnit }))
          }
          // Movimiento de inventario ligado a la factura
          await db.movimientos_inv.add(stamp({
            id: uid(), tipo: 'entrada', productoId: prod.id, productoNombre: prod.nombre,
            cantidad: l.cantidad, costoUnit: l.costoUnit, compraId,
            nota: `Factura ${enc.numero || 's/n'}${proveedorNombre !== '—' ? ' · ' + proveedorNombre : ''}`,
            fecha: now, mes: monthKey(now),
          }))
          itemsCompra.push({ productoId: prod.id, nombre: prod.nombre, cantidad: l.cantidad, costoUnit: l.costoUnit })
        }

        await db.compras.add(stamp({
          id: compraId, proveedorId: proveedorId || null, proveedorNombre,
          numero: enc.numero.trim(), fecha: now, fechaFactura: enc.fecha,
          formaPago: enc.formaPago, observaciones: enc.observaciones.trim(),
          items: itemsCompra, total: itemsCompra.reduce((s, i) => s + i.costoUnit * i.cantidad, 0),
          mes: monthKey(now),
        }))
      })
      show('Factura de entrada guardada · inventario actualizado')
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
        <div className="section-title" style={{ marginTop: 0 }}>Datos de la factura</div>

        <label>Proveedor</label>
        <SearchSelect value={enc.proveedorId} onChange={(v) => setEnc({ ...enc, proveedorId: v, proveedorNuevo: '' })}
          options={(proveedores || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => ({ value: p.id, label: p.nombre }))}
          placeholder="Buscar proveedor…" />
        <label>o proveedor nuevo</label>
        <input value={enc.proveedorNuevo} placeholder="Nombre del proveedor"
          onChange={(e) => setEnc({ ...enc, proveedorNuevo: e.target.value, proveedorId: e.target.value ? '' : enc.proveedorId })} />

        <div className="grid-2">
          <div>
            <label>N° de factura</label>
            <input value={enc.numero} placeholder="Ej: 4587"
              onChange={(e) => setEnc({ ...enc, numero: e.target.value })} />
          </div>
          <div>
            <label>Fecha</label>
            <input type="date" value={enc.fecha} onChange={(e) => setEnc({ ...enc, fecha: e.target.value })} />
          </div>
        </div>

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

        <div className="section-title">Productos de la factura</div>
        {lineas.length === 0 && <div className="empty" style={{ paddingBottom: 8 }}>Sin productos. Toca “Agregar producto”.</div>}
        {lineas.length > 0 && (
          <table className="tabla">
            <tbody>
              {lineas.map((l) => (
                <tr key={l.key}>
                  <td>
                    {l.nombre || '(nuevo)'} {l.modo === 'nuevo' && <span className="badge green">nuevo</span>}
                    <div className="muted-cell">{l.cantidad} × {money(l.costoUnit)}</div>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(l.costoUnit * l.cantidad)}</td>
                  <td className="num">
                    <button className="btn ghost" style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }}
                      onClick={() => quitarLinea(l.key)}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button className="btn secondary" onClick={abrirLinea}>Agregar producto</button>

        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <div className="meta">Total de la factura</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{money(totalCompra)}</div>
        </div>
        <button className="btn" onClick={guardarCompra}>Guardar factura y sumar al inventario</button>

        {/* Agregar línea */}
        <Sheet open={lineaSheet} onClose={() => setLineaSheet(false)} title="Producto de la factura">
          <div className="pill-row">
            <button className={`pill ${linea.modo === 'existente' ? 'active' : ''}`} onClick={() => setLinea({ ...linea, modo: 'existente' })}>Ya existe</button>
            <button className={`pill ${linea.modo === 'nuevo' ? 'active' : ''}`} onClick={() => setLinea({ ...linea, modo: 'nuevo' })}>Crear nuevo</button>
          </div>

          {linea.modo === 'existente' ? (
            <>
              <label>Producto</label>
              <SearchSelect value={linea.productoId} onChange={elegirExistente}
                options={opcionesProducto(productos)} placeholder="Buscar producto…" />
            </>
          ) : (
            <>
              <label>Nombre</label>
              <input value={linea.nombre} placeholder="Ej: Cerveza Águila"
                onChange={(e) => setLinea({ ...linea, nombre: e.target.value })} />
              <div className="grid-2">
                <div>
                  <label>Código de barras</label>
                  <input inputMode="numeric" value={linea.codigo} placeholder="Opcional"
                    onChange={(e) => setLinea({ ...linea, codigo: e.target.value })} />
                </div>
                <div>
                  <label>Referencia</label>
                  <input value={linea.referencia} placeholder="Opcional"
                    onChange={(e) => setLinea({ ...linea, referencia: e.target.value })} />
                </div>
              </div>
              <div className="grid-2">
                <div>
                  <label>Unidad</label>
                  <SearchSelect value={linea.unidad} onChange={(v) => setLinea({ ...linea, unidad: v })}
                    options={UNIDADES.map((u) => ({ value: u.id, label: u.label }))} placeholder="Unidad…" />
                </div>
                <div>
                  <label>Categoría</label>
                  <SearchSelect value={linea.categoria} onChange={(v) => setLinea({ ...linea, categoria: v })}
                    options={CATEGORIAS_PRODUCTO.map((c) => ({ value: c.id, label: c.label }))} placeholder="Categoría…" />
                </div>
              </div>
              <div className="grid-2">
                <div>
                  <label>Precio de venta</label>
                  <MoneyInput value={linea.precioVenta} onChange={(v) => setLinea({ ...linea, precioVenta: v })} />
                </div>
                <div>
                  <label>Stock ya existente</label>
                  <input inputMode="numeric" value={linea.stockInicial}
                    onChange={(e) => setLinea({ ...linea, stockInicial: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} />
                </div>
              </div>
            </>
          )}

          <div className="grid-2">
            <div>
              <label>Cantidad comprada</label>
              <input inputMode="numeric" value={linea.cantidad}
                onChange={(e) => setLinea({ ...linea, cantidad: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })} />
            </div>
            <div>
              <label>Costo por unidad</label>
              <MoneyInput value={linea.costoUnit} onChange={(v) => setLinea({ ...linea, costoUnit: v })} />
            </div>
          </div>
          <div className="helper" style={{ marginTop: 8 }}>Subtotal: <b>{money(linea.costoUnit * linea.cantidad)}</b></div>
          <div style={{ height: 14 }} />
          <button className="btn" onClick={agregarLinea}>Agregar a la factura</button>
        </Sheet>
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
        <div className="row" key={c.id}>
          <div className="main">
            <div className="title">{c.proveedorNombre || 'Proveedor s/n'}{c.numero ? ` · Factura ${c.numero}` : ''}</div>
            <div className="meta">{shortDate(c.fecha)} · {(c.items || []).length} productos · {labelFormaPagoCompra(c.formaPago)}</div>
          </div>
          <div className="right" style={{ fontWeight: 700 }}>{money(c.total)}</div>
        </div>
      ))}

      <button className="fab" onClick={nuevaFactura} aria-label="Nueva factura de entrada">+</button>
      {node}
    </div>
  )
}
