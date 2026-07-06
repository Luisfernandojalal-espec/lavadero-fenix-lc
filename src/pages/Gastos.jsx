import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, CATEGORIAS_GASTO, MEDIOS_PAGO_GASTO, labelMedioGasto, tipoGasto, tipoPorCategoria } from '../db'
import { money, monthKey, currentMonthKey, monthLabel, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'
import { useAuth } from '../auth'

function labelGasto(id) {
  const c = CATEGORIAS_GASTO.find((x) => x.id === id)
  return c ? c.label : 'Otro'
}

const emptyForm = { concepto: '', categoria: 'arriendo', monto: 0, tipo: 'fijo', fijoId: null, medioPago: 'caja', responsable: '', comprobante: '' }
const emptyFijo = { nombre: '', categoria: 'arriendo', montoEstimado: 0 }

export default function Gastos() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { show, node } = useToast()
  const mesActual = currentMonthKey()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [modoVariable, setModoVariable] = useState(false) // formulario simple (solo concepto + valor)
  const [form, setForm] = useState(emptyForm)

  const gastos = useLiveQuery(() => db.gastos.where('mes').equals(mesActual).toArray(), [mesActual], [])
  const fijos = useLiveQuery(() => db.gastos_fijos.where('activo').equals(1).toArray(), [], [])

  const lista = (gastos || []).filter((g) => !g.anulada).sort((a, b) => b.fecha - a.fecha)
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
    setEditId(null); setModoVariable(true)
    setForm({ ...emptyForm, categoria: 'otro', tipo: 'variable', concepto: '', responsable: user?.nombre || '', medioPago: 'caja' })
    setSheetOpen(true)
  }
  function abrirEditar(g) {
    setEditId(g.id)
    setModoVariable(tipoGasto(g) === 'variable' && !g.fijoId)
    setForm({
      concepto: g.concepto, categoria: g.categoria, monto: g.monto, tipo: tipoGasto(g), fijoId: g.fijoId || null,
      medioPago: g.medioPago || 'caja', responsable: g.responsable || '', comprobante: g.comprobante || '',
    })
    setSheetOpen(true)
  }
  // Registrar un gasto fijo del mes (prellenado con el estimado)
  function abrirDesdeFijo(f) {
    setEditId(null); setModoVariable(false)
    setForm({ ...emptyForm, concepto: f.nombre, categoria: f.categoria, monto: f.montoEstimado, tipo: 'fijo', fijoId: f.id, responsable: user?.nombre || '' })
    setSheetOpen(true)
  }

  async function guardar() {
    if (modoVariable && !form.concepto.trim()) return show('Escribe el concepto')
    if (form.monto <= 0) return show('Falta el monto')
    const cat = CATEGORIAS_GASTO.find((c) => c.id === form.categoria)
    const concepto = form.concepto.trim() || (cat ? cat.label : 'Gasto')
    const extra = {
      medioPago: form.medioPago || 'caja',
      responsable: form.responsable.trim(),
      comprobante: form.comprobante.trim(),
    }
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

  return (
    <>
      <Header title="Gastos" sub={monthLabel(mesActual)} onBack={() => navigate('/')} />

      <div className="content">
        <div className="dato-fuerte">
          Total del mes: <b style={{ color: 'var(--red)' }}>{money(total)}</b>
          <span className="muted-cell" style={{ fontSize: 13 }}> · fijos {money(totalFijo)} · variables {money(totalVariable)}</span>
        </div>

        {/* Gastos variables del día a día (arriba porque se registran a diario) */}
        <div className="section-title" style={{ marginTop: 4 }}>Gastos variables (día a día)</div>
        <button className="btn" onClick={abrirVariable}>Agregar gasto variable</button>
        <div className="helper" style={{ margin: '6px 0 4px' }}>Insumos y gastos del día. Se descuentan de la utilidad de hoy y del mes.</div>
        {variablesLista.length === 0 && <div className="empty" style={{ padding: '10px 0' }}>Aún no hay gastos variables este mes.</div>}
        {variablesLista.map((g) => (
          <div className="row" key={g.id} onClick={() => abrirEditar(g)} style={{ cursor: 'pointer' }}>
            <div className="main">
              <div className="title">{g.concepto}</div>
              <div className="meta">{shortDate(g.fecha)}{g.medioPago && g.medioPago !== 'caja' ? ` · ${labelMedioGasto(g.medioPago)}` : ''}{g.responsable ? ` · ${g.responsable}` : ''}</div>
            </div>
            <div className="right" style={{ fontWeight: 700, color: 'var(--red)' }}>−{money(g.monto)}</div>
          </div>
        ))}

        <div className="divider" />

        {/* Gastos fijos del mes: control registrado / pendiente */}
        <div className="section-title">
          Gastos fijos del mes{pendientes > 0 ? ` · ${pendientes} pendiente${pendientes > 1 ? 's' : ''}` : ''}
        </div>
        {fijosOrdenados.length === 0 && (
          <div className="helper" style={{ marginBottom: 8 }}>
            Define aquí los gastos que se repiten cada mes (arriendo, luz, agua…). El sistema te recordará si falta registrarlos.
          </div>
        )}
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
                  <>
                    <div style={{ fontWeight: 700 }}>{money(reg.monto)}</div>
                    <span className="badge green">Registrado</span>
                  </>
                ) : (
                  <button className="chip-lavador" onClick={() => abrirDesdeFijo(f)}>Registrar</button>
                )}
              </div>
            </div>
          )
        })}
        <button className="btn ghost" style={{ marginBottom: 4 }} onClick={nuevoFijo}>Agregar gasto fijo</button>
      </div>

      {/* Registrar / editar gasto */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}
        title={editId ? 'Editar gasto' : (modoVariable ? 'Gasto variable' : 'Registrar gasto')}>
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
        {form.medioPago !== 'caja' && (
          <div className="helper">No sale del efectivo de la caja (no afecta el cuadre del turno).</div>
        )}

        <label>Responsable (opcional)</label>
        <input value={form.responsable} placeholder="Ej: quién hizo el gasto"
          onChange={(e) => setForm({ ...form, responsable: e.target.value })} />

        <label>Comprobante / referencia (opcional)</label>
        <input value={form.comprobante} placeholder="Ej: N° de recibo o factura"
          onChange={(e) => setForm({ ...form, comprobante: e.target.value })} />

        {!modoVariable && (
          <>
            <label>Tipo</label>
            <div className="pill-row">
              <button className={`pill ${form.tipo === 'fijo' ? 'active' : ''}`} onClick={() => setForm({ ...form, tipo: 'fijo' })}>Fijo</button>
              <button className={`pill ${form.tipo === 'variable' ? 'active' : ''}`} onClick={() => setForm({ ...form, tipo: 'variable' })}>Variable</button>
            </div>
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
