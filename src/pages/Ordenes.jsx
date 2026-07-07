import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, precioServicio, TIPOS_VEHICULO, labelTipoVeh, ESTADOS_ORDEN, labelEstadoOrden, esLavador } from '../db'
import { money, shortDate, monthKey } from '../format'
import { Header, Sheet, useToast, SearchSelect, MoneyInput } from '../components/ui'
import { ItemsGrid, lineaDesde } from '../components/ItemsGrid'
import { facturarItems, totalDe, totalLinea, labelMedio, asignarComision } from '../ventas'
import { useAuth } from '../auth'

const folioOrden = (n) => 'ORD-' + String(n || 0).padStart(4, '0')
const horaCorta = (ts) => (ts ? new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—')

export default function Ordenes() {
  const { user } = useAuth()
  const { show, node } = useToast()
  const esDueno = user?.rol === 'dueño'

  const ordenes = useLiveQuery(() => db.ordenes.toArray(), [], [])
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])

  const [detId, setDetId] = useState(null)
  const orden = (ordenes || []).find((o) => o.id === detId)
  const [filtro, setFiltro] = useState('activas') // activas | todas | <estado>  (arriba: regla de hooks)

  // --- Crear orden ---
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const emptyOrden = { cliente: '', vehiculo: '', placa: '', tipoVehiculo: 'automovil' }
  const [form, setForm] = useState(emptyOrden)

  function abrirNueva() { setForm(emptyOrden); setNuevaOpen(true) }
  async function crearOrden() {
    const now = Date.now()
    const numero = (ordenes || []).reduce((m, o) => Math.max(m, o.numero || 0), 0) + 1
    const id = uid()
    await db.ordenes.add(stamp({
      id, numero, estado: 'pendiente',
      cliente: form.cliente.trim(), vehiculo: form.vehiculo.trim(),
      placa: form.placa.trim().toUpperCase(), tipoVehiculo: form.tipoVehiculo,
      items: [], observaciones: '', facturado: false, factura: null,
      horaIngreso: now, horaSalida: null, fecha: now, mes: monthKey(now),
    }))
    setNuevaOpen(false); setDetId(id)
    show(`Orden ${folioOrden(numero)} creada`)
  }

  // --- Detalle: items ---
  const carrito = orden ? Object.fromEntries((orden.items || []).map((l) => [l.key, l])) : {}

  async function addItem(it) {
    const items = [...(orden.items || [])]
    const i = items.findIndex((x) => x.key === it.key)
    if (i >= 0) items[i] = { ...items[i], cantidad: items[i].cantidad + 1 }
    else {
      let linea = lineaDesde(it)
      if (linea.tipo === 'servicio' && user && user.rol === 'trabajador') {
        const yo = (trabajadores || []).find((x) => x.id === user.id)
        linea = asignarComision(linea, yo || { id: user.id, nombre: user.nombre })
      }
      items.push(linea)
    }
    // Al agregar el primer consumo, si estaba pendiente pasa a "en proceso".
    const estado = orden.estado === 'pendiente' ? 'proceso' : orden.estado
    await db.ordenes.update(orden.id, stamp({ items, estado }))
  }
  async function subItem(it) {
    const items = [...(orden.items || [])]
    const i = items.findIndex((x) => x.key === it.key)
    if (i < 0) return
    if (items[i].cantidad <= 1) items.splice(i, 1)
    else items[i] = { ...items[i], cantidad: items[i].cantidad - 1 }
    await db.ordenes.update(orden.id, stamp({ items }))
  }

  // Cambiar el tipo de vehículo re-precia los servicios y quita los que no aplican.
  async function cambiarTipo(tv) {
    const items = (orden.items || []).map((l) => {
      if (l.tipo !== 'servicio') return l
      const serv = (servicios || []).find((s) => s.id === l.refId)
      const precio = serv ? precioServicio(serv, tv) : 0
      return precio > 0 ? { ...l, precioVenta: precio, precioBase: precio, tipoVehiculo: tv, descuento: 0 } : null
    }).filter(Boolean)
    await db.ordenes.update(orden.id, stamp({ tipoVehiculo: tv, items }))
  }

  // Asignar lavador a una línea
  const [asignando, setAsignando] = useState(null)
  async function asignarLavador(key, t) {
    const items = (orden.items || []).map((l) => (l.key === key ? asignarComision(l, t) : l))
    await db.ordenes.update(orden.id, stamp({ items }))
    setAsignando(null)
  }

  // Ajustar línea (precio/descuento: dueño; observación: todos)
  const [editKey, setEditKey] = useState(null)
  const [editForm, setEditForm] = useState({ precioVenta: 0, descuento: 0, observacion: '' })
  function abrirEditarLinea(l) {
    setEditKey(l.key)
    setEditForm({ precioVenta: l.precioVenta, descuento: l.descuento || 0, observacion: l.observacion || '' })
  }
  async function guardarLinea() {
    const items = (orden.items || []).map((l) => {
      if (l.key !== editKey) return l
      const precioVenta = esDueno ? Math.max(0, editForm.precioVenta || 0) : l.precioVenta
      const descuento = esDueno ? Math.max(0, Math.min(editForm.descuento || 0, precioVenta * l.cantidad)) : (l.descuento || 0)
      return { ...l, precioVenta, descuento, observacion: editForm.observacion }
    })
    await db.ordenes.update(orden.id, stamp({ items }))
    setEditKey(null)
  }

  async function cambiarEstado(estadoId) {
    const patch = { estado: estadoId }
    if (estadoId === 'entregado' && !orden.horaSalida) patch.horaSalida = Date.now()
    await db.ordenes.update(orden.id, stamp(patch))
  }
  async function guardarObs(txt) {
    await db.ordenes.update(orden.id, stamp({ observaciones: txt }))
  }
  async function eliminarOrden() {
    await db.ordenes.delete(orden.id)
    setDetId(null); show('Orden eliminada')
  }

  // --- Cobro ---
  const [cobroOpen, setCobroOpen] = useState(false)
  const [clienteSel, setClienteSel] = useState('')
  const [clienteNuevo, setClienteNuevo] = useState('')
  async function cobrarOrden(metodo) {
    let cliente = null
    if (metodo === 'credito') {
      if (clienteNuevo.trim()) {
        cliente = { id: uid(), nombre: clienteNuevo.trim() }
        await db.clientes.add(stamp({ id: cliente.id, activo: 1, nombre: cliente.nombre, telefono: '' }))
      } else cliente = (clientes || []).find((c) => c.id === clienteSel)
      if (!cliente) return show('Elige o crea un cliente')
    } else if (orden.cliente) {
      cliente = null // cliente de la orden es solo informativo para contado
    }
    const { total, factura } = await facturarItems({ items: orden.items || [], metodo, cliente, origen: folioOrden(orden.numero) })
    await db.ordenes.update(orden.id, stamp({
      estado: 'entregado', facturado: true, factura, horaSalida: Date.now(),
    }))
    setCobroOpen(false); setClienteSel(''); setClienteNuevo('')
    show(`Orden cobrada · ${money(total)}`)
  }

  // ============ DETALLE ============
  if (orden) {
    const items = orden.items || []
    const total = totalDe(items)
    const sinLavador = items.some((l) => l.tipo === 'servicio' && !l.trabajadorId)

    return (
      <>
        <Header title={folioOrden(orden.numero)} sub={orden.cliente || 'Sin cliente'} />
        <div className="content">
          <button className="btn ghost" style={{ marginBottom: 12 }} onClick={() => setDetId(null)}>‹ Volver a órdenes</button>

          {/* Datos del vehículo */}
          <table className="tabla">
            <tbody>
              <tr><td>Vehículo</td><td className="num">{orden.vehiculo || '—'}</td></tr>
              <tr><td>Placa</td><td className="num" style={{ fontWeight: 700 }}>{orden.placa || '—'}</td></tr>
              <tr><td>Ingreso</td><td className="num">{horaCorta(orden.horaIngreso)}</td></tr>
              <tr><td>Salida</td><td className="num">{horaCorta(orden.horaSalida)}</td></tr>
            </tbody>
          </table>

          {/* Estado */}
          <div className="section-title">Estado</div>
          <div className="pill-row">
            {ESTADOS_ORDEN.map((e) => (
              <button key={e.id} className={`pill ${orden.estado === e.id ? 'active' : ''}`}
                onClick={() => cambiarEstado(e.id)}>{e.label}</button>
            ))}
          </div>

          {/* Tipo de vehículo */}
          <div className="section-title">Tipo de vehículo</div>
          <div className="pill-row">
            {TIPOS_VEHICULO.map((t) => (
              <button key={t.id} className={`pill ${(orden.tipoVehiculo || 'automovil') === t.id ? 'active' : ''}`}
                onClick={() => cambiarTipo(t.id)}>{t.label}</button>
            ))}
          </div>

          {!orden.facturado && (
            <ItemsGrid servicios={servicios} productos={productos} carrito={carrito}
              onAdd={addItem} onSub={subItem} tipoVehiculo={orden.tipoVehiculo || 'automovil'} />
          )}

          <div className="section-title">Servicios de la orden</div>
          {items.length === 0 && <div className="empty">Sin servicios. Agrégalos desde arriba.</div>}
          {items.length > 0 && (
            <table className="tabla">
              <tbody>
                {items.map((l) => (
                  <tr key={l.key}>
                    <td>
                      {l.nombre} <span className="muted-cell">{money(l.precioVenta)} c/u</span>
                      {l.tipo === 'servicio' && (
                        <>
                          {l.descuento ? <div className="muted-cell">Descuento {money(l.descuento)}</div> : null}
                          {l.observacion ? <div className="muted-cell">Obs: {l.observacion}</div> : null}
                          {!orden.facturado && (
                            <div>
                              <button className="chip-lavador" onClick={() => setAsignando(l.key)}>
                                {l.trabajadorNombre ? `Lavador: ${l.trabajadorNombre}` : 'Asignar lavador'}
                              </button>
                              <button className="chip-lavador" onClick={() => abrirEditarLinea(l)}>Editar</button>
                            </div>
                          )}
                          {orden.facturado && l.trabajadorNombre && <div className="muted-cell">Lavador: {l.trabajadorNombre}</div>}
                        </>
                      )}
                      {!orden.facturado && (
                        <div className="line-step">
                          <button onClick={() => subItem(l)} aria-label="Quitar uno">−</button>
                          <b>{l.cantidad}</b>
                          <button onClick={() => addItem(l)} aria-label="Agregar uno">+</button>
                        </div>
                      )}
                      {orden.facturado && <div className="muted-cell">Cantidad: {l.cantidad}</div>}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(totalLinea(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Observaciones */}
          <div className="section-title">Observaciones</div>
          <textarea defaultValue={orden.observaciones || ''} placeholder="Notas de la orden…" rows={2}
            onBlur={(e) => guardarObs(e.target.value)} disabled={orden.facturado}
            style={{ width: '100%', resize: 'vertical' }} />

          {items.length > 0 && (
            <>
              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="meta">Total de la orden</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{money(total)}</div>
              </div>
              {orden.facturado ? (
                <div className="dato-fuerte" style={{ marginTop: 4 }}>
                  Facturada · <b>{'F-' + String(orden.factura || 0).padStart(4, '0')}</b>
                </div>
              ) : (
                <button className="btn" onClick={() => setCobroOpen(true)}>Cobrar {money(total)}</button>
              )}
            </>
          )}

          {!orden.facturado && (
            <>
              <div style={{ height: 10 }} />
              <button className="btn ghost" onClick={eliminarOrden}>Eliminar orden</button>
            </>
          )}
        </div>

        {/* Asignar lavador */}
        <Sheet open={!!asignando} onClose={() => setAsignando(null)} title="¿Quién hace este servicio?">
          <div className="lav-pick">
            {(trabajadores || []).filter(esLavador).map((t) => (
              <button key={t.id} onClick={() => asignarLavador(asignando, t)}>{t.nombre}</button>
            ))}
            <button className="sin" onClick={() => asignarLavador(asignando, null)}>Sin asignar</button>
          </div>
          <div className="helper">La comisión de esta lavada se le acumula al lavador elegido.</div>
        </Sheet>

        {/* Ajustar línea */}
        <Sheet open={!!editKey} onClose={() => setEditKey(null)} title="Ajustar servicio">
          {esDueno ? (
            <>
              <label>Precio unitario</label>
              <MoneyInput value={editForm.precioVenta} onChange={(v) => setEditForm({ ...editForm, precioVenta: v })} />
              <label>Descuento (total de la línea)</label>
              <MoneyInput value={editForm.descuento} onChange={(v) => setEditForm({ ...editForm, descuento: v })} />
            </>
          ) : (
            <div className="helper" style={{ marginBottom: 8 }}>Solo un administrador puede cambiar el precio o aplicar descuentos.</div>
          )}
          <label>Observación del servicio (opcional)</label>
          <input value={editForm.observacion} placeholder="Ej: rayón en la puerta"
            onChange={(e) => setEditForm({ ...editForm, observacion: e.target.value })} />
          <div style={{ height: 14 }} />
          <button className="btn" onClick={guardarLinea}>Guardar</button>
        </Sheet>

        {/* Cobrar */}
        <Sheet open={cobroOpen} onClose={() => setCobroOpen(false)} title={`Cobrar ${folioOrden(orden.numero)} · ${money(total)}`}>
          {sinLavador && (
            <div className="helper" style={{ color: 'var(--amber)', marginBottom: 8 }}>
              Hay servicios sin lavador asignado: esas comisiones no se le acumularán a nadie.
            </div>
          )}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => cobrarOrden('efectivo')}>Efectivo · {money(total)}</button>
            <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => cobrarOrden('transferencia')}>Transferencia</button>
          </div>
          <div className="divider" />
          <div className="section-title" style={{ margin: '0 0 8px' }}>O fiar a un cliente</div>
          <SearchSelect value={clienteSel} onChange={(v) => { setClienteSel(v); setClienteNuevo('') }}
            options={(clientes || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((c) => ({ value: c.id, label: c.nombre }))}
            placeholder="Buscar cliente…" />
          <label>Cliente nuevo</label>
          <input value={clienteNuevo} placeholder="Nombre del cliente"
            onChange={(e) => { setClienteNuevo(e.target.value); if (e.target.value) setClienteSel('') }} />
          <div style={{ height: 12 }} />
          <button className="btn secondary" onClick={() => cobrarOrden('credito')}>Registrar fiado</button>
        </Sheet>

        {node}
      </>
    )
  }

  // ============ LISTA ============
  const lista = (ordenes || []).slice().sort((a, b) => b.numero - a.numero)
  const visibles = lista.filter((o) => {
    if (filtro === 'todas') return true
    if (filtro === 'activas') return o.estado !== 'entregado'
    return o.estado === filtro
  })

  const badge = (estado) => {
    const c = estado === 'entregado' ? 'green' : estado === 'terminado' ? 'blue' : estado === 'proceso' ? 'amber' : ''
    return <span className={`badge ${c}`}>{labelEstadoOrden(estado)}</span>
  }

  return (
    <>
      <Header title="Órdenes de servicio" sub="Control operativo del lavadero" />
      <div className="content">
        <div className="pill-row">
          <button className={`pill ${filtro === 'activas' ? 'active' : ''}`} onClick={() => setFiltro('activas')}>Activas</button>
          {ESTADOS_ORDEN.map((e) => (
            <button key={e.id} className={`pill ${filtro === e.id ? 'active' : ''}`} onClick={() => setFiltro(e.id)}>{e.label}</button>
          ))}
          <button className={`pill ${filtro === 'todas' ? 'active' : ''}`} onClick={() => setFiltro('todas')}>Todas</button>
        </div>

        {visibles.length === 0 && (
          <div className="empty">No hay órdenes {filtro === 'activas' ? 'activas' : ''}.<br />Toca + para crear una.</div>
        )}

        {visibles.map((o) => (
          <div className="row" key={o.id} onClick={() => setDetId(o.id)} style={{ cursor: 'pointer' }}>
            <div className="main">
              <div className="title">{folioOrden(o.numero)} · {o.placa || 'sin placa'}</div>
              <div className="meta">
                {labelTipoVeh(o.tipoVehiculo)}{o.cliente ? ` · ${o.cliente}` : ''} · ingreso {horaCorta(o.horaIngreso)}
              </div>
            </div>
            <div className="right">
              <div style={{ fontWeight: 700 }}>{money(totalDe(o.items || []))}</div>
              {badge(o.estado)}
            </div>
          </div>
        ))}
      </div>

      <button className="fab" onClick={abrirNueva} aria-label="Nueva orden">+</button>

      {/* Crear orden */}
      <Sheet open={nuevaOpen} onClose={() => setNuevaOpen(false)} title="Nueva orden de servicio">
        <label>Cliente (opcional)</label>
        <input value={form.cliente} placeholder="Nombre del cliente"
          onChange={(e) => setForm({ ...form, cliente: e.target.value })} />
        <label>Vehículo (marca / modelo / color)</label>
        <input value={form.vehiculo} placeholder="Ej: Mazda 3 gris"
          onChange={(e) => setForm({ ...form, vehiculo: e.target.value })} />
        <label>Placa</label>
        <input value={form.placa} placeholder="Ej: ABC123" style={{ textTransform: 'uppercase' }}
          onChange={(e) => setForm({ ...form, placa: e.target.value })} />
        <label>Tipo de vehículo</label>
        <div className="pill-row">
          {TIPOS_VEHICULO.map((t) => (
            <button key={t.id} className={`pill ${form.tipoVehiculo === t.id ? 'active' : ''}`}
              onClick={() => setForm({ ...form, tipoVehiculo: t.id })}>{t.label}</button>
          ))}
        </div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={crearOrden}>Crear orden</button>
      </Sheet>

      {node}
    </>
  )
}
