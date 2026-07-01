import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, CATEGORIAS_GASTO } from '../db'
import { money, monthKey, currentMonthKey, monthLabel, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'

function emojiGasto(id) {
  const c = CATEGORIAS_GASTO.find((x) => x.id === id)
  return c ? c.emoji : '📋'
}

const emptyForm = { concepto: '', categoria: 'arriendo', monto: 0 }

export default function Gastos() {
  const { show, node } = useToast()
  const mesActual = currentMonthKey()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const gastos = useLiveQuery(() => db.gastos.where('mes').equals(mesActual).toArray(), [mesActual], [])

  const lista = (gastos || []).filter((g) => !g.anulada).sort((a, b) => b.fecha - a.fecha)
  const total = lista.reduce((s, g) => s + g.monto, 0)

  function abrirNuevo(catId) {
    setEditId(null)
    setForm({ ...emptyForm, categoria: catId || 'arriendo' })
    setSheetOpen(true)
  }
  function abrirEditar(g) {
    setEditId(g.id)
    setForm({ concepto: g.concepto, categoria: g.categoria, monto: g.monto })
    setSheetOpen(true)
  }

  async function guardar() {
    if (form.monto <= 0) return show('Falta el monto')
    const cat = CATEGORIAS_GASTO.find((c) => c.id === form.categoria)
    const concepto = form.concepto.trim() || cat.label
    if (editId) {
      await db.gastos.update(editId, stamp({ ...form, concepto }))
      show('Gasto actualizado')
    } else {
      const now = Date.now()
      await db.gastos.add(stamp({
        id: uid(), concepto, categoria: form.categoria, monto: form.monto,
        fecha: now, mes: monthKey(now),
      }))
      show('Gasto registrado')
    }
    setSheetOpen(false)
  }
  async function eliminar() {
    // Anulación (soft-delete): se sincroniza con la nube; no reaparece.
    await db.gastos.update(editId, stamp({ anulada: 1 }))
    setSheetOpen(false)
    show('Gasto eliminado')
  }

  return (
    <>
      <Header title="Gastos" sub={monthLabel(mesActual)} />

      <div className="content">
        <div className="card stat-card">
          <div className="label">🏠 Total de gastos del mes</div>
          <div className="value red">{money(total)}</div>
        </div>

        <div className="section-title">Agregar rápido</div>
        <div className="pill-row">
          {CATEGORIAS_GASTO.map((c) => (
            <button key={c.id} className="pill" onClick={() => abrirNuevo(c.id)}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        <div className="section-title">Movimientos</div>
        {lista.length === 0 && <div className="empty">Sin gastos este mes.<br />Usa los botones de arriba.</div>}
        {lista.map((g) => (
          <div className="row" key={g.id} onClick={() => abrirEditar(g)}>
            <div className="main">
              <div className="title">{emojiGasto(g.categoria)} {g.concepto}</div>
              <div className="meta">{shortDate(g.fecha)}</div>
            </div>
            <div className="right" style={{ fontWeight: 700, color: 'var(--red)' }}>−{money(g.monto)}</div>
          </div>
        ))}
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={editId ? 'Editar gasto' : 'Nuevo gasto'}>
        <label>Categoría</label>
        <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
          {CATEGORIAS_GASTO.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </select>

        <label>Descripción (opcional)</label>
        <input value={form.concepto} placeholder="Ej: Recibo de luz mayo"
          onChange={(e) => setForm({ ...form, concepto: e.target.value })} />

        <label>Monto</label>
        <MoneyInput value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} />

        <div style={{ height: 16 }} />
        <button className="btn" onClick={guardar}>{editId ? 'Guardar' : 'Registrar gasto'}</button>
        {editId && <><div style={{ height: 10 }} /><button className="btn danger" onClick={eliminar}>Eliminar</button></>}
      </Sheet>

      {node}
    </>
  )
}
