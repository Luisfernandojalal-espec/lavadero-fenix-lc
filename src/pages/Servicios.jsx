import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, borrarTodo, TIPOS_VEHICULO, precioServicio, precioMinServicio, esServicioBase } from '../db'
import { supabase } from '../supabase'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
import { useAuth } from '../auth'

const preciosVacios = () => Object.fromEntries(TIPOS_VEHICULO.map((t) => [t.id, 0]))
const emptyServ = { nombre: '', precios: preciosVacios(), comisionPct: 40 }

// Lista de precios OFICIAL de la cartelera del local (matriz dispersa:
// los tipos de vehículo sin precio no ofrecen ese servicio).
const LISTA_OFICIAL = [
  { nombre: 'Lavado General', esBase: true, precios: { automovil: 25000, camioneta: 30000, moto100: 7000, moto150: 8000 } },
  { nombre: 'Con Todo', esBase: true, precios: { moto100: 10000, moto150: 12000 } },
  { nombre: 'Furgón', precios: { automovil: 30000, camioneta: 35000 } },
  { nombre: 'Pulida', precios: { automovil: 15000, camioneta: 20000 } },
  { nombre: 'Brillada', precios: { automovil: 7000, camioneta: 10000 } },
  { nombre: 'Polichada', precios: { automovil: 40000, camioneta: 70000 } },
  { nombre: 'Grafitada', precios: { automovil: 10000, camioneta: 10000 } },
  { nombre: 'Limpieza Motor', precios: { automovil: 10000, camioneta: 15000 } },
  { nombre: 'Cojinería', precios: { automovil: 70000, camioneta: 100000 } },
  { nombre: 'Limpieza Techo', precios: { automovil: 30000, camioneta: 40000 } },
  { nombre: 'Overhaul', precios: { automovil: 180000, camioneta: 250000 } },
  { nombre: 'Farolas', precios: { automovil: 30000, camioneta: 40000 } },
  { nombre: 'Hidratación de Cojinería', precios: { automovil: 40000, camioneta: 50000 } },
]

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
  const [detalleT, setDetalleT] = useState(null) // planilla de lavadas de un lavador

  // Planilla: cada lavada del lavador desde su último pago (si no hay pagos, todas)
  function planillaDe(tId) {
    const ultimoPago = (pagos || []).filter((p) => p.trabajadorId === tId)
      .reduce((m, p) => Math.max(m, p.fecha), 0)
    return ventasServ
      .filter((v) => v.trabajadorId === tId && v.fecha > ultimoPago)
      .sort((a, b) => b.fecha - a.fecha)
  }

  async function compartirPlanilla(t) {
    const filas = planillaDe(t.id)
    const total = filas.reduce((s, v) => s + (v.comision || 0), 0)
    const cop = (n) => '$' + Math.round(n).toLocaleString('es-CO')
    const texto = [
      `LAVADERO FÉNIX LC — Comisiones de ${t.nombre}`,
      'Lavadas desde el último pago:',
      '--------------------------',
      ...filas.map((v) => `${shortDate(v.fecha)} · ${(v.cantidad || 1)}x ${v.servicioNombre} (${v.comisionPct}%) → ${cop(v.comision || 0)}`),
      '--------------------------',
      `TOTAL A PAGAR: ${cop(total)}`,
    ].join('\n')
    try {
      if (navigator.share) { await navigator.share({ text: texto }); show('Planilla compartida') }
      else { await navigator.clipboard.writeText(texto); show('Planilla copiada al portapapeles') }
    } catch { try { await navigator.clipboard.writeText(texto); show('Planilla copiada al portapapeles') } catch { show('No se pudo compartir') } }
  }

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
    setServEdit(null); setServForm({ nombre: '', precios: preciosVacios(), comisionPct: 40, esBase: false }); setServSheet(true)
  }
  function editarServ(s) {
    setServEdit(s.id)
    // Migra el modelo viejo (precio escalar) → precios por tipo, cargándolo en Automóvil.
    const precios = s.precios && typeof s.precios === 'object'
      ? { ...preciosVacios(), ...s.precios }
      : { ...preciosVacios(), automovil: s.precio || 0 }
    setServForm({ nombre: s.nombre, precios, comisionPct: s.comisionPct, esBase: esServicioBase(s) })
    setServSheet(true)
  }
  function setPrecioTipo(tipoId, v) {
    setServForm((f) => ({ ...f, precios: { ...f.precios, [tipoId]: v } }))
  }
  async function guardarServ() {
    if (!servForm.nombre.trim()) return show('Ponle un nombre')
    const precios = Object.fromEntries(
      TIPOS_VEHICULO.map((t) => [t.id, Math.max(0, servForm.precios[t.id] || 0)])
    )
    if (precioMinServicio({ precios }) <= 0) return show('Pon el precio en al menos un tipo de vehículo')
    // `precio` = mínimo ofrecido, se conserva para orden/compatibilidad.
    const datos = { nombre: servForm.nombre.trim(), precios, precio: precioMinServicio({ precios }), comisionPct: servForm.comisionPct, esBase: servForm.esBase ? 1 : 0 }
    if (servEdit) await db.servicios.update(servEdit, stamp(datos))
    else await db.servicios.add(stamp({ id: uid(), activo: 1, ...datos }))
    setServSheet(false); show('Servicio guardado')
  }
  async function borrarServ() {
    await db.servicios.update(servEdit, stamp({ activo: 0 }))
    setServSheet(false); show('Servicio eliminado')
  }

  // Crea de una vez los servicios de la cartelera que falten (no toca los existentes).
  async function cargarListaOficial() {
    const existentes = await db.servicios.where('activo').equals(1).toArray()
    let creados = 0
    for (const s of LISTA_OFICIAL) {
      if (existentes.some((x) => x.nombre.trim().toLowerCase() === s.nombre.toLowerCase())) continue
      const precios = { ...preciosVacios(), ...s.precios }
      await db.servicios.add(stamp({
        id: uid(), activo: 1, nombre: s.nombre, precios,
        precio: precioMinServicio({ precios }), comisionPct: 40,
        esBase: s.esBase ? 1 : 0,
      }))
      creados++
    }
    show(creados
      ? `${creados} servicios creados con los precios de la cartelera`
      : 'Ya tienes todos los servicios de la cartelera')
  }

  // --- Trabajadores ---
  const [trabSheet, setTrabSheet] = useState(false)
  const [trabEdit, setTrabEdit] = useState(null)
  const emptyTrab = { nombre: '', pin: '', rol: 'trabajador', pregunta: '', respuesta: '', comisionPct: '' }
  const [trabForm, setTrabForm] = useState(emptyTrab)

  function nuevoTrab() { setTrabEdit(null); setTrabForm(emptyTrab); setTrabSheet(true) }
  function editarTrab(t) {
    setTrabEdit(t.id)
    setTrabForm({
      nombre: t.nombre, pin: t.pin || '', rol: t.rol || 'trabajador',
      pregunta: t.pregunta || '', respuesta: '',
      comisionPct: t.comisionPct != null ? String(t.comisionPct) : '',
    })
    setTrabSheet(true)
  }
  async function guardarTrab() {
    if (!trabForm.nombre.trim()) return show('Ponle un nombre')
    if (trabForm.pin && trabForm.pin.length !== 4) return show('El PIN debe tener 4 dígitos')
    const datos = { nombre: trabForm.nombre.trim(), pin: trabForm.pin, rol: trabForm.rol }
    // % propio del lavador: vacío = usa el % definido en cada servicio
    datos.comisionPct = trabForm.comisionPct === '' ? null : Math.min(100, parseInt(trabForm.comisionPct, 10) || 0)
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

  const precioRefServ = precioMinServicio(servForm)
  const comisionPreview = Math.round(precioRefServ * (servForm.comisionPct / 100))

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
        <div className="subtabs">
          <button className={`subtab ${tab === 'servicios' ? 'active' : ''}`} onClick={() => setTab('servicios')}>
            Servicios
          </button>
          <button className={`subtab ${tab === 'trabajadores' ? 'active' : ''}`} onClick={() => setTab('trabajadores')}>
            Trabajadores
          </button>
          <button className={`subtab ${tab === 'comisiones' ? 'active' : ''}`} onClick={() => setTab('comisiones')}>
            Comisiones
          </button>
        </div>

        {tab === 'servicios' && (
          <>
            {(servicios || []).slice().sort((a, b) => precioMinServicio(a) - precioMinServicio(b)).map((s) => {
              const tipos = TIPOS_VEHICULO.filter((t) => precioServicio(s, t.id) > 0)
              return (
                <div className="row" key={s.id} onClick={() => editarServ(s)}>
                  <div className="main">
                    <div className="title">{s.nombre}</div>
                    <div className="meta">
                      {esServicioBase(s) ? 'Lavada principal' : 'Adición'} · Comisión {s.comisionPct}% · {tipos.map((t) => `${t.label} ${money(precioServicio(s, t.id))}`).join(' · ')}
                    </div>
                  </div>
                  <div className="right meta">Editar</div>
                </div>
              )
            })}
            {(servicios || []).length === 0 && (
              <div className="empty">
                Sin servicios.
                <div style={{ height: 12 }} />
                <button className="btn" style={{ maxWidth: 340 }} onClick={cargarListaOficial}>
                  Cargar lista de precios de la cartelera
                </button>
                <div className="helper" style={{ marginTop: 8 }}>
                  Crea los {LISTA_OFICIAL.length} servicios con sus precios por tipo de vehículo. O toca + para crear uno a mano.
                </div>
              </div>
            )}
            {(servicios || []).length > 0 && (
              <button className="btn ghost" style={{ marginTop: 8 }} onClick={cargarListaOficial}>
                Cargar servicios de la cartelera que falten
              </button>
            )}
            <button className="fab" onClick={nuevoServ} aria-label="Nuevo servicio">+</button>
          </>
        )}

        {tab === 'trabajadores' && (
          <>
            {(trabajadores || []).map((t) => (
              <div className="row" key={t.id} onClick={() => editarTrab(t)}>
                <div className="main"><div className="title">{t.nombre}</div><div className="meta">{t.rol === 'dueño' ? 'Administrador' : 'Trabajador'}{t.comisionPct != null ? ` · Comisión propia ${t.comisionPct}%` : ''}</div></div>
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
                    <button className="chip-lavador" onClick={() => setDetalleT(t)}>Ver detalle de lavadas</button>
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

        <label>Tipo de servicio</label>
        <div className="pill-row">
          <button className={`pill ${servForm.esBase ? 'active' : ''}`}
            onClick={() => setServForm({ ...servForm, esBase: true })}>Lavada principal</button>
          <button className={`pill ${!servForm.esBase ? 'active' : ''}`}
            onClick={() => setServForm({ ...servForm, esBase: false })}>Adición</button>
        </div>
        <div className="helper" style={{ marginTop: -2 }}>
          Las lavadas principales salen primero en el cobro; las adiciones aparecen debajo y se suman a la lavada.
        </div>

        <label>Precio por tipo de vehículo</label>
        <div className="helper" style={{ marginTop: -2, marginBottom: 6 }}>
          Deja en $0 los tipos de vehículo a los que NO se les hace este servicio (no aparecerán en el cobro).
        </div>
        {TIPOS_VEHICULO.map((t) => (
          <div key={t.id} style={{ marginBottom: 8 }}>
            <label style={{ margin: 0 }}>{t.label}</label>
            <MoneyInput value={servForm.precios[t.id] || 0} onChange={(v) => setPrecioTipo(t.id, v)} />
          </div>
        ))}

        <label>Comisión del trabajador: {servForm.comisionPct}%</label>
        <input type="range" min="0" max="100" step="5" value={servForm.comisionPct}
          onChange={(e) => setServForm({ ...servForm, comisionPct: parseInt(e.target.value, 10) })} />
        <div className="helper">
          Sobre {money(precioRefServ)} (precio más bajo), el trabajador recibe <b>{money(comisionPreview)}</b> y al negocio le quedan <b>{money(precioRefServ - comisionPreview)}</b>.
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

        <label>Comisión propia (%) — opcional</label>
        <input inputMode="numeric" value={trabForm.comisionPct} placeholder="Ej: 45"
          onChange={(e) => setTrabForm({ ...trabForm, comisionPct: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })} />
        <div className="helper">
          Si lo defines, este lavador gana este % en TODOS sus servicios. Si lo dejas vacío, aplica el % de cada servicio.
        </div>

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

      {/* Planilla de lavadas de un lavador */}
      <Sheet open={!!detalleT} onClose={() => setDetalleT(null)} title={detalleT ? `Lavadas de ${detalleT.nombre}` : ''}>
        {detalleT && (() => {
          const filas = planillaDe(detalleT.id)
          const total = filas.reduce((s, v) => s + (v.comision || 0), 0)
          return (
            <>
              <div className="helper" style={{ marginBottom: 8 }}>Servicios desde el último pago. Cada lavada con su % y lo que ganó.</div>
              {filas.length === 0 && <div className="empty">Sin lavadas pendientes de pago.</div>}
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
              <div className="dato-fuerte" style={{ marginTop: 10 }}>Total a pagar: <b style={{ color: 'var(--red)' }}>{money(total)}</b></div>
              <div style={{ height: 10 }} />
              <div className="btn-row">
                <button className="btn" onClick={() => { setDetalleT(null); abrirPago(detalleT) }}>Pagar</button>
                <button className="btn secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => compartirPlanilla(detalleT)}>Compartir</button>
              </div>
            </>
          )
        })()}
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
