import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { facturarItems } from '../ventas'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'

export default function Credito() {
  const navigate = useNavigate()
  const { show, node } = useToast()

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

  // --- Detalle de cliente + abono ---
  const [detId, setDetId] = useState(null)
  const [abono, setAbono] = useState(0)
  const det = lista.find((c) => c.id === detId)

  function abrirDetalle(c) { setDetId(c.id); setAbono(0) }

  const movimientos = det ? [
    ...ventasCred.filter((v) => v.clienteId === det.id).map((v) => ({
      fecha: v.fecha,
      concepto: v.tipo === 'servicio' ? (v.servicioNombre || 'Servicio') : 'Venta de productos',
      monto: v.total,
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
            {movimientos.some((m) => m.abono) && <div className="helper" style={{ marginBottom: 6 }}>Toca un abono para editarlo o eliminarlo.</div>}
            {movimientos.length === 0 && <div className="empty">Sin movimientos.</div>}
            <table className="tabla">
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i} onClick={m.abono ? () => abrirAbono(m.abono) : undefined} style={m.abono ? { cursor: 'pointer' } : undefined}>
                    <td className="muted-cell">{shortDate(m.fecha)}</td>
                    <td>{m.concepto}{m.abono ? ' · editar' : ''}</td>
                    <td className="num" style={{ fontWeight: 700, color: m.monto < 0 ? 'var(--green)' : 'var(--text)' }}>
                      {money(m.monto)}
                    </td>
                  </tr>
                ))}
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
