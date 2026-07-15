import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { facturarItems, folio } from '../ventas'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import { useAuth } from '../auth'

export default function Credito() {
  const navigate = useNavigate()
  const { show, node } = useToast()
  const { user } = useAuth()
  const esDueno = user?.rol === 'dueño' // solo el administrador edita/elimina fiados

  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])
  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const abonos = useLiveQuery(() => db.abonos.toArray(), [], [])
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])

  const ventasCred = (ventas || []).filter((v) => v.metodoPago === 'credito' && !v.anulada)

  function saldoDe(id) {
    const debe = ventasCred.filter((v) => v.clienteId === id).reduce((s, v) => s + v.total, 0)
    const pagado = (abonos || []).filter((a) => a.clienteId === id && !a.anulada).reduce((s, a) => s + a.monto, 0)
    return debe - pagado
  }

  const lista = (clientes || [])
    .map((c) => ({ ...c, saldo: saldoDe(c.id) }))
    .sort((a, b) => b.saldo - a.saldo)
  const totalPorCobrar = lista.reduce((s, c) => s + Math.max(0, c.saldo), 0)

  // --- Alta / edición de cliente ---
  const [cliSheet, setCliSheet] = useState(false)
  const [cliEdit, setCliEdit] = useState(null)
  const [cliForm, setCliForm] = useState({ nombre: '', telefono: '' })

  function nuevoCliente() { setCliEdit(null); setCliForm({ nombre: '', telefono: '' }); setCliSheet(true) }
  function editarCliente(c) { setCliEdit(c.id); setCliForm({ nombre: c.nombre, telefono: c.telefono || '' }); setCliSheet(true) }
  async function guardarCliente() {
    if (!cliForm.nombre.trim()) return show('Escribe el nombre')
    const datos = { nombre: cliForm.nombre.trim(), telefono: cliForm.telefono.trim() }
    if (cliEdit) await db.clientes.update(cliEdit, stamp(datos))
    else await db.clientes.add(stamp({ id: uid(), activo: 1, ...datos }))
    setCliSheet(false); show('Cliente guardado')
  }
  // Saldo del cliente que se está editando (para permitir borrarlo solo si no debe)
  const saldoCliEdit = cliEdit ? (lista.find((c) => c.id === cliEdit)?.saldo ?? 0) : 0
  async function eliminarCliente() {
    if (saldoCliEdit > 0) return show('No puedes eliminar un cliente que debe. Primero salda su cuenta.')
    // Borrado suave (activo:0) para que se propague por sync; sus ventas quedan
    // en el historial, solo desaparece de la cartera.
    await db.clientes.update(cliEdit, stamp({ activo: 0 }))
    setCliSheet(false); setDetId(null); show('Cliente eliminado')
  }

  // --- Detalle de cliente + abono ---
  const [detId, setDetId] = useState(null)
  const [abono, setAbono] = useState(0)
  const det = lista.find((c) => c.id === detId)

  function abrirDetalle(c) { setDetId(c.id); setAbono(0) }

  const movimientos = det ? [
    ...ventasCred.filter((v) => v.clienteId === det.id).map((v) => ({
      fecha: v.fecha,
      concepto: v.tipo === 'servicio' ? (v.servicioNombre || 'Servicio') : 'Venta de productos',
      monto: v.total, venta: v,
    })),
    ...(abonos || []).filter((a) => a.clienteId === det.id && !a.anulada).map((a) => ({
      fecha: a.fecha, concepto: 'Abono', monto: -a.monto, abono: a,
    })),
  ].sort((a, b) => b.fecha - a.fecha) : []

  async function registrarAbono() {
    if (abono <= 0) return show('Escribe el valor del abono')
    const now = Date.now()
    await db.abonos.add(stamp({ id: uid(), clienteId: det.id, clienteNombre: det.nombre, monto: abono, fecha: now, mes: monthKey(now) }))
    setAbono(0)
    show('Abono registrado')
  }

  // --- Editar / eliminar un abono ya registrado ---
  const [abonoEdit, setAbonoEdit] = useState(null) // el abono en edición
  const [abonoMonto, setAbonoMonto] = useState(0)
  function abrirAbono(a) { setAbonoEdit(a); setAbonoMonto(a.monto) }
  async function guardarAbono() {
    if (abonoMonto <= 0) return show('El abono debe ser mayor a 0')
    await db.abonos.update(abonoEdit.id, stamp({ monto: abonoMonto }))
    setAbonoEdit(null); show('Abono actualizado')
  }
  async function eliminarAbono() {
    await db.abonos.update(abonoEdit.id, stamp({ anulada: 1 }))
    setAbonoEdit(null); show('Abono eliminado')
  }

  // --- Editar / eliminar una venta a crédito (fiado) — solo administrador ---
  const [ventaEdit, setVentaEdit] = useState(null)
  const [ventaMonto, setVentaMonto] = useState(0)
  function abrirVenta(v) { setVentaEdit(v); setVentaMonto(v.total || 0) }

  async function guardarVenta() {
    if (ventaMonto <= 0) return show('El valor debe ser mayor a 0')
    const v = ventaEdit
    // Al cambiar el valor del fiado hay que recomponer la ganancia:
    //  - servicio: la comisión se recalcula sobre el nuevo neto (su % no cambia).
    //  - producto: el costo de lo vendido no cambia; la ganancia sí.
    const patch = { total: ventaMonto }
    if (v.tipo === 'servicio') {
      const comision = Math.round(ventaMonto * ((v.comisionPct || 0) / 100))
      patch.comision = comision; patch.costo = comision; patch.ganancia = ventaMonto - comision
    } else {
      patch.ganancia = ventaMonto - (v.costo || 0)
    }
    await db.ventas.update(v.id, stamp(patch))
    setVentaEdit(null); show('Fiado actualizado')
  }

  async function eliminarVenta() {
    const v = ventaEdit
    // Transaccional e idempotente (igual que eliminar factura en Historial):
    // si ya estaba anulada, NO se vuelve a devolver el stock.
    await db.transaction('rw', db.ventas, db.productos, async () => {
      const fresh = await db.ventas.get(v.id)
      if (!fresh || fresh.anulada) return
      await db.ventas.update(v.id, stamp({ anulada: 1 }))
      if (v.tipo === 'producto') {
        for (const it of v.items || []) {
          const p = await db.productos.get(it.productoId)
          if (p) await db.productos.update(p.id, stamp({ stock: (p.stock || 0) + it.cantidad }))
        }
      }
    })
    setVentaEdit(null); show('Fiado eliminado')
  }

  // --- Fiar productos de inventario al cliente (descuenta stock al cargar) ---
  const [prodSheet, setProdSheet] = useState(false)
  const [carrito, setCarrito] = useState({}) // { [productoId]: cantidad }
  const [filtro, setFiltro] = useState('')
  const [cargando, setCargando] = useState(false)

  function abrirProductos() { setCarrito({}); setFiltro(''); setProdSheet(true) }

  function cambiarCant(p, delta) {
    setCarrito((c) => {
      const next = Math.max(0, Math.min(p.stock || 0, (c[p.id] || 0) + delta))
      const copia = { ...c }
      if (next === 0) delete copia[p.id]; else copia[p.id] = next
      return copia
    })
  }

  const productosFiltrados = (productos || [])
    .slice()
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    .filter((p) => !filtro.trim() || (p.nombre || '').toLowerCase().includes(filtro.trim().toLowerCase()))

  const itemsCarrito = Object.entries(carrito)
    .map(([id, cant]) => { const p = (productos || []).find((x) => x.id === id); return p ? { p, cant } : null })
    .filter(Boolean)
  const totalCarrito = itemsCarrito.reduce((s, { p, cant }) => s + (p.precioVenta || 0) * cant, 0)

  async function cargarAlFiado() {
    if (!det) return
    if (itemsCarrito.length === 0) return show('Agrega al menos un producto')
    setCargando(true)
    try {
      const items = itemsCarrito.map(({ p, cant }) => ({
        tipo: 'producto', refId: p.id, nombre: p.nombre,
        precioVenta: p.precioVenta, precioCompra: p.precioCompra || 0, cantidad: cant,
      }))
      await facturarItems({ items, metodo: 'credito', cliente: { id: det.id, nombre: det.nombre }, origen: 'Crédito' })
      setProdSheet(false); setCarrito({})
      show('Cargado al fiado y descontado del inventario')
    } catch (e) {
      show('No se pudo cargar: ' + (e?.message || 'error'))
    } finally {
      setCargando(false)
    }
  }

  return (
    <>
      <Header title="Crédito" sub="Cartera: fiado y abonos de clientes" onBack={() => navigate('/')} />
      <div className="content">
        <div className="dato-fuerte">Total por cobrar: <b style={{ color: 'var(--red)' }}>{money(totalPorCobrar)}</b></div>

        <div className="section-title">Clientes</div>
        {lista.length === 0 && <div className="empty">Sin clientes. Toca + para agregar uno.</div>}
        {lista.map((c) => (
          <div className="row" key={c.id} onClick={() => abrirDetalle(c)}>
            <div className="main">
              <div className="title">{c.nombre}</div>
              <div className="meta">{c.telefono || 'Sin teléfono'}</div>
            </div>
            <div className="right">
              <div style={{ fontWeight: 700, color: c.saldo > 0 ? 'var(--red)' : 'var(--green)' }}>{money(c.saldo)}</div>
              <div className="meta">{c.saldo > 0 ? 'debe' : 'al día'}</div>
            </div>
          </div>
        ))}
      </div>

      <button className="fab" onClick={nuevoCliente} aria-label="Nuevo cliente">+</button>

      {/* Alta/edición de cliente */}
      <Sheet open={cliSheet} onClose={() => setCliSheet(false)} title={cliEdit ? 'Editar cliente' : 'Nuevo cliente'}>
        <label>Nombre</label>
        <input value={cliForm.nombre} placeholder="Nombre del cliente" onChange={(e) => setCliForm({ ...cliForm, nombre: e.target.value })} />
        <label>Teléfono — opcional</label>
        <input inputMode="tel" value={cliForm.telefono} onChange={(e) => setCliForm({ ...cliForm, telefono: e.target.value })} />
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarCliente}>{cliEdit ? 'Guardar' : 'Agregar cliente'}</button>
        {cliEdit && esDueno && (
          <>
            <div style={{ height: 10 }} />
            <button className="btn danger" onClick={eliminarCliente} disabled={saldoCliEdit > 0}>Eliminar cliente</button>
            <div className="helper" style={{ marginTop: 6 }}>
              {saldoCliEdit > 0
                ? `No se puede eliminar: debe ${money(saldoCliEdit)}. Primero salda su cuenta.`
                : 'Se quita de la cartera. Sus ventas quedan en el historial.'}
            </div>
          </>
        )}
      </Sheet>

      {/* Detalle del cliente */}
      <Sheet open={!!det} onClose={() => setDetId(null)} title={det ? det.nombre : ''}>
        {det && (
          <>
            <div className="dato-fuerte">Saldo: <b style={{ color: det.saldo > 0 ? 'var(--red)' : 'var(--green)' }}>{money(det.saldo)}</b></div>
            <button className="btn" style={{ marginBottom: 6 }} onClick={abrirProductos}>Agregar productos al fiado</button>
            <button className="btn ghost" style={{ marginBottom: 6 }} onClick={() => editarCliente(det)}>Editar datos del cliente</button>

            <div className="section-title">Registrar abono</div>
            <div className="btn-row">
              <MoneyInput value={abono} onChange={setAbono} placeholder="Valor del abono" />
              <button className="btn" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={registrarAbono}>Abonar</button>
            </div>

            <div className="section-title">Movimientos</div>
            <div className="helper" style={{ marginBottom: 6 }}>
              {esDueno ? 'Toca un abono o un fiado para editarlo o eliminarlo.' : 'Toca un abono para editarlo o eliminarlo.'}
            </div>
            {movimientos.length === 0 && <div className="empty">Sin movimientos.</div>}
            <table className="tabla">
              <tbody>
                {movimientos.map((m, i) => {
                  // El abono lo edita cualquiera; el fiado (venta a crédito) solo el administrador.
                  const onTap = m.abono ? () => abrirAbono(m.abono) : (esDueno && m.venta ? () => abrirVenta(m.venta) : undefined)
                  return (
                  <tr key={i} onClick={onTap} style={onTap ? { cursor: 'pointer' } : undefined}>
                    <td className="muted-cell">{shortDate(m.fecha)}</td>
                    <td>{m.concepto}{onTap ? ' · editar' : ''}</td>
                    <td className="num" style={{ fontWeight: 700, color: m.monto < 0 ? 'var(--green)' : 'var(--text)' }}>
                      {money(m.monto)}
                    </td>
                  </tr>
                  )})}
              </tbody>
            </table>
          </>
        )}
      </Sheet>

      {/* Fiar productos de inventario */}
      <Sheet open={prodSheet} onClose={() => setProdSheet(false)} title={det ? `Fiar productos a ${det.nombre}` : 'Fiar productos'}>
        <input placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <div className="helper" style={{ margin: '4px 0 10px' }}>Se descuentan del inventario apenas los cargues al fiado.</div>
        {productosFiltrados.length === 0 && <div className="empty">Sin productos en inventario.</div>}
        {productosFiltrados.map((p) => {
          const cant = carrito[p.id] || 0
          const sin = (p.stock || 0) <= 0
          return (
            <div className="row" key={p.id}>
              <div className="main">
                <div className="title">{p.nombre}</div>
                <div className="meta">{money(p.precioVenta)} · {sin ? 'sin stock' : `${p.stock} en stock`}</div>
              </div>
              <div className="right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn ghost" style={{ width: 40, padding: 6 }} disabled={cant === 0} onClick={() => cambiarCant(p, -1)}>−</button>
                <b style={{ minWidth: 18, textAlign: 'center' }}>{cant}</b>
                <button className="btn ghost" style={{ width: 40, padding: 6 }} disabled={sin || cant >= (p.stock || 0)} onClick={() => cambiarCant(p, 1)}>+</button>
              </div>
            </div>
          )
        })}
        <div style={{ height: 12 }} />
        <div className="dato-fuerte">Total a fiar: <b>{money(totalCarrito)}</b></div>
        <button className="btn" disabled={cargando || totalCarrito <= 0} onClick={cargarAlFiado}>
          {cargando ? 'Cargando…' : 'Cargar al fiado'}
        </button>
      </Sheet>

      {/* Editar / eliminar una venta a crédito (fiado) — solo administrador */}
      <Sheet open={!!ventaEdit} onClose={() => setVentaEdit(null)} title="Editar fiado">
        {ventaEdit && (
          <>
            <div className="helper" style={{ marginBottom: 8 }}>
              {ventaEdit.tipo === 'servicio' ? (ventaEdit.servicioNombre || 'Servicio') : 'Venta de productos'} · {shortDate(ventaEdit.fecha)}
              {ventaEdit.factura ? ` · ${folio(ventaEdit.factura)}` : ''}
            </div>
            {ventaEdit.tipo === 'producto' && (ventaEdit.items || []).length > 0 && (
              <div className="helper" style={{ marginBottom: 8 }}>
                {(ventaEdit.items || []).map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')}
              </div>
            )}
            <label>Valor de la deuda</label>
            <MoneyInput value={ventaMonto} onChange={setVentaMonto} />
            <div className="helper">Cambiar el valor ajusta el saldo del cliente{ventaEdit.tipo === 'servicio' ? ' y recalcula la comisión del lavador' : ''}.</div>
            <div style={{ height: 14 }} />
            <button className="btn" onClick={guardarVenta}>Guardar</button>
            <div style={{ height: 10 }} />
            <button className="btn danger" onClick={eliminarVenta}>Eliminar fiado</button>
            <div className="helper" style={{ marginTop: 6 }}>
              Al eliminarlo se borra la deuda{ventaEdit.tipo === 'producto' ? ' y los productos vuelven al inventario' : ''}.
            </div>
          </>
        )}
      </Sheet>

      {/* Editar / eliminar un abono */}
      <Sheet open={!!abonoEdit} onClose={() => setAbonoEdit(null)} title="Editar abono">
        {abonoEdit && (
          <>
            <div className="helper" style={{ marginBottom: 8 }}>Abono del {shortDate(abonoEdit.fecha)}</div>
            <label>Valor del abono</label>
            <MoneyInput value={abonoMonto} onChange={setAbonoMonto} placeholder="Valor del abono" />
            <div style={{ height: 14 }} />
            <button className="btn" onClick={guardarAbono}>Guardar</button>
            <div style={{ height: 10 }} />
            <button className="btn danger" onClick={eliminarAbono}>Eliminar abono</button>
          </>
        )}
      </Sheet>

      {node}
    </>
  )
}
