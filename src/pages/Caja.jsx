import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, stockBajo } from '../db'
import { money, monthKey } from '../format'
import { Header, Sheet, useToast, SearchSelect } from '../components/ui'
import { useAuth } from '../auth'

export default function Caja() {
  const navigate = useNavigate()
  const { show, node } = useToast()
  const { user } = useAuth()
  const [modo, setModo] = useState('producto') // 'producto' | 'servicio'

  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])

  // Cobro a crédito: sheet para elegir/crear el cliente
  const [credito, setCredito] = useState(null) // null | 'producto' | 'servicio'
  const [clienteSel, setClienteSel] = useState('')
  const [clienteNuevo, setClienteNuevo] = useState('')

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

  async function cobrarProductos(metodo = 'contado', cliente = null) {
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
      metodoPago: metodo,
      clienteId: cliente ? cliente.id : null,
      clienteNombre: cliente ? cliente.nombre : null,
    }))
    // Descontar stock
    for (const i of itemsCarrito) {
      await db.productos.update(i.id, stamp({ stock: Math.max(0, (i.stock || 0) - i.cantidad) }))
    }
    setCarrito({})
    show(metodo === 'credito' ? `Fiado a ${cliente.nombre} · ${money(totalProd)}` : `Venta registrada · ${money(totalProd)}`)
  }

  async function cobrarServicio(metodo = 'contado', cliente = null) {
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
      metodoPago: metodo,
      clienteId: cliente ? cliente.id : null,
      clienteNombre: cliente ? cliente.nombre : null,
    }))
    setServSel(null)
    setTrabSel(null)
    show(metodo === 'credito' ? `Fiado a ${cliente.nombre} · ${money(s.precio)}` : `Servicio registrado · ${money(s.precio)}`)
  }

  async function confirmarCredito() {
    let cliente = null
    if (clienteNuevo.trim()) {
      cliente = { id: uid(), nombre: clienteNuevo.trim() }
      await db.clientes.add(stamp({ id: cliente.id, activo: 1, nombre: cliente.nombre, telefono: '' }))
    } else {
      cliente = (clientes || []).find((c) => c.id === clienteSel)
    }
    if (!cliente) return show('Elige o crea un cliente')
    const tipo = credito
    setCredito(null); setClienteSel(''); setClienteNuevo('')
    if (tipo === 'producto') await cobrarProductos('credito', cliente)
    else await cobrarServicio('credito', cliente)
  }

  return (
    <>
      <Header title="Factura rápida" sub="Vender productos y servicios" onBack={() => navigate('/')} />

      <div className="content">
        <div className="pill-row">
          <button className={`pill ${modo === 'producto' ? 'active' : ''}`} onClick={() => setModo('producto')}>
            Productos
          </button>
          <button className={`pill ${modo === 'servicio' ? 'active' : ''}`} onClick={() => setModo('servicio')}>
            Servicio
          </button>
        </div>

        {modo === 'producto' && (
          <>
            <div className="tiles">
              {listaProd.map((p) => (
                <button className="tile" key={p.id} onClick={() => addProducto(p)}>
                  <span className="name">{p.nombre}</span>
                  <span className="price">{money(p.precioVenta)}{carrito[p.id] ? ` · x${carrito[p.id]}` : ''}</span>
                  {stockBajo(p) && <span className="badge amber" style={{ marginTop: 2 }}>Quedan {p.stock ?? 0}</span>}
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
                <div className="btn-row">
                  <button className="btn" onClick={() => cobrarProductos('contado')}>Contado · {money(totalProd)}</button>
                  <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setCredito('producto')}>A crédito</button>
                </div>
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
                      {t.nombre}
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

                <div className="btn-row">
                  <button className="btn" onClick={() => cobrarServicio('contado')}>
                    Contado · {money(listaServ.find((x) => x.id === servSel).precio)}
                  </button>
                  <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setCredito('servicio')}>A crédito</button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <Sheet open={!!credito} onClose={() => setCredito(null)} title="Cobrar a crédito (fiado)">
        <label>Cliente</label>
        <SearchSelect value={clienteSel} onChange={(v) => { setClienteSel(v); setClienteNuevo('') }}
          options={(clientes || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((c) => ({ value: c.id, label: c.nombre }))}
          placeholder="Buscar cliente…" />
        <div className="helper" style={{ margin: '8px 0' }}>o crea uno nuevo:</div>
        <label>Cliente nuevo</label>
        <input value={clienteNuevo} placeholder="Nombre del cliente" onChange={(e) => { setClienteNuevo(e.target.value); if (e.target.value) setClienteSel('') }} />
        <div style={{ height: 14 }} />
        <button className="btn" onClick={confirmarCredito}>Registrar fiado</button>
      </Sheet>

      {node}
    </>
  )
}
