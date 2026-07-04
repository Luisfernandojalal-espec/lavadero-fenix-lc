import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, borrarTodo } from '../db'
import { supabase } from '../supabase'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
import { useAuth } from '../auth'

const emptyServ = { nombre: '', precio: 0, comisionPct: 40 }

export default function Servicios() {
  const navigate = useNavigate()
  const { show, node } = useToast()
  const { user } = useAuth()
  const [tab, setTab] = useState('servicios') // 'servicios' | 'trabajadores' | 'comisiones'

  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])
  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const pagos = useLiveQuery(() => db.pagos_comision.toArray(), [], [])

  // --- Comisiones: pendiente = todo lo generado − todo lo pagado ---
  const ventasServ = (ventas || []).filter((v) => v.tipo === 'servicio' && !v.anulada && v.trabajadorId)
  function resumenDe(tId) {
    const mias = ventasServ.filter((v) => v.trabajadorId === tId)
    const generado = mias.reduce((s, v) => s + (v.comision || 0), 0)
    const lavadas = mias.reduce((s, v) => s + (v.cantidad || 1), 0)
    const pagado = (pagos || []).filter((p) => p.trabajadorId === tId).reduce((s, p) => s + p.monto, 0)
    return { generado, pagado, pendiente: generado - pagado, lavadas }
  }

  const [pagoA, setPagoA] = useState(null)   // trabajador al que se le paga
  const [montoPago, setMontoPago] = useState(0)

  function abrirPago(t) {
    setPagoA(t)
    setMontoPago(Math.max(0, resumenDe(t.id).pendiente))
  }

  async function pagarComision() {
    if (montoPago <= 0) return show('Escribe el valor a pagar')
    const now = Date.now()
    await db.pagos_comision.add(stamp({
      id: uid(), trabajadorId: pagoA.id, trabajadorNombre: pagoA.nombre,
      monto: montoPago, fecha: now, mes: monthKey(now), pagadoPor: user?.nombre || '',
    }))
    // Sale plata de la caja: queda como gasto (cuenta en el cierre de turno).
    // En el Balance NO se resta otra vez (la comisión ya está descontada del
    // neto de servicios) — por eso la categoría 'comisiones' se excluye allá.
    await db.gastos.add(stamp({
      id: uid(), concepto: `Comisiones ${pagoA.nombre}`, categoria: 'comisiones',
      monto: montoPago, fecha: now, mes: monthKey(now),
    }))
    setPagoA(null); setMontoPago(0)
    show('Pago de comisiones registrado')
  }

  // --- Servicios ---
  const [servSheet, setServSheet] = useState(false)
  const [servEdit, setServEdit] = useState(null)
  const [servForm, setServForm] = useState(emptyServ)

  function nuevoServ() {
    setServEdit(null); setServForm(emptyServ); setServSheet(true)
  }
  function editarServ(s) {
    setServEdit(s.id)
    setServForm({ nombre: s.nombre, precio: s.precio, comisionPct: s.comisionPct })
    setServSheet(true)
  }
  async function guardarServ() {
    if (!servForm.nombre.trim()) return show('Ponle un nombre')
    if (servForm.precio <= 0) return show('Falta el precio')
    if (servEdit) await db.servicios.update(servEdit, stamp({ ...servForm }))
    else await db.servicios.add(stamp({ id: uid(), activo: 1, ...servForm }))
    setServSheet(false); show('Servicio guardado')
  }
  async function borrarServ() {
    await db.servicios.update(servEdit, stamp({ activo: 0 }))
    setServSheet(false); show('Servicio eliminado')
  }

  // --- Trabajadores ---
  const [trabSheet, setTrabSheet] = useState(false)
  const [trabEdit, setTrabEdit] = useState(null)
  const emptyTrab = { nombre: '', pin: '', rol: 'trabajador', pregunta: '', respuesta: '' }
  const [trabForm, setTrabForm] = useState(emptyTrab)

  function nuevoTrab() { setTrabEdit(null); setTrabForm(emptyTrab); setTrabSheet(true) }
  function editarTrab(t) {
    setTrabEdit(t.id)
    setTrabForm({ nombre: t.nombre, pin: t.pin || '', rol: t.rol || 'trabajador', pregunta: t.pregunta || '', respuesta: '' })
    setTrabSheet(true)
  }
  async function guardarTrab() {
    if (!trabForm.nombre.trim()) return show('Ponle un nombre')
    if (trabForm.pin && trabForm.pin.length !== 4) return show('El PIN debe tener 4 dígitos')
    const datos = { nombre: trabForm.nombre.trim(), pin: trabForm.pin, rol: trabForm.rol }
    if (trabForm.pregunta.trim()) datos.pregunta = trabForm.pregunta.trim()
    // Solo actualiza la respuesta si escribieron una nueva (así no se borra al editar otros campos)
    if (trabForm.respuesta.trim()) datos.respuesta = trabForm.respuesta.trim().toLowerCase()
    if (trabEdit) await db.trabajadores.update(trabEdit, stamp(datos))
    else await db.trabajadores.add(stamp({ id: uid(), activo: 1, ...datos }))
    setTrabSheet(false); show('Trabajador guardado')
  }
  async function borrarTrab() {
    await db.trabajadores.update(trabEdit, stamp({ activo: 0 }))
    setTrabSheet(false); show('Trabajador eliminado')
  }

  const comisionPreview = Math.round(servForm.precio * (servForm.comisionPct / 100))

  async function empezarDeCero() {
    const ok = window.confirm('Esto BORRA TODO para dejar el sistema en blanco: productos, ventas, gastos, inventario, clientes, servicios y usuarios (en este dispositivo y en la nube). Tendrás que crear el usuario administrador otra vez. ¿Continuar?')
    if (!ok) return
    await borrarTodo(supabase)
    show('Sistema en blanco. Reiniciando…')
    setTimeout(() => location.reload(), 900)
  }

  return (
    <>
      <Header title="Configuración" sub="Servicios de lavado y trabajadores" onBack={() => navigate('/')} />

      <div className="content">
        <div className="pill-row">
          <button className={`pill ${tab === 'servicios' ? 'active' : ''}`} onClick={() => setTab('servicios')}>
            Servicios
          </button>
          <button className={`pill ${tab === 'trabajadores' ? 'active' : ''}`} onClick={() => setTab('trabajadores')}>
            Trabajadores
          </button>
          <button className={`pill ${tab === 'comisiones' ? 'active' : ''}`} onClick={() => setTab('comisiones')}>
            Comisiones
          </button>
        </div>

        {tab === 'servicios' && (
          <>
            {(servicios || []).sort((a, b) => a.precio - b.precio).map((s) => (
              <div className="row" key={s.id} onClick={() => editarServ(s)}>
                <div className="main">
                  <div className="title">{s.nombre}</div>
                  <div className="meta">Comisión {s.comisionPct}% · {money(Math.round(s.precio * s.comisionPct / 100))}</div>
                </div>
                <div className="right" style={{ fontWeight: 700 }}>{money(s.precio)}</div>
              </div>
            ))}
            {(servicios || []).length === 0 && <div className="empty">Sin servicios. Toca + para crear uno.</div>}
            <button className="fab" onClick={nuevoServ} aria-label="Nuevo servicio">+</button>
          </>
        )}

        {tab === 'trabajadores' && (
          <>
            {(trabajadores || []).map((t) => (
              <div className="row" key={t.id} onClick={() => editarTrab(t)}>
                <div className="main"><div className="title">{t.nombre}</div><div className="meta">{t.rol === 'dueño' ? 'Administrador' : 'Trabajador'}</div></div>
                <div className="right meta">Editar</div>
              </div>
            ))}
            {(trabajadores || []).length === 0 && <div className="empty">Sin trabajadores. Toca + para agregar.</div>}
            <button className="fab" onClick={nuevoTrab} aria-label="Nuevo trabajador">+</button>
          </>
        )}

        {tab === 'comisiones' && (
          <>
            <div className="helper" style={{ marginBottom: 10 }}>
              Lo que se le debe a cada lavador (comisiones generadas menos pagos hechos). Al pagar, el valor sale de la caja y queda en el historial.
            </div>
            {(trabajadores || []).map((t) => {
              const r = resumenDe(t.id)
              if (r.generado === 0 && r.pendiente === 0) return null
              return (
                <div className="row" key={t.id}>
                  <div className="main">
                    <div className="title">{t.nombre}</div>
                    <div className="meta">{r.lavadas} lavadas · generado {money(r.generado)} · pagado {money(r.pagado)}</div>
                  </div>
                  <div className="right">
                    <div style={{ fontWeight: 700, color: r.pendiente > 0 ? 'var(--red)' : 'var(--green)' }}>{money(r.pendiente)}</div>
                    {r.pendiente > 0 && (
                      <button className="chip-lavador" onClick={() => abrirPago(t)}>Pagar</button>
                    )}
                  </div>
                </div>
              )
            })}
            {ventasServ.length === 0 && <div className="empty">Aún no hay servicios con lavador asignado.</div>}

            {(pagos || []).length > 0 && (
              <>
                <div className="section-title">Pagos realizados</div>
                {(pagos || []).slice().sort((a, b) => b.fecha - a.fecha).slice(0, 15).map((p) => (
                  <div className="row" key={p.id}>
                    <div className="main">
                      <div className="title">{p.trabajadorNombre}</div>
                      <div className="meta">{shortDate(p.fecha)} · pagó {p.pagadoPor}</div>
                    </div>
                    <div className="right" style={{ fontWeight: 700 }}>{money(p.monto)}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        <div className="divider" />
        <div className="section-title" style={{ color: 'var(--red)' }}>Zona de peligro</div>
        <div className="helper" style={{ marginBottom: 8 }}>
          Deja el sistema en blanco (borra productos, ventas, clientes, servicios y usuarios, aquí y en la nube). Úsalo una vez para entregar el sistema limpio: al terminar, crearás el usuario administrador de nuevo.
        </div>
        <button className="btn danger" onClick={empezarDeCero}>Empezar de cero (borrar todo)</button>
      </div>

      {/* Sheet servicio */}
      <Sheet open={servSheet} onClose={() => setServSheet(false)} title={servEdit ? 'Editar servicio' : 'Nuevo servicio'}>
        <label>Nombre del servicio</label>
        <input value={servForm.nombre} placeholder="Ej: Lavado carro + brillado"
          onChange={(e) => setServForm({ ...servForm, nombre: e.target.value })} />

        <label>Precio que cobra al cliente</label>
        <MoneyInput value={servForm.precio} onChange={(v) => setServForm({ ...servForm, precio: v })} />

        <label>Comisión del trabajador: {servForm.comisionPct}%</label>
        <input type="range" min="0" max="100" step="5" value={servForm.comisionPct}
          onChange={(e) => setServForm({ ...servForm, comisionPct: parseInt(e.target.value, 10) })} />
        <div className="helper">
          De cada {money(servForm.precio)}, el trabajador recibe <b>{money(comisionPreview)}</b> y al negocio le quedan <b>{money(servForm.precio - comisionPreview)}</b>.
        </div>

        <div style={{ height: 16 }} />
        <button className="btn" onClick={guardarServ}>{servEdit ? 'Guardar cambios' : 'Crear servicio'}</button>
        {servEdit && <><div style={{ height: 10 }} /><button className="btn danger" onClick={borrarServ}>Eliminar</button></>}
      </Sheet>

      {/* Sheet trabajador */}
      <Sheet open={trabSheet} onClose={() => setTrabSheet(false)} title={trabEdit ? 'Editar trabajador' : 'Nuevo trabajador'}>
        <label>Nombre</label>
        <input value={trabForm.nombre} placeholder="Ej: Carlos"
          onChange={(e) => setTrabForm({ ...trabForm, nombre: e.target.value })} />

        <label>PIN de acceso (4 dígitos)</label>
        <input inputMode="numeric" value={trabForm.pin} placeholder="Ej: 1234" maxLength={4}
          onChange={(e) => setTrabForm({ ...trabForm, pin: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })} />
        <div className="helper">Con este PIN entrará a la app en su celular.</div>

        <label>Rol</label>
        <SearchSelect value={trabForm.rol} onChange={(v) => setTrabForm({ ...trabForm, rol: v })}
          options={[{ value: 'trabajador', label: 'Trabajador (solo Factura rápida)' }, { value: 'dueño', label: 'Administrador (ve todo)' }]}
          placeholder="Elegir rol…" />

        <div className="divider" />
        <label>Pregunta de seguridad (para recuperar el PIN)</label>
        <input value={trabForm.pregunta} placeholder="Ej: ¿Nombre de mi primera mascota?"
          onChange={(e) => setTrabForm({ ...trabForm, pregunta: e.target.value })} />
        <label>Respuesta</label>
        <input value={trabForm.respuesta} placeholder={trabEdit ? 'Escribe para cambiarla' : 'Respuesta secreta'}
          onChange={(e) => setTrabForm({ ...trabForm, respuesta: e.target.value })} />
        <div className="helper">Si olvida el PIN, podrá recuperarlo respondiendo esto.</div>

        <div style={{ height: 16 }} />
        <button className="btn" onClick={guardarTrab}>{trabEdit ? 'Guardar' : 'Agregar'}</button>
        {trabEdit && <><div style={{ height: 10 }} /><button className="btn danger" onClick={borrarTrab}>Eliminar</button></>}
      </Sheet>

      {/* Pagar comisiones a un lavador */}
      <Sheet open={!!pagoA} onClose={() => setPagoA(null)} title={pagoA ? `Pagar comisiones · ${pagoA.nombre}` : ''}>
        {pagoA && (
          <>
            <div className="dato-fuerte">Pendiente: <b style={{ color: 'var(--red)' }}>{money(resumenDe(pagoA.id).pendiente)}</b></div>
            <label>Valor a pagar (puede ser parcial)</label>
            <MoneyInput value={montoPago} onChange={setMontoPago} />
            <div className="helper">Quedará registrado como salida de caja y se descuenta del pendiente.</div>
            <div style={{ height: 14 }} />
            <button className="btn" onClick={pagarComision}>Registrar pago de {money(montoPago)}</button>
          </>
        )}
      </Sheet>

      {node}
    </>
  )
}
