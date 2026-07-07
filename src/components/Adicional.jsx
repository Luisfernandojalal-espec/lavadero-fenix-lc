import { useState } from 'react'
import { uid } from '../db'
import { Sheet, MoneyInput } from './ui'

// Línea de "adicional libre": un cobro extra manual (descripción + monto) que
// no está en el catálogo. Se factura como un servicio, así puede llevar lavador
// y comisión (quien lo agrega decide con asignarComision). refId = null.
export function lineaAdicional({ nombre, monto }) {
  return {
    key: 'adicional:' + uid(),
    tipo: 'servicio', refId: null, nombre, esAdicional: true,
    precioVenta: monto, precioBase: monto,
    tipoVehiculo: null, descuento: 0, observacion: '',
    cantidad: 1, comisionPct: 0, comisionPctServicio: 0,
  }
}

// Botón + hoja para agregar un adicional a la cuenta.
// onAgregar({ nombre, monto }) lo recibe el padre para armar la línea.
export function AgregarAdicional({ onAgregar }) {
  const [open, setOpen] = useState(false)
  const [nombre, setNombre] = useState('')
  const [monto, setMonto] = useState(0)
  const [err, setErr] = useState('')

  function cerrar() { setOpen(false); setNombre(''); setMonto(0); setErr('') }
  function confirmar() {
    const desc = nombre.trim()
    if (!desc) return setErr('Escribe qué fue el adicional')
    if (monto <= 0) return setErr('Escribe el valor del adicional')
    onAgregar({ nombre: desc, monto })
    cerrar()
  }

  return (
    <>
      <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        + Agregar adicional
      </button>
      <Sheet open={open} onClose={cerrar} title="Adicional">
        <div className="helper" style={{ marginBottom: 8 }}>
          Un cobro extra que no está en el catálogo y se suma a la cuenta (ej: limpieza de motor, brillado especial).
        </div>
        <label>¿Qué fue?</label>
        <input value={nombre} placeholder="Ej: Limpieza de motor"
          onChange={(e) => { setNombre(e.target.value); setErr('') }} />
        <label>Valor</label>
        <MoneyInput value={monto} onChange={(v) => { setMonto(v); setErr('') }} placeholder="Valor del adicional" />
        {err && <div className="helper" style={{ color: 'var(--red)', marginTop: 6 }}>{err}</div>}
        <div style={{ height: 14 }} />
        <button className="btn" onClick={confirmar}>Agregar a la cuenta</button>
      </Sheet>
    </>
  )
}
