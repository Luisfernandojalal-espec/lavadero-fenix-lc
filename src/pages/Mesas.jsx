import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp } from '../db'
import { money, shortDate } from '../format'
import { Header, Sheet, useToast, SearchSelect } from '../components/ui'
import { ItemsGrid, lineaDesde } from '../components/ItemsGrid'
import { facturarItems, totalDe, labelMedio } from '../ventas'
import { useAuth } from '../auth'

const ESTADOS = {
  libre: 'Libre',
  ocupada: 'Ocupada',
  reservada: 'Reservada',
}

// Agrega un evento al historial de la mesa (trazabilidad).
const conEvento = (mesa, texto, quien) =>
  [...(mesa.eventos || []), { fecha: Date.now(), texto: quien ? `${texto} (${quien})` : texto }].slice(-60)

const minAbierta = (m) => (m.abiertaEn ? Math.max(0, Math.round((Date.now() - m.abiertaEn) / 60000)) : 0)

export default function Mesas() {
  const { user } = useAuth()
  const { show, node } = useToast()

  const mesas = useLiveQuery(() => db.mesas.where('activo').equals(1).toArray(), [], [])
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const clientes = useLiveQuery(() => db.clientes.where('activo').equals(1).toArray(), [], [])

  const lista = (mesas || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))

  // Mesa abierta en pantalla (vista detalle)
  const [detId, setDetId] = useState(null)
  const mesa = lista.find((m) => m.id === detId)

  // --- Crear mesa ---
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  async function crearMesa() {
    const nombre = nuevoNombre.trim() || `Mesa ${lista.length + 1}`
    await db.mesas.add(stamp({ id: uid(), activo: 1, nombre, estado: 'libre', items: [], eventos: [] }))
    setNuevaOpen(false); setNuevoNombre('')
    show('Mesa creada')
  }

  // --- Acciones sobre mesa libre/reservada ---
  const [accion, setAccion] = useState(null) // mesa seleccionada (no ocupada)
  const [clienteMesa, setClienteMesa] = useState('')

  async function abrirMesa(m) {
    await db.mesas.update(m.id, stamp({
      estado: 'ocupada',
      cliente: clienteMesa.trim(),
      abiertaEn: Date.now(),
      items: [],
      eventos: conEvento({ eventos: [] }, `Apertura${clienteMesa.trim() ? ' · ' + clienteMesa.trim() : ''}`, user?.nombre),
    }))
    setAccion(null); setClienteMesa('')
    setDetId(m.id)
  }
  async function reservar(m) {
    await db.mesas.update(m.id, stamp({ estado: 'reservada', cliente: clienteMesa.trim(), eventos: conEvento(m, 'Reservada', user?.nombre) }))
    setAccion(null); setClienteMesa(''); show('Mesa reservada')
  }
  async function liberar(m) {
    await db.mesas.update(m.id, stamp({ estado: 'libre', cliente: '', eventos: conEvento(m, 'Liberada', user?.nombre) }))
    setAccion(null); show('Mesa liberada')
  }
  async function eliminarMesa(m) {
    await db.mesas.update(m.id, stamp({ activo: 0 }))
    setAccion(null); show('Mesa eliminada')
  }

  function tocarMesa(m) {
    if (m.estado === 'ocupada') { setDetId(m.id) } else { setClienteMesa(m.cliente || ''); setAccion(m) }
  }

  // --- Detalle: agregar/quitar items ---
  const carritoMesa = mesa ? Object.fromEntries((mesa.items || []).map((l) => [l.key, l])) : {}

  async function addItem(it) {
    const items = [...(mesa.items || [])]
    const i = items.findIndex((x) => x.key === it.key)
    if (i >= 0) items[i] = { ...items[i], cantidad: items[i].cantidad + 1 }
    else {
      const linea = lineaDesde(it)
      // Si registra un trabajador, sus servicios quedan asignados a él
      if (linea.tipo === 'servicio' && user && user.rol !== 'dueño') {
        linea.trabajadorId = user.id
        linea.trabajadorNombre = user.nombre
      }
      items.push(linea)
    }
    await db.mesas.update(mesa.id, stamp({ items, eventos: conEvento(mesa, `+1 ${it.nombre}`, user?.nombre) }))
  }

  // Asignar lavador a una línea de servicio de la mesa
  const [asignando, setAsignando] = useState(null)
  async function asignarLavador(key, t) {
    const items = (mesa.items || []).map((l) =>
      l.key === key ? { ...l, trabajadorId: t ? t.id : null, trabajadorNombre: t ? t.nombre : null } : l)
    const linea = items.find((l) => l.key === key)
    await db.mesas.update(mesa.id, stamp({
      items,
      eventos: conEvento(mesa, `${linea.nombre} asignado a ${t ? t.nombre : 'sin asignar'}`, user?.nombre),
    }))
    setAsignando(null)
  }
  async function subItem(it) {
    const items = [...(mesa.items || [])]
    const i = items.findIndex((x) => x.key === it.key)
    if (i < 0) return
    if (items[i].cantidad <= 1) items.splice(i, 1)
    else items[i] = { ...items[i], cantidad: items[i].cantidad - 1 }
    await db.mesas.update(mesa.id, stamp({ items, eventos: conEvento(mesa, `−1 ${it.nombre}`, user?.nombre) }))
  }

  // --- Transferencias ---
  const [transfer, setTransfer] = useState(null) // { key } para una línea, o { todo: true }
  const [destinoId, setDestinoId] = useState('')

  async function hacerTransferencia() {
    const destino = lista.find((m) => m.id === destinoId)
    if (!destino) return show('Elige la mesa destino')

    const mover = transfer.todo ? [...(mesa.items || [])] : (mesa.items || []).filter((l) => l.key === transfer.key)
    if (mover.length === 0) return

    // Fusionar en destino (suma cantidades de la misma línea)
    const itemsDest = [...(destino.items || [])]
    for (const l of mover) {
      const i = itemsDest.findIndex((x) => x.key === l.key)
      if (i >= 0) itemsDest[i] = { ...itemsDest[i], cantidad: itemsDest[i].cantidad + l.cantidad }
      else itemsDest.push({ ...l })
    }
    const queMovio = transfer.todo ? 'toda la cuenta' : mover.map((l) => `${l.cantidad}x ${l.nombre}`).join(', ')
    await db.mesas.update(destino.id, stamp({
      estado: 'ocupada',
      abiertaEn: destino.abiertaEn || Date.now(),
      items: itemsDest,
      eventos: conEvento(destino, `Recibió de ${mesa.nombre}: ${queMovio}`, user?.nombre),
    }))

    const itemsOrigen = transfer.todo ? [] : (mesa.items || []).filter((l) => l.key !== transfer.key)
    await db.mesas.update(mesa.id, stamp({
      items: itemsOrigen,
      estado: itemsOrigen.length === 0 && transfer.todo ? 'libre' : mesa.estado,
      cliente: transfer.todo ? '' : mesa.cliente,
      eventos: conEvento(mesa, `Transfirió a ${destino.nombre}: ${queMovio}`, user?.nombre),
    }))

    setTransfer(null); setDestinoId('')
    if (transfer.todo) setDetId(null)
    show(`Transferido a ${destino.nombre}`)
  }

  // --- Cobro de la mesa ---
  const [cobroOpen, setCobroOpen] = useState(false)
  const [clienteSel, setClienteSel] = useState('')
  const [clienteNuevo, setClienteNuevo] = useState('')

  async function cobrarMesa(metodo) {
    let cliente = null
    if (metodo === 'credito') {
      if (clienteNuevo.trim()) {
        cliente = { id: uid(), nombre: clienteNuevo.trim() }
        await db.clientes.add(stamp({ id: cliente.id, activo: 1, nombre: cliente.nombre, telefono: '' }))
      } else {
        cliente = (clientes || []).find((c) => c.id === clienteSel)
      }
      if (!cliente) return show('Elige o crea un cliente')
    }
    const { total } = await facturarItems({ items: mesa.items || [], metodo, cliente, origen: mesa.nombre })
    await db.mesas.update(mesa.id, stamp({
      estado: 'libre', items: [], cliente: '',
      eventos: conEvento(mesa, `Cuenta cobrada ${money(total)} · ${metodo === 'credito' ? 'fiado a ' + cliente.nombre : labelMedio(metodo).toLowerCase()}`, user?.nombre),
    }))
    setCobroOpen(false); setClienteSel(''); setClienteNuevo(''); setDetId(null)
    show(`Mesa cobrada · ${money(total)}`)
  }

  // ============ VISTA DETALLE (mesa ocupada) ============
  if (mesa && mesa.estado === 'ocupada') {
    const items = mesa.items || []
    const total = totalDe(items)
    const hayServicios = items.some((l) => l.tipo === 'servicio')
    const otras = lista.filter((m) => m.id !== mesa.id)

    return (
      <>
        <Header title={mesa.nombre} sub={`${mesa.cliente ? mesa.cliente + ' · ' : ''}Abierta hace ${minAbierta(mesa)} min`} />
        <div className="content">
          <button className="btn ghost" style={{ marginBottom: 12 }} onClick={() => setDetId(null)}>‹ Volver a mesas</button>

          <ItemsGrid servicios={servicios} productos={productos} carrito={carritoMesa} onAdd={addItem} onSub={subItem} />

          <div className="section-title">Cuenta de la mesa</div>
          {items.length === 0 && <div className="empty">Sin consumos todavía. Toca un servicio o producto para agregarlo.</div>}
          {items.length > 0 && (
            <table className="tabla">
              <tbody>
                {items.map((l) => (
                  <tr key={l.key}>
                    <td>
                      {l.nombre}
                      {l.tipo === 'servicio' && (
                        <div>
                          <button className="chip-lavador" onClick={() => setAsignando(l.key)}>
                            {l.trabajadorNombre ? `Lavador: ${l.trabajadorNombre}` : 'Asignar lavador'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="num muted-cell">{l.cantidad} × {money(l.precioVenta)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(l.precioVenta * l.cantidad)}</td>
                    <td className="num">
                      <button className="btn ghost" style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }}
                        onClick={() => { setTransfer({ key: l.key }); setDestinoId('') }}>Transferir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {items.length > 0 && (
            <>
              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="meta">Total de la mesa</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{money(total)}</div>
              </div>
              <div className="btn-row">
                <button className="btn" onClick={() => setCobroOpen(true)}>Cobrar {money(total)}</button>
                <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }}
                  onClick={() => { setTransfer({ todo: true }); setDestinoId('') }}>Transferir mesa</button>
              </div>
            </>
          )}

          <div className="section-title">Movimientos de la mesa</div>
          <table className="tabla">
            <tbody>
              {[...(mesa.eventos || [])].reverse().slice(0, 15).map((e, i) => (
                <tr key={i}>
                  <td className="muted-cell" style={{ whiteSpace: 'nowrap' }}>{shortDate(e.fecha)}</td>
                  <td>{e.texto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Transferir línea o mesa completa */}
        <Sheet open={!!transfer} onClose={() => setTransfer(null)}
          title={transfer?.todo ? 'Transferir toda la mesa' : 'Transferir producto'}>
          <label>Mesa destino</label>
          <SearchSelect value={destinoId} onChange={setDestinoId}
            options={otras.map((m) => ({ value: m.id, label: `${m.nombre} — ${ESTADOS[m.estado] || m.estado}` }))}
            placeholder="Buscar mesa…" />
          <div style={{ height: 14 }} />
          <button className="btn" onClick={hacerTransferencia}>Transferir</button>
        </Sheet>

        {/* Asignar lavador a un servicio de la mesa */}
        <Sheet open={!!asignando} onClose={() => setAsignando(null)} title="¿Quién hace este servicio?">
          <div className="pill-row">
            {(trabajadores || []).map((t) => (
              <button key={t.id} className="pill" onClick={() => asignarLavador(asignando, t)}>{t.nombre}</button>
            ))}
            <button className="pill" onClick={() => asignarLavador(asignando, null)}>Sin asignar</button>
          </div>
          <div className="helper">La comisión de esta lavada se le acumula al lavador elegido.</div>
        </Sheet>

        {/* Cobrar mesa */}
        <Sheet open={cobroOpen} onClose={() => setCobroOpen(false)} title={`Cobrar ${mesa.nombre} · ${money(total)}`}>
          {hayServicios && items.some((l) => l.tipo === 'servicio' && !l.trabajadorId) && (
            <div className="helper" style={{ color: 'var(--amber)', marginBottom: 8 }}>
              Hay servicios sin lavador asignado: esas comisiones no se le acumularán a nadie.
            </div>
          )}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => cobrarMesa('efectivo')}>Efectivo · {money(total)}</button>
            <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => cobrarMesa('transferencia')}>Transferencia</button>
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
          <button className="btn secondary" onClick={() => cobrarMesa('credito')}>Registrar fiado</button>
        </Sheet>

        {node}
      </>
    )
  }

  // ============ VISTA LISTA DE MESAS ============
  return (
    <>
      <Header title="Mesas" sub="Cuentas abiertas del negocio" />
      <div className="content">
        {lista.length === 0 && (
          <div className="empty">Aún no hay mesas.<br />Toca + para crear la primera (ej: Mesa 1, Barra, Cliente mostrador).</div>
        )}

        <div className="mesa-grid">
          {lista.map((m) => {
            const total = totalDe(m.items || [])
            return (
              <button key={m.id} className={`mesa-card ${m.estado}`} onClick={() => tocarMesa(m)}>
                <span className="mesa-estado">{ESTADOS[m.estado] || m.estado}</span>
                <span className="mesa-nombre">{m.nombre}</span>
                {m.estado === 'ocupada' ? (
                  <>
                    <span className="mesa-total">{money(total)}</span>
                    <span className="meta">{m.cliente ? m.cliente + ' · ' : ''}hace {minAbierta(m)} min</span>
                  </>
                ) : (
                  <span className="meta">{m.estado === 'reservada' ? (m.cliente || 'Reservada') : 'Toca para abrir'}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <button className="fab" onClick={() => setNuevaOpen(true)} aria-label="Nueva mesa">+</button>

      {/* Crear mesa */}
      <Sheet open={nuevaOpen} onClose={() => setNuevaOpen(false)} title="Nueva mesa">
        <label>Nombre</label>
        <input value={nuevoNombre} placeholder={`Ej: Mesa ${lista.length + 1}, Barra…`}
          onChange={(e) => setNuevoNombre(e.target.value)} />
        <div style={{ height: 14 }} />
        <button className="btn" onClick={crearMesa}>Crear mesa</button>
      </Sheet>

      {/* Acciones sobre mesa libre / reservada */}
      <Sheet open={!!accion} onClose={() => setAccion(null)} title={accion ? accion.nombre : ''}>
        {accion && (
          <>
            <label>Cliente (opcional)</label>
            <input value={clienteMesa} placeholder="Ej: Juan — carro rojo"
              onChange={(e) => setClienteMesa(e.target.value)} />
            <div style={{ height: 14 }} />
            <button className="btn" onClick={() => abrirMesa(accion)}>Abrir mesa</button>
            <div style={{ height: 10 }} />
            {accion.estado === 'libre' && (
              <button className="btn secondary" onClick={() => reservar(accion)}>Reservar</button>
            )}
            {accion.estado === 'reservada' && (
              <button className="btn secondary" onClick={() => liberar(accion)}>Quitar reserva</button>
            )}
            <div style={{ height: 10 }} />
            <button className="btn ghost" onClick={() => eliminarMesa(accion)}>Eliminar mesa</button>
          </>
        )}
      </Sheet>

      {node}
    </>
  )
}
