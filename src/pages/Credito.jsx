import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'

export default function Credito() {
  const navigate = useNavigate()
  const { show, node } = useToast()

  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])
  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const abonos = useLiveQuery(() => db.abonos.toArray(), [], [])

  const ventasCred = (ventas || []).filter((v) => v.metodoPago === 'credito' && !v.anulada)

  function saldoDe(id) {
    const debe = ventasCred.filter((v) => v.clienteId === id).reduce((s, v) => s + v.total, 0)
    const pagado = (abonos || []).filter((a) => a.clienteId === id).reduce((s, a) => s + a.monto, 0)
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
    ...(abonos || []).filter((a) => a.clienteId === det.id).map((a) => ({
      fecha: a.fecha, concepto: 'Abono', monto: -a.monto,
    })),
  ].sort((a, b) => b.fecha - a.fecha) : []

  async function registrarAbono() {
    if (abono <= 0) return show('Escribe el valor del abono')
    const now = Date.now()
    await db.abonos.add(stamp({ id: uid(), clienteId: det.id, clienteNombre: det.nombre, monto: abono, fecha: now, mes: monthKey(now) }))
    setAbono(0)
    show('Abono registrado')
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
            <button className="btn ghost" style={{ marginBottom: 6 }} onClick={() => editarCliente(det)}>Editar datos del cliente</button>

            <div className="section-title">Registrar abono</div>
            <div className="btn-row">
              <MoneyInput value={abono} onChange={setAbono} placeholder="Valor del abono" />
              <button className="btn" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={registrarAbono}>Abonar</button>
            </div>

            <div className="section-title">Movimientos</div>
            {movimientos.length === 0 && <div className="empty">Sin movimientos.</div>}
            <table className="tabla">
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i}>
                    <td className="muted-cell">{shortDate(m.fecha)}</td>
                    <td>{m.concepto}</td>
                    <td className="num" style={{ fontWeight: 700, color: m.monto < 0 ? 'var(--green)' : 'var(--text)' }}>
                      {m.monto < 0 ? money(m.monto) : money(m.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Sheet>

      {node}
    </>
  )
}
