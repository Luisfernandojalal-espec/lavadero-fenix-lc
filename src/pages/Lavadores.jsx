import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, TIPOS_VEHICULO, precioServicio, esLavador } from '../db'
import { money, dayKey, monthKey, shortDate, fechaLarga } from '../format'
import { esEfectivo, facturarItems, totalDe, totalLinea, asignarComision } from '../ventas'
import { ItemsGrid, lineaDesde } from '../components/ItemsGrid'
import { AgregarAdicional, lineaAdicional } from '../components/Adicional'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
import { useAuth } from '../auth'

const iniciales = (nombre) => String(nombre || '')
  .trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·'

// embedded: se muestra dentro de otra página (Inicio), sin Header ni KPIs.
export default function Lavadores({ embedded }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { show, node } = useToast()

  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const pagos = useLiveQuery(() => db.pagos_comision.toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])

  const hoy = dayKey()
  const ventasHoy = (ventas || []).filter((v) => !v.anulada && dayKey(v.fecha) === hoy)
  const ventasServHoy = ventasHoy.filter((v) => v.tipo === 'servicio')
  const ventasServ = (ventas || []).filter((v) => v.tipo === 'servicio' && !v.anulada && v.trabajadorId)

  // KPIs de HOY
  const kServicios = ventasServHoy.reduce((s, v) => s + (v.cantidad || 1), 0)
  const kEfectivo = ventasHoy.filter(esEfectivo).reduce((s, v) => s + v.total, 0)
  const kTransfer = ventasHoy.filter((v) => v.metodoPago === 'transferencia').reduce((s, v) => s + v.total, 0)
  const kTotal = ventasHoy.reduce((s, v) => s + v.total, 0)

  function statsDe(tId) {
    const mias = ventasServHoy.filter((v) => v.trabajadorId === tId)
    const servicios = mias.reduce((s, v) => s + (v.cantidad || 1), 0)
    const total = mias.reduce((s, v) => s + v.total, 0)
    const comisionHoy = mias.reduce((s, v) => s + (v.comision || 0), 0)
    const generado = ventasServ.filter((v) => v.trabajadorId === tId).reduce((s, v) => s + (v.comision || 0), 0)
    const pagado = (pagos || []).filter((p) => p.trabajadorId === tId).reduce((s, p) => s + p.monto, 0)
    return { servicios, total, comisionHoy, pendiente: Math.max(0, generado - pagado) }
  }

  // Productos vendidos en las MISMAS facturas donde el lavador hizo servicios
  // (solo informativo: los productos NO generan comisión).
  function productosDe(filasServicio) {
    const facturas = new Set(filasServicio.map((v) => v.factura).filter((f) => f != null))
    if (facturas.size === 0) return []
    return (ventas || [])
      .filter((v) => v.tipo === 'producto' && !v.anulada && v.factura != null && facturas.has(v.factura))
      .sort((a, b) => b.fecha - a.fecha)
      .flatMap((v) => (v.items || []).map((i, idx) => ({
        key: v.id + ':' + idx, fecha: v.fecha, nombre: i.nombre,
        cantidad: i.cantidad, total: i.precioVenta * i.cantidad,
      })))
  }

  const [detalle, setDetalle] = useState(null)
  const [pagoA, setPagoA] = useState(null)
  const [montoPago, setMontoPago] = useState(0)

  // --- Cobro rápido desde la tarjeta del lavador ---
  const [cobroDe, setCobroDe] = useState(null)     // lavador al que se le factura
  const [tipoVeh, setTipoVeh] = useState('automovil')
  const [carrito, setCarrito] = useState({})
  const [creditoOpen, setCreditoOpen] = useState(false)
  const [clienteSel, setClienteSel] = useState('')
  const [clienteNuevo, setClienteNuevo] = useState('')

  function abrirCobro(t) { setCobroDe(t); setTipoVeh('automovil'); setCarrito({}) }
  function cerrarCobro() { setCobroDe(null); setCarrito({}); setCreditoOpen(false); setClienteSel(''); setClienteNuevo('') }

  function addCobro(it) {
    setCarrito((c) => {
      const prev = c[it.key]
      if (prev) return { ...c, [it.key]: { ...prev, cantidad: prev.cantidad + 1 } }
      let linea = lineaDesde(it)
      // Los servicios quedan asignados automáticamente a este lavador (su comisión).
      if (linea.tipo === 'servicio') linea = asignarComision(linea, cobroDe)
      return { ...c, [it.key]: linea }
    })
  }
  // Adicional libre en el cobro del lavador: se le asigna a él (su comisión).
  function addAdicionalCobro({ nombre, monto }) {
    const linea = asignarComision(lineaAdicional({ nombre, monto }), cobroDe)
    setCarrito((c) => ({ ...c, [linea.key]: linea }))
  }
  function subCobro(it) {
    setCarrito((c) => {
      const prev = c[it.key]
      if (!prev) return c
      const copy = { ...c }
      if (prev.cantidad <= 1) delete copy[it.key]
      else copy[it.key] = { ...prev, cantidad: prev.cantidad - 1 }
      return copy
    })
  }
  function cambiarTipoCobro(tv) {
    setTipoVeh(tv)
    setCarrito((c) => {
      const next = {}
      for (const [k, l] of Object.entries(c)) {
        if (l.tipo !== 'servicio' || l.esAdicional) { next[k] = l; continue }
        const serv = (servicios || []).find((s) => s.id === l.refId)
        const precio = serv ? precioServicio(serv, tv) : 0
        if (precio > 0) next[k] = { ...l, precioVenta: precio, precioBase: precio, tipoVehiculo: tv, descuento: 0 }
      }
      return next
    })
  }

  const lineasCobro = Object.values(carrito)
  const totalCobro = totalDe(lineasCobro)

  async function cobrar(metodo, cliente = null) {
    if (lineasCobro.length === 0) return show('Agrega al menos un servicio o producto')
    await facturarItems({ items: lineasCobro, metodo, cliente })
    show(`Cobrado ${money(totalCobro)} · ${cobroDe.nombre}`)
    cerrarCobro()
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
    await cobrar('credito', cliente)
  }

  function abrirPago(t) { setPagoA(t); setMontoPago(statsDe(t.id).pendiente) }
  async function pagar() {
    if (montoPago <= 0) return show('Escribe el valor a pagar')
    const now = Date.now()
    await db.pagos_comision.add(stamp({
      id: uid(), trabajadorId: pagoA.id, trabajadorNombre: pagoA.nombre,
      monto: montoPago, fecha: now, mes: monthKey(now), pagadoPor: user?.nombre || '',
    }))
    await db.gastos.add(stamp({
      id: uid(), concepto: `Comisiones ${pagoA.nombre}`, categoria: 'comisiones',
      monto: montoPago, tipo: 'variable', medioPago: 'caja', fecha: now, mes: monthKey(now),
    }))
    setPagoA(null); setMontoPago(0); show('Pago de comisiones registrado')
  }

  const lista = (trabajadores || []).filter(esLavador)
    .slice().sort((a, b) => a.nombre.localeCompare(b.nombre))

  const vacio = lista.length === 0 && (
    embedded
      ? <div className="helper">Aún no hay lavadores. Créalos en Admin → Trabajadores.</div>
      : (
        <div className="empty">
          No hay lavadores todavía.
          <div style={{ height: 12 }} />
          <button className="btn" style={{ maxWidth: 320 }} onClick={() => navigate('/config')}>Crear lavadores (Admin)</button>
        </div>
      )
  )

  const tarjetas = (
    <div className="lav-grid">
      {lista.map((t) => {
        const st = statsDe(t.id)
        return (
          <div className="lav-card" key={t.id} role="button" tabIndex={0}
            style={{ cursor: 'pointer' }} onClick={() => abrirCobro(t)}>
            <div className="lav-avatar">{iniciales(t.nombre)}</div>
            <div className="lav-nombre">{t.nombre}</div>
            <div className="lav-serv">{st.servicios} servicio{st.servicios === 1 ? '' : 's'} hoy</div>
            <div className="lav-total">{money(st.total)}</div>
            <div className="lav-meta">Comisión hoy {money(st.comisionHoy)}</div>
            <div className="lav-meta">
              Pendiente <b style={{ color: st.pendiente > 0 ? 'var(--red)' : 'var(--green)' }}>{money(st.pendiente)}</b>
            </div>
            <div className="lav-actions">
              <button className="chip-lavador" onClick={(e) => { e.stopPropagation(); abrirCobro(t) }}>Cobrar</button>
              <button className="chip-lavador" onClick={(e) => { e.stopPropagation(); setDetalle(t) }}>Ver detalle</button>
              {st.pendiente > 0 && <button className="chip-lavador" onClick={(e) => { e.stopPropagation(); abrirPago(t) }}>Pagar</button>}
            </div>
          </div>
        )
      })}
    </div>
  )

  const hojas = (
    <>
      {/* Detalle de lavadas (planilla) */}
      <Sheet open={!!detalle} onClose={() => setDetalle(null)} title={detalle ? `Servicios de ${detalle.nombre} · hoy` : ''}>
        {detalle && (() => {
          const filas = ventasServHoy.filter((v) => v.trabajadorId === detalle.id).sort((a, b) => b.fecha - a.fecha)
          const comHoy = filas.reduce((s, v) => s + (v.comision || 0), 0)
          const prods = productosDe(filas)
          const pendiente = statsDe(detalle.id).pendiente
          return (
            <>
              <div className="helper" style={{ marginBottom: 8 }}>Servicios que hizo hoy. Cada lavada con su comisión.</div>
              {filas.length === 0 && <div className="empty">Hoy no ha hecho servicios.</div>}
              {filas.length > 0 && (
                <table className="tabla compacta">
                  <thead><tr><th>Fecha</th><th>Servicio</th><th className="num">%</th><th className="num">Comisión</th></tr></thead>
                  <tbody>
                    {filas.map((v) => (
                      <tr key={v.id}>
                        <td className="muted-cell" style={{ whiteSpace: 'nowrap' }}>{shortDate(v.fecha)}</td>
                        <td>{(v.cantidad || 1) > 1 ? `${v.cantidad}x ` : ''}{v.servicioNombre}<div className="muted-cell">{money(v.total)}</div></td>
                        <td className="num muted-cell">{v.comisionPct}%</td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(v.comision || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {prods.length > 0 && (
                <>
                  <div className="section-title" style={{ marginTop: 12 }}>Productos de esas cuentas · sin comisión</div>
                  <table className="tabla compacta">
                    <tbody>
                      {prods.map((p) => (
                        <tr key={p.key}>
                          <td className="muted-cell" style={{ whiteSpace: 'nowrap' }}>{shortDate(p.fecha)}</td>
                          <td className="muted-cell">{p.cantidad}x {p.nombre}</td>
                          <td className="num muted-cell">{money(p.total)}</td>
                          <td className="num muted-cell">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="helper">Los productos no generan comisión: no suman al total a pagar.</div>
                </>
              )}
              <div className="dato-fuerte" style={{ marginTop: 10 }}>Comisión de hoy: <b>{money(comHoy)}</b></div>
              {pendiente > 0 && (
                <>
                  <div className="dato-fuerte">Pendiente por pagar: <b style={{ color: 'var(--red)' }}>{money(pendiente)}</b></div>
                  <div className="helper">Incluye lo acumulado sin pagar (puede ser de días anteriores).</div>
                  <div style={{ height: 10 }} />
                  <button className="btn" onClick={() => { const t = detalle; setDetalle(null); abrirPago(t) }}>Pagar comisión</button>
                </>
              )}
            </>
          )
        })()}
      </Sheet>

      {/* Pagar comisión */}
      <Sheet open={!!pagoA} onClose={() => setPagoA(null)} title={pagoA ? `Pagar comisión · ${pagoA.nombre}` : ''}>
        {pagoA && (
          <>
            <div className="dato-fuerte">Pendiente: <b style={{ color: 'var(--red)' }}>{money(statsDe(pagoA.id).pendiente)}</b></div>
            <label>Valor a pagar (puede ser parcial)</label>
            <MoneyInput value={montoPago} onChange={setMontoPago} />
            <div className="helper">Queda registrado como salida de caja y se descuenta del pendiente.</div>
            <div style={{ height: 14 }} />
            <button className="btn" onClick={pagar}>Registrar pago de {money(montoPago)}</button>
          </>
        )}
      </Sheet>

      {/* Cobro rápido desde la tarjeta del lavador */}
      <Sheet open={!!cobroDe} onClose={cerrarCobro} title={cobroDe ? `Cobrar · ${cobroDe.nombre}` : ''}>
        {cobroDe && (
          <>
            <div className="helper" style={{ marginBottom: 6 }}>Los servicios se le asignan a {cobroDe.nombre}. Los productos no dan comisión.</div>
            <label>Tipo de vehículo</label>
            <div className="pill-row">
              {TIPOS_VEHICULO.map((t) => (
                <button key={t.id} className={`pill ${tipoVeh === t.id ? 'active' : ''}`}
                  onClick={() => cambiarTipoCobro(t.id)}>{t.label}</button>
              ))}
            </div>

            <ItemsGrid servicios={servicios} productos={productos} carrito={carrito}
              onAdd={addCobro} onSub={subCobro} tipoVehiculo={tipoVeh} />
            <AgregarAdicional onAgregar={addAdicionalCobro} />

            {lineasCobro.length > 0 && (
              <>
                <div className="section-title">Cuenta</div>
                <table className="tabla">
                  <tbody>
                    {lineasCobro.map((l) => (
                      <tr key={l.key}>
                        <td>
                          {l.nombre} <span className="muted-cell">{money(l.precioVenta)} c/u</span>
                          <div className="line-step">
                            <button onClick={() => subCobro(l)} aria-label="Quitar uno">−</button>
                            <b>{l.cantidad}</b>
                            <button onClick={() => addCobro(l)} aria-label="Agregar uno">+</button>
                          </div>
                        </td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(totalLinea(l))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="dato-fuerte">Total: <b>{money(totalCobro)}</b></div>
                <div style={{ height: 10 }} />
                <div className="btn-row">
                  <button className="btn" onClick={() => cobrar('efectivo')}>Efectivo · {money(totalCobro)}</button>
                  <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => cobrar('transferencia')}>Transferencia</button>
                  <button className="btn ghost" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setCreditoOpen(true)}>Crédito</button>
                </div>
              </>
            )}
          </>
        )}
      </Sheet>

      {/* Crédito (fiado) del cobro rápido */}
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
    </>
  )

  // --- Modo embebido (dentro de Inicio) ---
  if (embedded) {
    return (
      <>
        <div className="section-title">Lavadores · hoy</div>
        {vacio}
        {lista.length > 0 && tarjetas}
        {hojas}
        {node}
      </>
    )
  }

  // --- Página completa (pestaña Lavadores) ---
  return (
    <>
      <Header title="Lavadores" sub={fechaLarga()} onBack={() => navigate('/')} />
      <div className="content">
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-label">SERVICIOS DE HOY</div><div className="kpi-value">{kServicios}</div></div>
          <div className="kpi"><div className="kpi-label">EFECTIVO</div><div className="kpi-value green">{money(kEfectivo)}</div></div>
          <div className="kpi"><div className="kpi-label">TRANSFERENCIA</div><div className="kpi-value">{money(kTransfer)}</div></div>
          <div className="kpi"><div className="kpi-label">TOTAL DE HOY</div><div className="kpi-value">{money(kTotal)}</div></div>
        </div>
        {vacio}
        {lista.length > 0 && tarjetas}
      </div>
      {hojas}
      {node}
    </>
  )
}
