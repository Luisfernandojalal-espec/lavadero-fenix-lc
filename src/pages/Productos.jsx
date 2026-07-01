import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, CATEGORIAS_PRODUCTO, labelCategoria, stockBajo, STOCK_MIN_DEFAULT } from '../db'
import { money } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'

const emptyForm = { nombre: '', categoria: 'cerveza', precioCompra: 0, precioVenta: 0, stock: 0, stockMin: STOCK_MIN_DEFAULT }

export default function Productos({ embedded }) {
  const navigate = useNavigate()
  const { show, node } = useToast()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filtro, setFiltro] = useState('todos')

  const productos = useLiveQuery(
    () => db.productos.where('activo').equals(1).toArray(),
    [],
    []
  )

  const visibles = (productos || [])
    .filter((p) => filtro === 'todos' || p.categoria === filtro)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  function abrirNuevo() {
    setEditId(null)
    setForm(emptyForm)
    setSheetOpen(true)
  }

  function abrirEditar(p) {
    setEditId(p.id)
    setForm({
      nombre: p.nombre,
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

    if (editId) {
      await db.productos.update(editId, stamp({ ...form }))
      show('Producto actualizado')
    } else {
      await db.productos.add(stamp({ id: uid(), activo: 1, ...form }))
      show('Producto agregado')
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
          <div className="empty">No hay productos en esta categoría.<br />Toca el botón + para agregar.</div>
        )}

        {visibles.map((p) => {
          const m = p.precioVenta - p.precioCompra
          const pct = p.precioVenta > 0 ? Math.round((m / p.precioVenta) * 100) : 0
          return (
            <div className="row" key={p.id} onClick={() => abrirEditar(p)}>
              <div className="main">
                <div className="title">{p.nombre}</div>
                <div className="meta">
                  {labelCategoria(p.categoria)} · Compra {money(p.precioCompra)} · Venta {money(p.precioVenta)}
                </div>
                <div className="meta">
                  Existencia {p.stock}{' '}
                  {stockBajo(p) && <span className="badge amber">Stock bajo</span>}
                </div>
              </div>
              <div className="right">
                <div style={{ fontWeight: 700, color: 'var(--green)' }}>+{money(m)}</div>
                <span className="badge green">{pct}%</span>
              </div>
            </div>
          )
        })}
      </div>

      <button className="fab" onClick={abrirNuevo} aria-label="Agregar producto">+</button>

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
