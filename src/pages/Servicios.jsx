import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, borrarTodo } from '../db'
import { supabase } from '../supabase'
import { money } from '../format'
import { Header, Sheet, useToast, MoneyInput, SearchSelect } from '../components/ui'

const emptyServ = { nombre: '', precio: 0, comisionPct: 40 }

export default function Servicios() {
  const navigate = useNavigate()
  const { show, node } = useToast()
  const [tab, setTab] = useState('servicios') // 'servicios' | 'trabajadores'

  const servicios = useLiveQuery(() => db.servicios.where('activo').equals(1).toArray(), [], [])
  const trabajadores = useLiveQuery(() => db.trabajadores.where('activo').equals(1).toArray(), [], [])

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
  const emptyTrab = { nombre: '', pin: '', rol: 'trabajador' }
  const [trabForm, setTrabForm] = useState(emptyTrab)

  function nuevoTrab() { setTrabEdit(null); setTrabForm(emptyTrab); setTrabSheet(true) }
  function editarTrab(t) {
    setTrabEdit(t.id)
    setTrabForm({ nombre: t.nombre, pin: t.pin || '', rol: t.rol || 'trabajador' })
    setTrabSheet(true)
  }
  async function guardarTrab() {
    if (!trabForm.nombre.trim()) return show('Ponle un nombre')
    if (trabForm.pin && trabForm.pin.length !== 4) return show('El PIN debe tener 4 dígitos')
    const datos = { nombre: trabForm.nombre.trim(), pin: trabForm.pin, rol: trabForm.rol }
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

        <div style={{ height: 16 }} />
        <button className="btn" onClick={guardarTrab}>{trabEdit ? 'Guardar' : 'Agregar'}</button>
        {trabEdit && <><div style={{ height: 10 }} /><button className="btn danger" onClick={borrarTrab}>Eliminar</button></>}
      </Sheet>

      {node}
    </>
  )
}
