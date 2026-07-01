import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, emojiCategoria, stockBajo } from '../db'
import { money, monthKey } from '../format'
import { Header, useToast } from '../components/ui'
import { useAuth } from '../auth'

export default function Caja() {
  const { show, node } = useToast()
  const { user } = useAuth()
  const [modo, setModo] = useState('producto') // 'producto' | 'servicio'

  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])

  // Carrito de productos: { [productoId]: cantidad }
  const [carrito, setCarrito] = useState({})
  // Servicio seleccionado y trabajador (por defecto, quien tiene la sesión
  // abierta si es un trabajador; el dueño elige a mano).
  const [servSel, setServSel] = useState(null)
  const [trabSel, setTrabSel] = useState(user && user.rol !== 'dueño' ? user.id : null)

  const listaProd = (productos || []).sort((a, b) => a.nombre.localeCompare(b.nombre))
  const listaServ = (servicios || []).sort((a, b) => a.precio - b.precio)

  function addProducto(p) {
    setCarrito((c) => ({ ...c, [p.id]: (c[p.id] || 0) + 1 }))
  }
  function quitarProducto(id) {
    setCarrito((c) => {
      const n = (c[id] || 0) - 1
      const copy = { ...c }
      if (n <= 0) delete copy[id]
      else copy[id] = n
      return copy
    })
  }

  const itemsCarrito = Object.entries(carrito).map(([id, cant]) => {
    const p = listaProd.find((x) => x.id === id)
    return p ? { ...p, cantidad: cant } : null
  }).filter(Boolean)

  const totalProd = itemsCarrito.reduce((s, i) => s + i.precioVenta * i.cantidad, 0)
  const costoProd = itemsCarrito.reduce((s, i) => s + i.precioCompra * i.cantidad, 0)
  const gananciaProd = totalProd - costoProd

  async function cobrarProductos() {
    if (itemsCarrito.length === 0) return
    const now = Date.now()
    await db.ventas.add(stamp({
      id: uid(),
      tipo: 'producto',
      fecha: now,
      mes: monthKey(now),
      items: itemsCarrito.map((i) => ({
        productoId: i.id,
        nombre: i.nombre,
        cantidad: i.cantidad,
        precioVenta: i.precioVenta,
        precioCompra: i.precioCompra, // costo congelado al momento de la venta
      })),
      total: totalProd,
      costo: costoProd,
      ganancia: gananciaProd,
    }))
    // Descontar stock
    for (const i of itemsCarrito) {
      await db.productos.update(i.id, stamp({ stock: Math.max(0, (i.stock || 0) - i.cantidad) }))
    }
    setCarrito({})
    show(`Venta registrada · ${money(totalProd)}`)
  }

  async function cobrarServicio() {
    if (!servSel) return show('Elige un servicio')
    const s = listaServ.find((x) => x.id === servSel)
    const t = (trabajadores || []).find((x) => x.id === trabSel)
    const comision = Math.round(s.precio * (s.comisionPct / 100))
    const now = Date.now()
    await db.ventas.add(stamp({
      id: uid(),
      tipo: 'servicio',
      fecha: now,
      mes: monthKey(now),
      servicioId: s.id,
      servicioNombre: s.nombre,
      precio: s.precio,
      comisionPct: s.comisionPct,
      comision,
      trabajadorId: t ? t.id : null,
      trabajadorNombre: t ? t.nombre : null,
      total: s.precio,
      costo: comision,        // para el lavado, el "costo" directo es la comisión
      ganancia: s.precio - comision,
    }))
    setServSel(null)
    setTrabSel(null)
    show(`Servicio registrado · ${money(s.precio)}`)
  }

  return (
    <>
      <Header title="Caja" sub="Registra ventas y servicios en segundos" />

      <div className="content">
        <div className="pill-row">
          <button className={`pill ${modo === 'producto' ? 'active' : ''}`} onClick={() => setModo('producto')}>
            🛒 Productos
          </button>
          <button className={`pill ${modo === 'servicio' ? 'active' : ''}`} onClick={() => setModo('servicio')}>
            🚿 Servicio
          </button>
        </div>

        {modo === 'producto' && (
          <>
            <div className="tiles">
              {listaProd.map((p) => (
                <button className="tile" key={p.id} onClick={() => addProducto(p)}>
                  <span className="emoji">{emojiCategoria(p.categoria)}</span>
                  <span className="name">{p.nombre}</span>
                  <span className="price">{money(p.precioVenta)}{carrito[p.id] ? ` · x${carrito[p.id]}` : ''}</span>
                  {stockBajo(p) && <span className="badge amber" style={{ marginTop: 2 }}>⚠️ quedan {p.stock ?? 0}</span>}
                </button>
              ))}
            </div>
            {listaProd.length === 0 && <div className="empty">Agrega productos en la pestaña Productos.</div>}

            {itemsCarrito.length > 0 && (
              <>
                <div className="section-title">Carrito</div>
                {itemsCarrito.map((i) => (
                  <div className="row" key={i.id}>
                    <div className="main">
                      <div className="title">{i.nombre}</div>
                      <div className="meta">{money(i.precioVenta)} c/u</div>
                    </div>
                    <div className="right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button className="btn ghost" style={{ width: 40, padding: 8 }} onClick={() => quitarProducto(i.id)}>−</button>
                      <b style={{ minWidth: 20 }}>{i.cantidad}</b>
                      <button className="btn ghost" style={{ width: 40, padding: 8 }} onClick={() => addProducto(i)}>+</button>
                    </div>
                  </div>
                ))}
                <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="meta">Total</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{money(totalProd)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="meta">Ganancia</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>+{money(gananciaProd)}</div>
                  </div>
                </div>
                <button className="btn" onClick={cobrarProductos}>Cobrar {money(totalProd)}</button>
              </>
            )}
          </>
        )}

        {modo === 'servicio' && (
          <>
            <div className="tiles">
              {listaServ.map((s) => (
                <button
                  className="tile"
                  key={s.id}
                  style={servSel === s.id ? { borderColor: 'var(--primary)', background: 'var(--surface-2)' } : null}
                  onClick={() => setServSel(s.id)}
                >
                  <span className="name">{s.nombre}</span>
                  <span className="price">{money(s.precio)}</span>
                </button>
              ))}
            </div>
            {listaServ.length === 0 && <div className="empty">Agrega servicios en la pestaña Servicios.</div>}

            {servSel && (
              <>
                <div className="section-title">¿Quién hizo el lavado?</div>
                <div className="pill-row">
                  {(trabajadores || []).map((t) => (
                    <button key={t.id} className={`pill ${trabSel === t.id ? 'active' : ''}`} onClick={() => setTrabSel(t.id)}>
                      👤 {t.nombre}
                    </button>
                  ))}
                  <button className={`pill ${trabSel === null ? 'active' : ''}`} onClick={() => setTrabSel(null)}>
                    Sin asignar
                  </button>
                </div>

                {(() => {
                  const s = listaServ.find((x) => x.id === servSel)
                  const comision = Math.round(s.precio * (s.comisionPct / 100))
                  return (
                    <div className="card" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div className="meta">Comisión ({s.comisionPct}%)</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--amber)' }}>{money(comision)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="meta">Queda para el negocio</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{money(s.precio - comision)}</div>
                      </div>
                    </div>
                  )
                })()}

                <button className="btn" onClick={cobrarServicio}>
                  Cobrar {money(listaServ.find((x) => x.id === servSel).precio)}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {node}
    </>
  )
}
