import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { money } from '../format'
import { stockBajo, precioServicio, servicioAplica, esServicioBase } from '../db'
import { useAuth } from '../auth'

const sinTildes = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Catálogo vacío: en vez de un callejón sin salida, guía a cargarlo.
function CatalogoVacio({ sinServicios, sinProductos }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const esDueno = user?.rol === 'dueño'

  return (
    <div className="empty">
      Aún no hay nada para vender: falta cargar el catálogo.
      {esDueno ? (
        <div style={{ maxWidth: 360, margin: '14px auto 0' }}>
          {sinServicios && (
            <button className="btn" onClick={() => navigate('/config')}>
              Crear servicios de lavado (Admin)
            </button>
          )}
          {sinServicios && sinProductos && <div style={{ height: 10 }} />}
          {sinProductos && (
            <button className="btn secondary" onClick={() => navigate('/inventario')}>
              Cargar productos (Inventario)
            </button>
          )}
          <div className="helper" style={{ marginTop: 10 }}>
            Los productos se cargan de una vez con la plantilla de Excel en Inventario → Saldos iniciales.
          </div>
        </div>
      ) : (
        <div className="helper" style={{ marginTop: 8 }}>
          Pídele al administrador que cargue los productos y servicios.
        </div>
      )}
    </div>
  )
}

// Convierte un ítem de la cuadrícula en una línea de carrito/cuenta.
// Para servicios usa el precio ya resuelto por tipo de vehículo (it.precio).
export function lineaDesde(it) {
  if (it.tipo === 'servicio') {
    return {
      key: it.key, tipo: 'servicio', refId: it.ref.id, nombre: it.ref.nombre,
      precioVenta: it.precio, precioBase: it.precio, // precioBase = catálogo (referencia si editan)
      tipoVehiculo: it.tipoVehiculo || null,
      descuento: 0, observacion: '',
      cantidad: 1,
      comisionPct: it.ref.comisionPct || 0,
      comisionPctServicio: it.ref.comisionPct || 0, // respaldo si la línea queda sin lavador
    }
  }
  return {
    key: it.key, tipo: 'producto', refId: it.ref.id, nombre: it.ref.nombre,
    precioVenta: it.ref.precioVenta, precioCompra: it.ref.precioCompra || 0, cantidad: 1,
  }
}

// Cuadrícula unificada de venta: SERVICIOS primero, luego PRODUCTOS.
// La cantidad seleccionada se ve en la propia tarjeta (badge + stepper),
// sin abrir otra ventana.
// carrito: { [key]: { cantidad, ... } }
export function ItemsGrid({ servicios, productos, carrito, onAdd, onSub, tipoVehiculo = 'automovil' }) {
  const [q, setQ] = useState('')

  // Servicios que aplican al tipo de vehículo, separados en lavadas
  // PRINCIPALES ("madres") y ADICIONES que se suman a la lavada.
  const aplicables = (servicios || [])
    .map((s) => ({ s, precio: precioServicio(s, tipoVehiculo) }))
    .filter((x) => servicioAplica(x.s, tipoVehiculo))
    .sort((a, b) => a.precio - b.precio)
    .map((x) => ({ key: 'servicio:' + x.s.id, tipo: 'servicio', ref: x.s, nombre: x.s.nombre, precio: x.precio, tipoVehiculo, base: esServicioBase(x.s) }))
  let bases = aplicables.filter((it) => it.base)
  let adiciones = aplicables.filter((it) => !it.base)
  let prods = (productos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map((p) => ({ key: 'producto:' + p.id, tipo: 'producto', ref: p, nombre: p.nombre, precio: p.precioVenta }))

  const catalogoVacio = !(servicios || []).length && !(productos || []).length
  if (catalogoVacio) {
    return <CatalogoVacio sinServicios={!(servicios || []).length} sinProductos={!(productos || []).length} />
  }
  if (bases.length + adiciones.length + prods.length === 0) {
    return <div className="empty">Ningún servicio aplica a este tipo de vehículo. Cambia el tipo arriba o agrega productos.</div>
  }

  if (q.trim()) {
    const match = (it) => sinTildes(it.nombre).includes(sinTildes(q))
    bases = bases.filter(match); adiciones = adiciones.filter(match); prods = prods.filter(match)
  }

  const tile = (it, tag) => {
    const qty = carrito[it.key]?.cantidad || 0
    return (
      <div key={it.key} className={`tile ${qty > 0 ? 'sel' : ''}`} role="button" tabIndex={0}
        onClick={() => onAdd(it)}>
        {qty > 0 && <span className="tile-qty">{qty}</span>}
        {tag && <span className="tile-tag">{tag}</span>}
        <span className="name">{it.nombre}</span>
        <span className="price">{money(it.precio)}</span>
        {it.tipo === 'producto' && stockBajo(it.ref) && (
          <span className="badge amber">Quedan {it.ref.stock ?? 0}</span>
        )}
        {qty > 0 && (
          <span className="tile-step" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onSub(it)} aria-label="Quitar uno">−</button>
            <b>{qty}</b>
            <button onClick={() => onAdd(it)} aria-label="Agregar uno">+</button>
          </span>
        )}
      </div>
    )
  }

  const sinResultados = bases.length + adiciones.length + prods.length === 0

  return (
    <>
    <input className="buscador" inputMode="search" placeholder="Buscar producto o servicio…"
      value={q} onChange={(e) => setQ(e.target.value)} />
    {sinResultados && <div className="empty">Sin resultados para “{q}”.</div>}
    {bases.length > 0 && (
      <>
        <div className="section-title" style={{ marginTop: 8 }}>Lavada principal</div>
        <div className="tiles">{bases.map((it) => tile(it, 'Lavada'))}</div>
      </>
    )}
    {adiciones.length > 0 && (
      <>
        <div className="section-title">Adiciones · se suman a la lavada</div>
        <div className="tiles">{adiciones.map((it) => tile(it, 'Adición'))}</div>
      </>
    )}
    {prods.length > 0 && (
      <>
        <div className="section-title">Nevera y mecatos</div>
        <div className="tiles">{prods.map((it) => tile(it, null))}</div>
      </>
    )}
    </>
  )
}
