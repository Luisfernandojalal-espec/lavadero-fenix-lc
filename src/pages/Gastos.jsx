import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, CATEGORIAS_GASTO, MEDIOS_PAGO_GASTO, labelMedioGasto, tipoGasto, tipoPorCategoria, esGastoPnL, decidirTocaTurno } from '../db'
import { origenGasto } from '../reglas'
import { money, monthKey, currentMonthKey, monthLabel, shortDate, ultimosMeses } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
import { useAuth } from '../auth'

function labelGasto(id) {
  const c = CATEGORIAS_GASTO.find((x) => x.id === id)
  return c ? c.label : 'Otro'
}

const emptyForm = { concepto: '', categoria: 'arriendo', monto: 0, tipo: 'fijo', fijoId: null, medioPago: 'caja', pagoEfectivo: 0, salidaTurno: false, fueraDeTurno: false, responsable: '', comprobante: '' }
const emptyFijo = { nombre: '', categoria: 'arriendo', montoEstimado: 0 }

export default function Gastos() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { show, node } = useToast()
  const mesHoy = currentMonthKey()
  // Mes que se está mirando. Antes la pantalla estaba amarrada al mes en curso
  // y no había forma de ver los gastos de meses anteriores.
  const [mesActual, setMesActual] = useState(mesHoy)
  const esMesPasado = mesActual !== mesHoy
  const meses = ultimosMeses(12)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [editOrig, setEditOrig] = useState(null) // gasto tal como estaba antes de editarlo
  const [modoVariable, setModoVariable] = useState(false) // formulario simple (solo concepto + valor)
  const [form, setForm] = useState(emptyForm)

  const gastos = useLiveQuery(() => db.gastos.where('mes').equals(mesActual).toArray(), [mesActual], [])
  const fijos = useLiveQuery(() => db.gastos_fijos.where('activo').equals(1).toArray(), [], [])

  // Excluimos del total del P&L las categorías que NO son gasto operativo:
  //  - 'comisiones': ya están descontadas en la ganancia de servicios (neto).
  //    Antes contaban en el total "variables" pero NO se mostraban en la lista
  //    → el total no cuadraba con lo listado. (Se pagan/ven en Lavadores.)
  //  - 'inventario': su costo ya entra al vender el producto (COGS).
  // Ambas SÍ cuentan en el Turno (la plata salió), que lee db.gastos aparte.
  const lista = (gastos || []).filter(esGastoPnL).sort((a, b) => b.fecha - a.fecha)
  const total = lista.reduce((s, g) => s + g.monto, 0)
  const totalFijo = lista.filter((g) => tipoGasto(g) === 'fijo').reduce((s, g) => s + g.monto, 0)
  const totalVariable = total - totalFijo
  // Historial de gastos variables del mes (excluye pagos de comisión)
  const variablesLista = lista.filter((g) => tipoGasto(g) === 'variable' && g.categoria !== 'comisiones')

  // ¿Este gasto fijo ya se registró este mes?
  const registroDe = (fijoId) => lista.find((g) => g.fijoId === fijoId)

  // --- Registrar / editar un gasto ---
  // Gasto variable: formulario simple (concepto + valor).
  function abrirVariable() {
    setEditId(null); setEditOrig(null); setModoVariable(true)
    setForm({ ...emptyForm, categoria: 'otro', tipo: 'variable', concepto: '', responsable: user?.nombre || '', medioPago: 'caja' })
    setSheetOpen(true)
  }
  function abrirEditar(g) {
    setEditId(g.id); setEditOrig(g)
    setModoVariable(tipoGasto(g) === 'variable' && !g.fijoId)
    setForm({
      concepto: g.concepto, categoria: g.categoria, monto: g.monto, tipo: tipoGasto(g), fijoId: g.fijoId || null,
      medioPago: g.medioPago || 'caja', pagoEfectivo: g.pagoEfectivo || 0,
      salidaTurno: g.salidaTurno === 1, fueraDeTurno: g.fueraDeTurno === 1,
      responsable: g.responsable || '', comprobante: g.comprobante || '',
    })
    setSheetOpen(true)
  }
  // Registrar un gasto fijo del mes (prellenado con el estimado)
  function abrirDesdeFijo(f) {
    setEditId(null); setEditOrig(null); setModoVariable(false)
    // `fueraDeTurno: true` por defecto en los fijos: la regla de siempre es que
    // un fijo del mes NO descuadra el turno (se paga del banco del dueño). Si de
    // verdad salió del cajón, el operador lo cambia y ahí sí descuenta.
    setForm({ ...emptyForm, concepto: f.nombre, categoria: f.categoria, monto: f.montoEstimado, tipo: 'fijo', fijoId: f.id, fueraDeTurno: true, responsable: user?.nombre || '' })
    setSheetOpen(true)
  }

  const guardandoRef = useRef(false) // candado anti-doble-toque para el .add
  async function guardar() {
    if (modoVariable && !form.concepto.trim()) return show('Escribe el concepto')
    if (form.monto <= 0) return show('Falta el monto')
    if (guardandoRef.current) return
    guardandoRef.current = true
    try {
    const cat = CATEGORIAS_GASTO.find((c) => c.id === form.categoria)
    const concepto = form.concepto.trim() || (cat ? cat.label : 'Gasto')
    // Mixto: se guarda el reparto efectivo/transferencia como en las ventas.
    // Ojo: `medioPagoGasto('banco')` devolvería 'caja', así que el medio se
    // toma tal cual y solo se calcula el reparto. Si deja de ser mixto hay que
    // LIMPIAR el reparto viejo: db.update fusiona y quedarían cifras fantasma.
    const efMixto = Math.max(0, Math.min(form.pagoEfectivo || 0, form.monto))
    const extra = {
      medioPago: form.medioPago || 'caja',
      ...(form.medioPago === 'mixto'
        ? { pagoEfectivo: efMixto, pagoTransferencia: form.monto - efMixto }
        : { pagoEfectivo: null, pagoTransferencia: null }),
      // De dónde salió la plata: lo decide reglas.js (con pruebas). NO depende
      // de fijo/variable: reclasificar no puede cambiar el origen.
      ...origenGasto({ medioPago: form.medioPago || 'caja', salidaTurno: form.salidaTurno, fueraDeTurno: form.fueraDeTurno }),
      responsable: form.responsable.trim(),
      comprobante: form.comprobante.trim(),
    }
    // `tocaTurno` se CONGELA: dice si esta plata salió del turno el día que se
    // registró. Al editar NO se recalcula, porque reclasificar fijo/variable es
    // un cambio contable y no puede mover un cierre de caja que ya se hizo (si
    // se recalculaba, el turno de ese día aparecía con un faltante falso).
    // Para sacarlo del turno a propósito está el selector "¿De cuál efectivo
    // salió?" → "De otra plata" (fueraDeTurno), que manda sobre esta marca.
    // Lo que dice el operador con los selectores de origen: si salió del cajón
    // (caja y no "de otra plata") toca el turno; si fue por transferencia, solo
    // si marcó que salió del Nequi del turno.
    // Nuevo: lo que eligió el operador. Al editar se CONGELA lo que el gasto ya
    // hacía, salvo que cambie a propósito el medio de pago o los selectores de
    // origen (ver decidirTocaTurno en reglas.js).
    extra.tocaTurno = decidirTocaTurno({
      medioPago: extra.medioPago, fueraDeTurno: extra.fueraDeTurno === 1, salidaTurno: extra.salidaTurno === 1,
      original: editId ? editOrig : null,
    })
    if (editId) {
      await db.gastos.update(editId, stamp({ concepto, categoria: form.categoria, monto: form.monto, tipo: form.tipo, ...extra }))
      show('Gasto actualizado')
    } else {
      const now = Date.now()
      await db.gastos.add(stamp({
        id: uid(), concepto, categoria: form.categoria, monto: form.monto,
        tipo: form.tipo, fijoId: form.fijoId || null, ...extra,
        fecha: now, mes: monthKey(now),
      }))
      show('Gasto registrado')
    }
    setSheetOpen(false)
    } finally { guardandoRef.current = false }
  }
  async function eliminar() {
    await db.gastos.update(editId, stamp({ anulada: 1 }))
    setSheetOpen(false)
    show('Gasto eliminado')
  }

  // --- Plantilla de gastos fijos ---
  const [fijoSheet, setFijoSheet] = useState(false)
  const [fijoEdit, setFijoEdit] = useState(null)
  const [fijoForm, setFijoForm] = useState(emptyFijo)

  function nuevoFijo() { setFijoEdit(null); setFijoForm(emptyFijo); setFijoSheet(true) }
  function editarFijo(f) {
    setFijoEdit(f.id)
    setFijoForm({ nombre: f.nombre, categoria: f.categoria, montoEstimado: f.montoEstimado })
    setFijoSheet(true)
  }
  async function guardarFijo() {
    if (!fijoForm.nombre.trim()) return show('Ponle un nombre')
    if (fijoForm.montoEstimado <= 0) return show('Falta el valor estimado')
    const datos = { nombre: fijoForm.nombre.trim(), categoria: fijoForm.categoria, montoEstimado: fijoForm.montoEstimado }
    if (fijoEdit) await db.gastos_fijos.update(fijoEdit, stamp(datos))
    else await db.gastos_fijos.add(stamp({ id: uid(), activo: 1, ...datos }))
    setFijoSheet(false)
    show('Gasto fijo guardado')
  }
  async function borrarFijo() {
    await db.gastos_fijos.update(fijoEdit, stamp({ activo: 0 }))
    setFijoSheet(false)
    show('Gasto fijo eliminado')
  }

  const fijosOrdenados = (fijos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
  const pendientes = fijosOrdenados.filter((f) => !registroDe(f.id)).length

  // Gastos fijos YA registrados este mes (los que suman en "fijos" del total).
  // Los "huérfanos" son fijos registrados cuya plantilla se borró: hay que
  // poder verlos y editarlos/eliminarlos igual, porque siguen sumando.
  const idsFijosActivos = new Set(fijosOrdenados.map((f) => f.id))
  const fijosHuerfanos = lista.filter((g) => tipoGasto(g) === 'fijo' && g.categoria !== 'comisiones' && (!g.fijoId || !idsFijosActivos.has(g.fijoId)))

  return (
    <>
      <Header title="Gastos" sub={monthLabel(mesActual)} onBack={() => navigate('/')} />

      <div className="content">
        {/* Mismo selector de meses que Balance (ya lo conocen). */}
        <div className="meses-row">
          {meses.map((m) => (
            <button key={m} className={`pill ${mesActual === m ? 'active' : ''}`} onClick={() => setMesActual(m)}>
              {monthLabel(m).split(' ')[0]}{m.slice(0, 4) !== mesHoy.slice(0, 4) ? ` ${m.slice(0, 4)}` : ''}
            </button>
          ))}
        </div>
        {/* Un gasto nuevo siempre queda con la fecha de HOY: registrarlo
            mirando otro mes lo haría "desaparecer" de la lista que está viendo. */}
        {esMesPasado && (
          <div className="helper" style={{ margin: '4px 0 8px', color: 'var(--amber)' }}>
            Estás viendo {monthLabel(mesActual)}. Puedes revisar y corregir estos gastos; para registrar uno nuevo vuelve a {monthLabel(mesHoy).split(' ')[0]}.
          </div>
        )}
        <div className="dato-fuerte">
          Total del mes: <b style={{ color: 'var(--red)' }}>{money(total)}</b>
          <span className="muted-cell" style={{ fontSize: 13 }}> · fijos {money(totalFijo)} · variables {money(totalVariable)}</span>
        </div>

        {/* Gastos variables del día a día (arriba porque se registran a diario) */}
        <div className="section-title" style={{ marginTop: 4 }}>Gastos variables (día a día)</div>
        {!esMesPasado && <button className="btn" onClick={abrirVariable}>Agregar gasto variable</button>}
        <div className="helper" style={{ margin: '6px 0 4px' }}>Insumos y gastos del día. Se descuentan de la utilidad de hoy y del mes.</div>
        <div className="helper" style={{ margin: '0 0 4px', color: 'var(--amber)' }}>
          OJO: las compras de productos para vender (cerveza, gaseosa, mecatos…) NO van aquí — regístralas en Inventario → Factura de entrada, que descuenta la plata y suma el stock sin contar doble.
        </div>
        {variablesLista.length === 0 && <div className="empty" style={{ padding: '10px 0' }}>Aún no hay gastos variables este mes.</div>}
        {variablesLista.map((g) => (
          <div className="row" key={g.id} onClick={() => abrirEditar(g)} style={{ cursor: 'pointer' }}>
            <div className="main">
              <div className="title">{g.concepto}</div>
              <div className="meta">{shortDate(g.fecha)}{g.medioPago && g.medioPago !== 'caja' ? ` · ${labelMedioGasto(g.medioPago)}` : ''}{g.fueraDeTurno === 1 ? ' · de otra plata' : ''}{g.responsable ? ` · ${g.responsable}` : ''}</div>
            </div>
            <div className="right" style={{ fontWeight: 700, color: 'var(--red)' }}>−{money(g.monto)}</div>
          </div>
        ))}

        <div className="divider" />

        {/* Gastos fijos del mes: control registrado / pendiente */}
        <div className="section-title">
          Gastos fijos del mes{pendientes > 0 ? ` · ${pendientes} pendiente${pendientes > 1 ? 's' : ''}` : ''}
        </div>
        {fijosOrdenados.length === 0 && fijosHuerfanos.length === 0 && (
          <div className="helper" style={{ marginBottom: 8 }}>
            Define aquí los gastos que se repiten cada mes (arriendo, luz, agua…). El sistema te recordará si falta registrarlos.
          </div>
        )}
        <div className="helper" style={{ marginBottom: 6 }}>Toca el valor de un fijo ya registrado para editarlo o eliminarlo.</div>
        {fijosOrdenados.map((f) => {
          const reg = registroDe(f.id)
          return (
            <div className="row" key={f.id}>
              <div className="main" onClick={() => editarFijo(f)} style={{ cursor: 'pointer' }}>
                <div className="title">{f.nombre}</div>
                <div className="meta">{labelGasto(f.categoria)} · estimado {money(f.montoEstimado)}</div>
              </div>
              <div className="right">
                {reg ? (
                  <div onClick={() => abrirEditar(reg)} style={{ cursor: 'pointer', textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>{money(reg.monto)}</div>
                    <span className="badge green">Registrado · editar</span>
                  </div>
                ) : esMesPasado ? (
                  <span className="badge amber">No registrado</span>
                ) : (
                  <button className="chip-lavador" onClick={() => abrirDesdeFijo(f)}>Registrar</button>
                )}
              </div>
            </div>
          )
        })}
        {/* Fijos registrados cuya plantilla se borró (siguen sumando en el total) */}
        {fijosHuerfanos.map((g) => (
          <div className="row" key={g.id} onClick={() => abrirEditar(g)} style={{ cursor: 'pointer' }}>
            <div className="main">
              <div className="title">{g.concepto}</div>
              <div className="meta">{labelGasto(g.categoria)} · {shortDate(g.fecha)} · toca para editar/eliminar</div>
            </div>
            <div className="right" style={{ fontWeight: 700, color: 'var(--red)' }}>−{money(g.monto)}</div>
          </div>
        ))}
        {!esMesPasado && <button className="btn ghost" style={{ marginBottom: 4 }} onClick={nuevoFijo}>Agregar gasto fijo</button>}
      </div>

      {/* Registrar / editar gasto */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}
        title={editId ? 'Editar gasto' : (modoVariable ? 'Gasto variable' : 'Registrar gasto')}>
        {!editId && (
          <div className="helper" style={{ marginBottom: 8, color: 'var(--amber)' }}>
            ¿Es una compra de productos para vender? NO la registres aquí: hazla en Inventario → Factura de entrada (ella sola descuenta la plata del turno y suma el stock).
          </div>
        )}
        {!modoVariable && (
          <>
            <label>Categoría</label>
            <SearchSelect value={form.categoria}
              onChange={(v) => setForm({ ...form, categoria: v, tipo: form.fijoId ? 'fijo' : tipoPorCategoria(v) })}
              options={CATEGORIAS_GASTO.map((c) => ({ value: c.id, label: c.label }))} placeholder="Buscar categoría…" />
          </>
        )}

        <label>{modoVariable ? 'Concepto' : 'Descripción (opcional)'}</label>
        <input value={form.concepto} placeholder={modoVariable ? 'Ej: Jabón, silicona, combustible…' : 'Ej: Recibo de luz julio'}
          onChange={(e) => setForm({ ...form, concepto: e.target.value })} />

        <label>Monto</label>
        <MoneyInput value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} />

        <label>Medio de pago</label>
        <div className="pill-row">
          {MEDIOS_PAGO_GASTO.map((m) => (
            <button key={m.id} className={`pill ${form.medioPago === m.id ? 'active' : ''}`}
              onClick={() => setForm({ ...form, medioPago: m.id })}>{m.label}</button>
          ))}
        </div>
        {/* Faltaba el caso FIJO pagado en efectivo: no salía ningún control ni
            aviso, y la app NO lo descontaba del turno aunque la plata sí hubiera
            salido del cajón -> faltante inexplicable al cerrar. Ahora el
            selector aparece siempre que el medio sea caja; para los fijos viene
            en "De otra plata" (la regla de siempre) pero se puede corregir. */}
        {form.medioPago === 'mixto' && (
          <>
            <label>¿Cuánto se pagó en efectivo?</label>
            <MoneyInput value={form.pagoEfectivo} onChange={(v) => setForm({ ...form, pagoEfectivo: v })} />
            <div className="helper">
              Va por transferencia: <b>{money(Math.max(0, form.monto - Math.min(form.pagoEfectivo || 0, form.monto)))}</b>
            </div>
          </>
        )}
        {form.medioPago === 'caja' && (
          <>
            <label>¿De cuál efectivo salió?</label>
            <div className="pill-row">
              <button className={`pill ${!form.fueraDeTurno ? 'active' : ''}`} onClick={() => setForm({ ...form, fueraDeTurno: false })}>De la caja del turno</button>
              <button className={`pill ${form.fueraDeTurno ? 'active' : ''}`} onClick={() => setForm({ ...form, fueraDeTurno: true })}>De otra plata</button>
            </div>
            <div className="helper">
              {form.fueraDeTurno
                ? 'No descuadra el turno: la plata no salió del cajón (ej. efectivo que estaba en la casa). Sí cuenta como gasto del mes.'
                : 'Baja de una vez el "Efectivo esperado en caja" del turno abierto.'}
              {form.tipo === 'fijo' ? ' Los gastos fijos normalmente se pagan de otra cuenta; marca "De la caja del turno" solo si de verdad sacaste la plata del cajón.' : ''}
            </div>
          </>
        )}
        {form.medioPago !== 'caja' && (
          <>
            <label>{form.medioPago === 'mixto' ? '¿Salió del turno?' : '¿Salió del Nequi / transferencia del turno?'}</label>
            <div className="pill-row">
              <button className={`pill ${form.salidaTurno ? 'active' : ''}`} onClick={() => setForm({ ...form, salidaTurno: true })}>Sí, del turno (descuenta ya)</button>
              <button className={`pill ${!form.salidaTurno ? 'active' : ''}`} onClick={() => setForm({ ...form, salidaTurno: false })}>No, de otra cuenta</button>
            </div>
            <div className="helper">
              {form.salidaTurno
                ? (form.medioPago === 'mixto'
                  ? 'La parte en efectivo baja la caja del turno y el resto baja el "Debe quedar en transferencia".'
                  : 'Baja de una vez el "Debe quedar en transferencia" del turno abierto.')
                : 'No afecta el cuadre del turno (se pagó de otra plata; solo cuenta en el mes).'}
              {form.tipo === 'fijo' ? ' Los gastos fijos normalmente se pagan de otra cuenta; marca "Sí, del turno" solo si de verdad salió de la plata del turno.' : ''}
            </div>
          </>
        )}

        <label>Responsable (opcional)</label>
        <input value={form.responsable} placeholder="Ej: quién hizo el gasto"
          onChange={(e) => setForm({ ...form, responsable: e.target.value })} />

        <label>Comprobante / referencia (opcional)</label>
        <input value={form.comprobante} placeholder="Ej: N° de recibo o factura"
          onChange={(e) => setForm({ ...form, comprobante: e.target.value })} />

        {(!modoVariable || editId) && (
          <>
            <label>Tipo (fijo o variable)</label>
            <div className="pill-row">
              {/* OJO: al EDITAR, este interruptor NO puede tocar el origen de la
                  plata. Cambiar fijo/variable es contable; de dónde salió el
                  dinero es un hecho que ya ocurrió. Ponerle aquí
                  `fueraDeTurno` hacía que reclasificar un gasto a fijo lo
                  sacara del turno en silencio y apareciera un faltante en un
                  cierre ya hecho. El default solo aplica al CREAR. */}
              <button className={`pill ${form.tipo === 'fijo' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, tipo: 'fijo', ...(editId ? {} : { fueraDeTurno: true }) })}>Fijo</button>
              <button className={`pill ${form.tipo === 'variable' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, tipo: 'variable', ...(editId ? {} : { fueraDeTurno: false }) })}>Variable</button>
            </div>
            <div className="helper">Fijo = se repite cada mes (arriendo, nómina, sistema…). Variable = insumos y gastos del día.</div>
          </>
        )}

        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardar}>{editId ? 'Guardar' : 'Registrar gasto'}</button>
        {editId && <><div style={{ height: 10 }} /><button className="btn danger" onClick={eliminar}>Eliminar</button></>}
      </Sheet>

      {/* Plantilla de gasto fijo */}
      <Sheet open={fijoSheet} onClose={() => setFijoSheet(false)} title={fijoEdit ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}>
        <label>Nombre</label>
        <input value={fijoForm.nombre} placeholder="Ej: Arriendo del local"
          onChange={(e) => setFijoForm({ ...fijoForm, nombre: e.target.value })} />
        <label>Categoría</label>
        <SearchSelect value={fijoForm.categoria} onChange={(v) => setFijoForm({ ...fijoForm, categoria: v })}
          options={CATEGORIAS_GASTO.filter((c) => c.id !== 'comisiones').map((c) => ({ value: c.id, label: c.label }))}
          placeholder="Buscar categoría…" />
        <label>Valor estimado mensual</label>
        <MoneyInput value={fijoForm.montoEstimado} onChange={(v) => setFijoForm({ ...fijoForm, montoEstimado: v })} />
        <div className="helper">Cada mes lo registras con el valor real del recibo; este estimado es solo la referencia.</div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarFijo}>{fijoEdit ? 'Guardar' : 'Agregar'}</button>
        {fijoEdit && <><div style={{ height: 10 }} /><button className="btn danger" onClick={borrarFijo}>Eliminar</button></>}
      </Sheet>

      {node}
    </>
  )
}
