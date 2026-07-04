import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, stockBajo } from '../db'
import { money, currentMonthKey, monthLabel } from '../format'
import { Header } from '../components/ui'
import { descargarReportePDF } from '../pdf'

// Devuelve las últimas N claves de mes ("2026-06", "2026-05", ...)
function ultimosMeses(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

export default function Reportes() {
  const navigate = useNavigate()
  const [mes, setMes] = useState(currentMonthKey())
  const meses = ultimosMeses(6)

  const ventas = useLiveQuery(() => db.ventas.where('mes').equals(mes).toArray(), [mes], [])
  const gastos = useLiveQuery(() => db.gastos.where('mes').equals(mes).toArray(), [mes], [])
  const productos = useLiveQuery(() => db.productos.where('activo').equals(1).toArray(), [], [])
  const todasVentas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const abonos = useLiveQuery(() => db.abonos.toArray(), [], [])

  // Productos por acabarse (alerta de stock bajo)
  const porAcabarse = (productos || []).filter(stockBajo).sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))

  // --- Estado actual (no depende del mes) ---
  // Cuentas por cobrar = ventas a crédito vigentes − abonos recibidos
  const debeTotal = (todasVentas || []).filter((x) => x.metodoPago === 'credito' && !x.anulada).reduce((s, x) => s + x.total, 0)
  const abonadoTotal = (abonos || []).reduce((s, a) => s + a.monto, 0)
  const porCobrar = Math.max(0, debeTotal - abonadoTotal)
  // Valor del inventario a costo
  const valorInventario = (productos || []).reduce((s, p) => s + (p.stock || 0) * (p.precioCompra || 0), 0)

  // Excluir movimientos anulados de todos los cálculos
  const v = (ventas || []).filter((x) => !x.anulada)
  const ventasProd = v.filter((x) => x.tipo === 'producto')
  const ventasServ = v.filter((x) => x.tipo === 'servicio')

  // --- Productos ---
  const ingresoProd = ventasProd.reduce((s, x) => s + x.total, 0)
  const costoProd = ventasProd.reduce((s, x) => s + x.costo, 0)
  const gananciaProd = ingresoProd - costoProd

  // --- Servicios ---
  const ingresoServ = ventasServ.reduce((s, x) => s + x.total, 0)
  const comisiones = ventasServ.reduce((s, x) => s + (x.comision || 0), 0)
  const gananciaServ = ingresoServ - comisiones

  // --- Gastos ---
  // Los pagos de comisiones (categoría 'comisiones') NO se restan aquí:
  // la comisión ya está descontada del neto de servicios. Restarlos otra
  // vez duplicaría el descuento. (Sí cuentan en el cierre de turno, porque
  // ahí lo que importa es el efectivo que salió de la caja.)
  const totalGastos = (gastos || []).filter((x) => !x.anulada && x.categoria !== 'comisiones').reduce((s, x) => s + x.monto, 0)

  // --- Utilidad neta ---
  const utilidad = gananciaProd + gananciaServ - totalGastos

  // Ranking de productos que más ganancia dejan
  const porProducto = {}
  for (const venta of ventasProd) {
    for (const it of venta.items || []) {
      const g = (it.precioVenta - it.precioCompra) * it.cantidad
      if (!porProducto[it.nombre]) porProducto[it.nombre] = { nombre: it.nombre, unidades: 0, ganancia: 0 }
      porProducto[it.nombre].unidades += it.cantidad
      porProducto[it.nombre].ganancia += g
    }
  }
  const ranking = Object.values(porProducto).sort((a, b) => b.ganancia - a.ganancia)

  // Comisiones por trabajador
  const porTrabajador = {}
  for (const s of ventasServ) {
    const nombre = s.trabajadorNombre || 'Sin asignar'
    if (!porTrabajador[nombre]) porTrabajador[nombre] = { nombre, lavados: 0, comision: 0 }
    porTrabajador[nombre].lavados += (s.cantidad || 1)
    porTrabajador[nombre].comision += s.comision || 0
  }
  const trabRanking = Object.values(porTrabajador).sort((a, b) => b.comision - a.comision)

  async function descargarPDF() {
    await descargarReportePDF({
      mesLabel: monthLabel(mes),
      gananciaProd, ingresoProd, costoProd,
      ingresoServ, comisiones, gananciaServ,
      totalGastos, utilidad,
      porCobrar, valorInventario,
      ranking, trabRanking,
      gastos: (gastos || []).filter((g) => !g.anulada),
    })
  }

  return (
    <>
      <Header title="Balance" sub="Resumen financiero del negocio" onBack={() => navigate('/')} />

      <div className="content">
        <div className="pill-row">
          {meses.map((m) => (
            <button key={m} className={`pill ${mes === m ? 'active' : ''}`} onClick={() => setMes(m)}>
              {monthLabel(m).split(' ')[0]}
            </button>
          ))}
        </div>

        {porAcabarse.length > 0 && (
          <div className="card alerta-stock" onClick={() => navigate('/inventario')}>
            <div className="label" style={{ fontWeight: 700, marginBottom: 6 }}>
              {porAcabarse.length === 1 ? 'Un producto con stock bajo' : `${porAcabarse.length} productos con stock bajo`}
            </div>
            {porAcabarse.slice(0, 4).map((p) => (
              <div key={p.id} className="alerta-item">
                <span>{p.nombre}</span>
                <b>{p.stock ?? 0} restantes</b>
              </div>
            ))}
            {porAcabarse.length > 4 && <div className="helper">y {porAcabarse.length - 4} más…</div>}
          </div>
        )}

        <button className="btn ghost" style={{ marginBottom: 12 }} onClick={() => navigate('/historial')}>
          Ver historial y corregir ventas
        </button>

        <button className="btn ghost" style={{ marginBottom: 12 }} onClick={descargarPDF}>
          Descargar reporte del mes (PDF)
        </button>

        {/* Tarjeta estrella: lo que pidió el cliente */}
        <div className="card stat-card" style={{ borderColor: 'var(--green)' }}>
          <div className="label">Ganancia de productos (nevera y mecatos)</div>
          <div className="value green">{money(gananciaProd)}</div>
          <div className="meta" style={{ color: 'var(--muted)', fontSize: 13 }}>
            Vendiste {money(ingresoProd)} · te costaron {money(costoProd)}
          </div>
        </div>

        <div className="grid-2">
          <div className="card stat-card">
            <div className="label">Servicios (neto)</div>
            <div className="value">{money(gananciaServ)}</div>
            <div className="meta" style={{ fontSize: 12 }}>Vendido {money(ingresoServ)}</div>
          </div>
          <div className="card stat-card">
            <div className="label">Comisiones</div>
            <div className="value" style={{ color: 'var(--amber)' }}>{money(comisiones)}</div>
            <div className="meta" style={{ fontSize: 12 }}>A pagar a trabajadores</div>
          </div>
        </div>

        <div className="card stat-card">
          <div className="label">Gastos del mes</div>
          <div className="value red">{money(totalGastos)}</div>
          <div className="meta" style={{ fontSize: 12 }}>Arriendo, luz, agua y otros</div>
        </div>

        {/* Utilidad neta */}
        <div className="card stat-card" style={{ background: utilidad >= 0 ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.10)', borderColor: utilidad >= 0 ? 'var(--green)' : 'var(--red)' }}>
          <div className="label">Utilidad neta del mes</div>
          <div className={`value ${utilidad >= 0 ? 'green' : 'red'}`}>{money(utilidad)}</div>
          <div className="meta" style={{ fontSize: 12 }}>
            Productos + servicios − comisiones − gastos
          </div>
        </div>

        {/* Estado actual (independiente del mes) */}
        <div className="section-title">Estado actual del negocio</div>
        <div className="grid-2">
          <div className="card stat-card">
            <div className="label">Cuentas por cobrar</div>
            <div className="value" style={{ color: 'var(--red)' }}>{money(porCobrar)}</div>
            <div className="meta" style={{ fontSize: 12 }}>Fiado pendiente de clientes</div>
          </div>
          <div className="card stat-card">
            <div className="label">Valor del inventario</div>
            <div className="value">{money(valorInventario)}</div>
            <div className="meta" style={{ fontSize: 12 }}>Existencias a precio de costo</div>
          </div>
        </div>

        {/* Ranking productos */}
        {ranking.length > 0 && (
          <>
            <div className="section-title">Productos que más dejan</div>
            {ranking.slice(0, 5).map((r, i) => (
              <div className="row" key={r.nombre}>
                <div className="main">
                  <div className="title">{i + 1}. {r.nombre}</div>
                  <div className="meta">{r.unidades} unidades vendidas</div>
                </div>
                <div className="right" style={{ fontWeight: 700, color: 'var(--green)' }}>+{money(r.ganancia)}</div>
              </div>
            ))}
          </>
        )}

        {/* Comisiones por trabajador */}
        {trabRanking.length > 0 && (
          <>
            <div className="section-title">Comisiones por trabajar</div>
            {trabRanking.map((t) => (
              <div className="row" key={t.nombre}>
                <div className="main">
                  <div className="title">{t.nombre}</div>
                  <div className="meta">{t.lavados} lavados</div>
                </div>
                <div className="right" style={{ fontWeight: 700, color: 'var(--amber)' }}>{money(t.comision)}</div>
              </div>
            ))}
          </>
        )}

        {v.length === 0 && (gastos || []).length === 0 && (
          <div className="empty">Aún no hay movimientos en {monthLabel(mes)}.<br />Registra ventas en la pestaña Caja.</div>
        )}
      </div>
    </>
  )
}
