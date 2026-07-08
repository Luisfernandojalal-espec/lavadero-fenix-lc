import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, CATEGORIAS_PRODUCTO, UNIDADES, labelCategoria, stockBajo, STOCK_MIN_DEFAULT } from '../db'
import { money } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'

const emptyForm = { nombre: '', codigo: '', referencia: '', unidad: 'unidad', categoria: 'cerveza', precioCompra: 0, precioVenta: 0, stock: 0, stockMin: STOCK_MIN_DEFAULT }

export default function Productos({ embedded, readOnly }) {
  const navigate = useNavigate()
  const { show, node } = useToast()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filtro, setFiltro] = useState('todos')
  const [q, setQ] = useState('')

  const productos = useLiveQuery(
    () => db.productos.where('activo').equals(1).toArray(),
    [],
    []
  )

  const sinTildes = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const visibles = (productos || [])
    .filter((p) => filtro === 'todos' || p.categoria === filtro)
    .filter((p) => !q.trim() || sinTildes(p.nombre).includes(sinTildes(q)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  const valorInventario = (productos || []).reduce((s, p) => s + (p.stock || 0) * (p.precioCompra || 0), 0)
  const bajos = (productos || []).filter(stockBajo).length

  function abrirNuevo() {
    setEditId(null)
    setForm(emptyForm)
    setSheetOpen(true)
  }

  function abrirEditar(p) {
    setEditId(p.id)
    setForm({
      nombre: p.nombre,
      codigo: p.codigo || '',
      referencia: p.referencia || '',
      unidad: p.unidad || 'unidad',
      categoria: p.categoria,
      precioCompra: p.precioCompra,
      precioVenta: p.precioVenta,
      stock: p.stock,
      stockMin: p.stockMin ?? STOCK_MIN_DEFAULT,
    })
    setSheetOpen(true)
  }

  async function guardar() {
    if (!form.nombre.trim()) return show('Ponle un nombre')
    if (form.precioVenta <= 0) return show('Falta el precio de venta')

    // Validar duplicados (nombre y código de barras) contra otros productos activos.
    const all = await db.productos.toArray()
    const activos = all.filter((p) => p.activo)
    const nombreNorm = form.nombre.trim().toLowerCase()
    const codigoNorm = form.codigo.trim()
    if (activos.some((p) => p.id !== editId && p.nombre.trim().toLowerCase() === nombreNorm))
      return show('Ya existe un producto con ese nombre')
    if (codigoNorm && activos.some((p) => p.id !== editId && (p.codigo || '').trim() === codigoNorm))
      return show('Ya existe un producto con ese código de barras')

    const datos = { ...form, nombre: form.nombre.trim(), codigo: codigoNorm, referencia: form.referencia.trim() }
    if (editId) {
      await db.productos.update(editId, stamp(datos))
      show('Producto actualizado')
    } else {
      // Si ya existe un producto BORRADO (inactivo) con el mismo nombre, se
      // REACTIVA ese mismo registro en vez de crear uno nuevo. Así conserva su
      // id y las ventas que lo referencian siguen enlazadas (no se rompe el
      // descuento de stock ni el historial).
      const borrado = all.find((p) => !p.activo && p.nombre.trim().toLowerCase() === nombreNorm)
      if (borrado) {
        await db.productos.update(borrado.id, stamp({ activo: 1, ...datos }))
        show('Producto reactivado (ya existía borrado)')
      } else {
        await db.productos.add(stamp({ id: uid(), activo: 1, ...datos }))
        show('Producto agregado')
      }
    }
    setSheetOpen(false)
  }

  async function eliminar() {
    if (!editId) return
    // Borrado lógico: conserva el historial de ventas intacto
    await db.productos.update(editId, stamp({ activo: 0 }))
    setSheetOpen(false)
    show('Producto eliminado')
  }

  const margen = form.precioVenta - form.precioCompra
  const margenPct = form.precioVenta > 0 ? Math.round((margen / form.precioVenta) * 100) : 0

  return (
    <>
      {!embedded && <Header title="Inventario" sub="Productos · precios · márgenes · stock" onBack={() => navigate('/')} />}

      <div className="content">
        {/* Indicadores del inventario */}
        <div className="mini-kpis">
          <div className="mini-kpi">
            <div className="label">Productos</div>
            <div className="value">{(productos || []).length}</div>
          </div>
          {!readOnly && (
            <div className="mini-kpi">
              <div className="label">Valor a costo</div>
              <div className="value">{money(valorInventario)}</div>
            </div>
          )}
          <div className="mini-kpi">
            <div className="label">Stock bajo</div>
            <div className={`value ${bajos > 0 ? 'alerta' : ''}`}>{bajos}</div>
          </div>
        </div>

        <input className="buscador" inputMode="search" placeholder="Buscar producto…"
          value={q} onChange={(e) => setQ(e.target.value)} />

        <div className="pill-row">
          <button className={`pill ${filtro === 'todos' ? 'active' : ''}`} onClick={() => setFiltro('todos')}>
            Todos
          </button>
          {CATEGORIAS_PRODUCTO.map((c) => (
            <button key={c.id} className={`pill ${filtro === c.id ? 'active' : ''}`} onClick={() => setFiltro(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        {visibles.length === 0 && (
          <div className="empty">
            {q ? <>Sin resultados para “{q}”.</> : readOnly ? (
              <>No hay productos todavía.</>
            ) : (
              <>
                No hay productos todavía.
                <div style={{ height: 14 }} />
                <button className="btn" style={{ maxWidth: 320 }} onClick={abrirNuevo}>Agregar producto</button>
                <div className="helper" style={{ marginTop: 10 }}>
                  o súbelos todos de una vez con la plantilla de Excel en la pestaña <b>Saldos iniciales</b>.
                </div>
              </>
            )}
          </div>
        )}

        {visibles.length > 0 && (
          <table className="tabla compacta">
            <thead>
              <tr>
                <th>Producto</th>
                {!readOnly && <th className="num">Compra</th>}
                <th className="num">Venta</th>
                {!readOnly && <th className="num">Margen</th>}
                <th className="num">Exist.</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const m = p.precioVenta - p.precioCompra
                const pct = p.precioVenta > 0 ? Math.round((m / p.precioVenta) * 100) : 0
                const bajo = stockBajo(p)
                return (
                  <tr key={p.id} onClick={readOnly ? undefined : () => abrirEditar(p)} style={readOnly ? undefined : { cursor: 'pointer' }}>
                    <td>
                      {p.nombre}
                      <div className="muted-cell">{labelCategoria(p.categoria)}</div>
                    </td>
                    {!readOnly && <td className="num muted-cell">{money(p.precioCompra)}</td>}
                    <td className="num" style={{ fontWeight: 600 }}>{money(p.precioVenta)}</td>
                    {!readOnly && (
                      <td className="num" style={{ color: 'var(--green)' }}>
                        +{money(m)}
                        <div className="muted-cell">{pct}%</div>
                      </td>
                    )}
                    <td className="num" style={bajo ? { color: 'var(--amber)', fontWeight: 700 } : { fontWeight: 600 }}>
                      {p.stock ?? 0}
                      {bajo && <div className="muted-cell" style={{ color: 'var(--amber)' }}>bajo</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {!readOnly && <button className="fab" onClick={abrirNuevo} aria-label="Agregar producto">+</button>}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={editId ? 'Editar producto' : 'Nuevo producto'}>
        <label>Nombre</label>
        <input
          value={form.nombre}
          placeholder="Ej: Cerveza Águila"
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
        />

        <label>Categoría</label>
        <SearchSelect value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })}
          options={CATEGORIAS_PRODUCTO.map((c) => ({ value: c.id, label: c.label }))} placeholder="Buscar categoría…" />

        <div className="grid-2">
          <div>
            <label>Código de barras</label>
            <input inputMode="numeric" value={form.codigo} placeholder="Opcional"
              onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
          </div>
          <div>
            <label>Referencia</label>
            <input value={form.referencia} placeholder="Opcional"
              onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
          </div>
        </div>

        <label>Unidad de medida</label>
        <SearchSelect value={form.unidad} onChange={(v) => setForm({ ...form, unidad: v })}
          options={UNIDADES.map((u) => ({ value: u.id, label: u.label }))} placeholder="Unidad…" />

        <div className="grid-2">
          <div>
            <label>Precio de compra</label>
            <MoneyInput value={form.precioCompra} onChange={(v) => setForm({ ...form, precioCompra: v })} />
          </div>
          <div>
            <label>Precio de venta</label>
            <MoneyInput value={form.precioVenta} onChange={(v) => setForm({ ...form, precioVenta: v })} />
          </div>
        </div>

        <div className="card" style={{ marginTop: 14, marginBottom: 0, textAlign: 'center' }}>
          <div className="meta" style={{ color: 'var(--muted)', fontSize: 13 }}>Ganancia por unidad</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: margen >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {money(margen)} <span style={{ fontSize: 15, color: 'var(--muted)' }}>({margenPct}%)</span>
          </div>
        </div>

        <div className="grid-2">
          <div>
            <label>Stock (disponibles)</label>
            <input
              inputMode="numeric"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })}
            />
          </div>
          <div>
            <label>Avisar cuando queden</label>
            <input
              inputMode="numeric"
              value={form.stockMin}
              onChange={(e) => setForm({ ...form, stockMin: parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) })}
            />
          </div>
        </div>
        <div className="helper">Te avisamos cuando el stock baje a este número o menos.</div>

        <div style={{ height: 16 }} />
        <button className="btn" onClick={guardar}>{editId ? 'Guardar cambios' : 'Agregar producto'}</button>
        {editId && (
          <>
            <div style={{ height: 10 }} />
            <button className="btn danger" onClick={eliminar}>Eliminar producto</button>
          </>
        )}
      </Sheet>

      {node}
    </>
  )
}
