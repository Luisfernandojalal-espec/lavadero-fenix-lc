import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, precioServicio, TIPOS_VEHICULO, labelTipoVeh } from '../db'
import { money } from '../format'
import { Header, Sheet, useToast, SearchSelect, MoneyInput } from '../components/ui'
import { ItemsGrid, lineaDesde } from '../components/ItemsGrid'
import { AgregarAdicional, lineaAdicional } from '../components/Adicional'
import { facturarItems, gananciaDe, totalDe, totalLinea, compartirRecibo, folio, labelMedio, asignarComision } from '../ventas'
import { useAuth } from '../auth'

export default function Caja() {
  const { show, node } = useToast()
  const { user } = useAuth()

  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])

  const esDueno = user?.rol === 'dueño'

  // Tipo de vehículo del ticket: define el precio de los servicios.
  const [tipoVehiculo, setTipoVehiculo] = useState('automovil')
  // Carrito mixto: { [key]: linea } — la cantidad se refleja en cada tarjeta.
  const [carrito, setCarrito] = useState({})
  // Línea de servicio a la que se le está asignando lavador
  const [asignando, setAsignando] = useState(null)
  // Línea de servicio que se está ajustando (precio/descuento/observación)
  const [editKey, setEditKey] = useState(null)
  const [editForm, setEditForm] = useState({ precioVenta: 0, descuento: 0, observacion: '' })

  // Cambiar el tipo de vehículo re-precia los servicios del carrito y quita
  // los que no aplican al nuevo tipo.
  function cambiarTipo(tv) {
    setTipoVehiculo(tv)
    setCarrito((c) => {
      const next = {}
      for (const [k, l] of Object.entries(c)) {
        if (l.tipo !== 'servicio') { next[k] = l; continue }
        // Los adicionales libres no dependen del tipo de vehículo: se conservan.
        if (l.esAdicional) { next[k] = l; continue }
        const serv = (servicios || []).find((s) => s.id === l.refId)
        const precio = serv ? precioServicio(serv, tv) : 0
        if (precio > 0) next[k] = { ...l, precioVenta: precio, precioBase: precio, tipoVehiculo: tv, descuento: 0 }
      }
      return next
    })
  }

  // Adicional libre: cobro extra con descripción. Si vende un lavador, se le
  // asigna a él (su comisión); si no, queda sin lavador (asignable a mano).
  function addAdicional({ nombre, monto }) {
    let linea = lineaAdicional({ nombre, monto })
    if (user && user.rol === 'trabajador') {
      const yo = (trabajadores || []).find((x) => x.id === user.id)
      linea = asignarComision(linea, yo || { id: user.id, nombre: user.nombre })
    }
    setCarrito((c) => ({ ...c, [linea.key]: linea }))
  }

  function abrirEditarLinea(l) {
    setEditKey(l.key)
    setEditForm({ precioVenta: l.precioVenta, descuento: l.descuento || 0, observacion: l.observacion || '' })
  }
  function guardarLinea() {
    setCarrito((c) => {
      const l = c[editKey]
      if (!l) return c
      const precioVenta = esDueno ? Math.max(0, editForm.precioVenta || 0) : l.precioVenta
      const descuento = esDueno ? Math.max(0, Math.min(editForm.descuento || 0, precioVenta * l.cantidad)) : (l.descuento || 0)
      return { ...c, [editKey]: { ...l, precioVenta, descuento, observacion: editForm.observacion } }
    })
    setEditKey(null)
  }

  // Cobro a crédito
  const [creditoOpen, setCreditoOpen] = useState(false)
  const [clienteSel, setClienteSel] = useState('')
  const [clienteNuevo, setClienteNuevo] = useState('')
  const [clienteTel, setClienteTel] = useState('')
  // Pago mixto (efectivo + transferencia)
  const [mixtoOpen, setMixtoOpen] = useState(false)
  const [mixtoEfectivo, setMixtoEfectivo] = useState(0)
  // Recibo de la última venta (para compartir)
  const [recibo, setRecibo] = useState(null)

  function add(it) {
    setCarrito((c) => {
      const prev = c[it.key]
      if (prev) return { ...c, [it.key]: { ...prev, cantidad: prev.cantidad + 1 } }
      let linea = lineaDesde(it)
      // Si vende un lavador (rol trabajador), sus servicios quedan asignados a él
      // por defecto (con su % propio de comisión, si lo tiene). El cajero y el
      // dueño no son lavadores: eligen a quién asignar a mano.
      if (linea.tipo === 'servicio' && user && user.rol === 'trabajador') {
        const yo = (trabajadores || []).find((x) => x.id === user.id)
        linea = asignarComision(linea, yo || { id: user.id, nombre: user.nombre })
      }
      return { ...c, [it.key]: linea }
    })
  }

  function asignarLavador(key, t) {
    setCarrito((c) => ({ ...c, [key]: asignarComision(c[key], t) }))
    setAsignando(null)
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

  async function cobrar(metodo, cliente = null, pago = null) {
    if (lineas.length === 0) return
    const { factura } = await facturarItems({ items: lineas, metodo, cliente, pago })
    setRecibo({ factura, fecha: Date.now(), items: lineas, total, metodo, cliente: cliente?.nombre, pago })
    setCarrito({}); setMixtoOpen(false); setMixtoEfectivo(0)
  }

  async function compartir() {
    const r = await compartirRecibo(recibo)
    show(r === 'compartido' ? 'Recibo compartido' : r === 'copiado' ? 'Recibo copiado al portapapeles' : 'No se pudo compartir')
  }

  async function confirmarCredito() {
    let cliente = null
    if (clienteNuevo.trim()) {
      cliente = { id: uid(), nombre: clienteNuevo.trim() }
      await db.clientes.add(stamp({ id: cliente.id, activo: 1, nombre: cliente.nombre, telefono: clienteTel.trim() }))
    } else {
      cliente = (clientes || []).find((c) => c.id === clienteSel)
    }
    if (!cliente) return show('Elige o crea un cliente')
    setCreditoOpen(false); setClienteSel(''); setClienteNuevo(''); setClienteTel('')
    await cobrar('credito', cliente)
  }

  return (
    <>
      <Header title="Factura rápida" sub="Servicios y productos en un solo paso" />

      <div className="content">
        <div className="section-title" style={{ marginTop: 0 }}>Tipo de vehículo</div>
        <div className="pill-row">
          {TIPOS_VEHICULO.map((t) => (
            <button key={t.id} className={`pill ${tipoVehiculo === t.id ? 'active' : ''}`}
              onClick={() => cambiarTipo(t.id)}>{t.label}</button>
          ))}
        </div>

        {lineas.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 0 }}>Cuenta</div>
            <table className="tabla">
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.key}>
                    <td>
                      {l.nombre} <span className="muted-cell">{money(l.precioVenta)} c/u</span>
                      {l.tipo === 'servicio' && (
                        <>
                          <div className="muted-cell">
                            {l.esAdicional ? 'Adicional' : labelTipoVeh(l.tipoVehiculo)}
                            {l.descuento ? ` · desc. ${money(l.descuento)}` : ''}
                          </div>
                          {l.observacion ? <div className="muted-cell">Obs: {l.observacion}</div> : null}
                          <div>
                            <button className="chip-lavador" onClick={() => setAsignando(l.key)}>
                              {l.trabajadorNombre ? `Lavador: ${l.trabajadorNombre}` : 'Asignar lavador'}
                            </button>
                            <button className="chip-lavador" onClick={() => abrirEditarLinea(l)}>Editar</button>
                          </div>
                        </>
                      )}
                      <div className="line-step">
                        <button onClick={() => sub(l)} aria-label="Quitar uno">−</button>
                        <b>{l.cantidad}</b>
                        <button onClick={() => add(l)} aria-label="Agregar uno">+</button>
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(totalLinea(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

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

            {lineas.some((l) => l.tipo === 'servicio' && !l.trabajadorId) && (
              <div className="helper" style={{ color: 'var(--amber)', marginBottom: 8 }}>
                Hay servicios sin lavador asignado: esas comisiones no se le acumularán a nadie.
              </div>
            )}

            <div className="btn-row">
              <button className="btn" onClick={() => cobrar('efectivo')}>Efectivo · {money(total)}</button>
              <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => cobrar('transferencia')}>Transferencia</button>
              <button className="btn ghost" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => { setMixtoEfectivo(0); setMixtoOpen(true) }}>Mixto</button>
              <button className="btn ghost" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setCreditoOpen(true)}>Crédito</button>
            </div>
          </>
        )}

        <div className="section-title">Agregar a la cuenta</div>
        <ItemsGrid servicios={servicios} productos={productos} carrito={carrito} onAdd={add} onSub={sub} tipoVehiculo={tipoVehiculo} />
        <AgregarAdicional onAgregar={addAdicional} />
      </div>

      <Sheet open={creditoOpen} onClose={() => setCreditoOpen(false)} title="Cobrar a crédito (fiado)">
        <label>Cliente</label>
        <SearchSelect value={clienteSel} onChange={(v) => { setClienteSel(v); setClienteNuevo('') }}
          options={(clientes || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((c) => ({ value: c.id, label: c.nombre }))}
          placeholder="Buscar cliente…" />
        <div className="helper" style={{ margin: '8px 0' }}>o registra uno nuevo:</div>
        <label>Cliente nuevo</label>
        <input value={clienteNuevo} placeholder="Nombre del cliente"
          onChange={(e) => { setClienteNuevo(e.target.value); if (e.target.value) setClienteSel('') }} />
        <label>Teléfono (opcional)</label>
        <input inputMode="tel" value={clienteTel} placeholder="Ej: 300 123 4567"
          onChange={(e) => setClienteTel(e.target.value)} />
        <div style={{ height: 14 }} />
        <button className="btn" onClick={confirmarCredito}>Registrar fiado</button>
      </Sheet>

      {/* Pago mixto: parte en efectivo y parte en transferencia */}
      <Sheet open={mixtoOpen} onClose={() => setMixtoOpen(false)} title="Pago mixto">
        <div className="dato-fuerte">Total a cobrar: <b>{money(total)}</b></div>
        <label>¿Cuánto pagan en efectivo?</label>
        <MoneyInput value={mixtoEfectivo} onChange={setMixtoEfectivo} />
        <div className="helper" style={{ marginTop: 6 }}>
          Va a transferencia: <b>{money(Math.max(0, total - Math.min(mixtoEfectivo, total)))}</b>
        </div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={() => {
          const ef = Math.max(0, Math.min(mixtoEfectivo, total))
          cobrar('mixto', null, { efectivo: ef, transferencia: total - ef })
        }}>Cobrar mixto · {money(total)}</button>
      </Sheet>

      {/* Asignar lavador a una línea de servicio */}
      <Sheet open={!!asignando} onClose={() => setAsignando(null)} title="¿Quién hace este servicio?">
        <div className="pill-row">
          {(trabajadores || []).filter((t) => t.rol !== 'cajero').map((t) => (
            <button key={t.id} className="pill" onClick={() => asignarLavador(asignando, t)}>{t.nombre}</button>
          ))}
          <button className="pill" onClick={() => asignarLavador(asignando, null)}>Sin asignar</button>
        </div>
        <div className="helper">La comisión de esta lavada se le acumula al lavador elegido.</div>
      </Sheet>

      {/* Ajustar línea de servicio: precio (autorizados), descuento y observación */}
      <Sheet open={!!editKey} onClose={() => setEditKey(null)} title="Ajustar servicio">
        {esDueno ? (
          <>
            <label>Precio unitario</label>
            <MoneyInput value={editForm.precioVenta} onChange={(v) => setEditForm({ ...editForm, precioVenta: v })} />
            <label>Descuento (total de la línea)</label>
            <MoneyInput value={editForm.descuento} onChange={(v) => setEditForm({ ...editForm, descuento: v })} />
          </>
        ) : (
          <div className="helper" style={{ marginBottom: 8 }}>
            Solo un administrador puede cambiar el precio o aplicar descuentos.
          </div>
        )}
        <label>Observación del servicio (opcional)</label>
        <input value={editForm.observacion} placeholder="Ej: rayón en la puerta, entregar 5pm"
          onChange={(e) => setEditForm({ ...editForm, observacion: e.target.value })} />
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarLinea}>Guardar</button>
      </Sheet>

      {/* Recibo de la venta registrada */}
      <Sheet open={!!recibo} onClose={() => setRecibo(null)} title="Venta registrada">
        {recibo && (
          <>
            <div className="dato-fuerte">
              {folio(recibo.factura)} · <b>{money(recibo.total)}</b>
            </div>
            <div className="helper" style={{ marginBottom: 10 }}>
              Pago: {labelMedio(recibo.metodo)}
              {recibo.metodo === 'mixto' && recibo.pago ? ` (efectivo ${money(recibo.pago.efectivo)} · transferencia ${money(recibo.pago.transferencia)})` : ''}
              {recibo.cliente ? ` · Cliente: ${recibo.cliente}` : ''}
            </div>
            <table className="tabla">
              <tbody>
                {recibo.items.map((l) => (
                  <tr key={l.key}>
                    <td>{l.nombre}</td>
                    <td className="num muted-cell">{l.cantidad} × {money(l.precioVenta)}</td>
                    <td className="num">{money(totalLinea(l))}</td>
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
