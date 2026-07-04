import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { money } from '../format'
import { Header, Sheet, useToast, SearchSelect } from '../components/ui'
import { ItemsGrid, lineaDesde } from '../components/ItemsGrid'
import { facturarItems, gananciaDe, totalDe, compartirRecibo, folio, labelMedio } from '../ventas'
import { useAuth } from '../auth'

export default function Caja() {
  const { show, node } = useToast()
  const { user } = useAuth()

  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])

  // Carrito mixto: { [key]: linea } — la cantidad se refleja en cada tarjeta.
  const [carrito, setCarrito] = useState({})
  // Trabajador que hizo los servicios (si la sesión es de un trabajador, él mismo)
  const [trabSel, setTrabSel] = useState(user && user.rol !== 'dueño' ? user.id : null)

  // Cobro a crédito
  const [creditoOpen, setCreditoOpen] = useState(false)
  const [clienteSel, setClienteSel] = useState('')
  const [clienteNuevo, setClienteNuevo] = useState('')
  // Recibo de la última venta (para compartir)
  const [recibo, setRecibo] = useState(null)

  function add(it) {
    setCarrito((c) => {
      const prev = c[it.key]
      return { ...c, [it.key]: prev ? { ...prev, cantidad: prev.cantidad + 1 } : lineaDesde(it) }
    })
  }
  function sub(it) {
    setCarrito((c) => {
      const prev = c[it.key]
      if (!prev) return c
      const copy = { ...c }
      if (prev.cantidad <= 1) delete copy[it.key]
      else copy[it.key] = { ...prev, cantidad: prev.cantidad - 1 }
      return copy
    })
  }

  const lineas = Object.values(carrito)
  const total = totalDe(lineas)
  const ganancia = gananciaDe(lineas)
  const hayServicios = lineas.some((l) => l.tipo === 'servicio')

  async function cobrar(metodo, cliente = null) {
    if (lineas.length === 0) return
    const t = (trabajadores || []).find((x) => x.id === trabSel) || null
    const { factura } = await facturarItems({ items: lineas, trabajador: t, metodo, cliente })
    setRecibo({ factura, fecha: Date.now(), items: lineas, total, metodo, cliente: cliente?.nombre })
    setCarrito({})
  }

  async function compartir() {
    const r = await compartirRecibo(recibo)
    show(r === 'compartido' ? 'Recibo compartido' : r === 'copiado' ? 'Recibo copiado al portapapeles' : 'No se pudo compartir')
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
    setCreditoOpen(false); setClienteSel(''); setClienteNuevo('')
    await cobrar('credito', cliente)
  }

  return (
    <>
      <Header title="Factura rápida" sub="Servicios y productos en un solo paso" />

      <div className="content">
        <ItemsGrid servicios={servicios} productos={productos} carrito={carrito} onAdd={add} onSub={sub} />

        {lineas.length > 0 && (
          <>
            <div className="section-title">Cuenta</div>
            <table className="tabla">
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.key}>
                    <td>{l.nombre}{l.tipo === 'servicio' ? <span className="muted-cell"> · Servicio</span> : null}</td>
                    <td className="num muted-cell">{l.cantidad} × {money(l.precioVenta)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(l.precioVenta * l.cantidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {hayServicios && (
              <>
                <div className="section-title">¿Quién hizo el servicio?</div>
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
              </>
            )}

            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="meta">Total</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{money(total)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="meta">Ganancia</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>+{money(ganancia)}</div>
              </div>
            </div>

            <div className="btn-row">
              <button className="btn" onClick={() => cobrar('efectivo')}>Efectivo · {money(total)}</button>
              <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => cobrar('transferencia')}>Transferencia</button>
              <button className="btn ghost" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setCreditoOpen(true)}>Crédito</button>
            </div>
          </>
        )}
      </div>

      <Sheet open={creditoOpen} onClose={() => setCreditoOpen(false)} title="Cobrar a crédito (fiado)">
        <label>Cliente</label>
        <SearchSelect value={clienteSel} onChange={(v) => { setClienteSel(v); setClienteNuevo('') }}
          options={(clientes || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((c) => ({ value: c.id, label: c.nombre }))}
          placeholder="Buscar cliente…" />
        <div className="helper" style={{ margin: '8px 0' }}>o crea uno nuevo:</div>
        <label>Cliente nuevo</label>
        <input value={clienteNuevo} placeholder="Nombre del cliente"
          onChange={(e) => { setClienteNuevo(e.target.value); if (e.target.value) setClienteSel('') }} />
        <div style={{ height: 14 }} />
        <button className="btn" onClick={confirmarCredito}>Registrar fiado</button>
      </Sheet>

      {/* Recibo de la venta registrada */}
      <Sheet open={!!recibo} onClose={() => setRecibo(null)} title="Venta registrada">
        {recibo && (
          <>
            <div className="dato-fuerte">
              {folio(recibo.factura)} · <b>{money(recibo.total)}</b>
            </div>
            <div className="helper" style={{ marginBottom: 10 }}>
              Pago: {labelMedio(recibo.metodo)}{recibo.cliente ? ` · Cliente: ${recibo.cliente}` : ''}
            </div>
            <table className="tabla">
              <tbody>
                {recibo.items.map((l) => (
                  <tr key={l.key}>
                    <td>{l.nombre}</td>
                    <td className="num muted-cell">{l.cantidad} × {money(l.precioVenta)}</td>
                    <td className="num">{money(l.precioVenta * l.cantidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ height: 12 }} />
            <button className="btn" onClick={compartir}>Compartir recibo</button>
            <div style={{ height: 8 }} />
            <button className="btn ghost" onClick={() => setRecibo(null)}>Listo</button>
          </>
        )}
      </Sheet>

      {node}
    </>
  )
}
