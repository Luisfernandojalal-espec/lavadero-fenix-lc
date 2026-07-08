import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, stockBajo, tipoGasto } from '../db'
import { money, currentMonthKey, monthLabel, dayKey } from '../format'
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

// Formato compacto para etiquetas de barras: 57600 → "58k".
const kMoney = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)))

// Buckets de días (últimos n, de más viejo a más nuevo).
function ultimosDias(n) {
  const out = []
  const base = new Date(); base.setHours(0, 0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setDate(base.getDate() - i)
    out.push({ key: dayKey(d.getTime()), label: String(d.getDate()) })
  }
  return out
}
// Lunes de la semana de un timestamp (clave de semana).
function lunesKey(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayKey(d.getTime())
}
function ultimasSemanas(n) {
  const out = []
  const base = new Date(); base.setHours(0, 0, 0, 0)
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7))
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setDate(base.getDate() - i * 7)
    out.push({ key: dayKey(d.getTime()), label: `${d.getDate()}/${d.getMonth() + 1}` })
  }
  return out
}

// Gráfico de barras SVG (sin librerías). data: [{ label, value }].
function BarChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const W = 320, H = 110, gap = 6
  const n = data.length || 1
  const bw = (W - gap * (n + 1)) / n
  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} width="100%" role="img" style={{ display: 'block' }}>
      {data.map((d, i) => {
        const bh = Math.round((d.value / max) * (H - 16))
        const x = gap + i * (bw + gap)
        const y = H - bh
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(bh, 1)} rx="3"
              fill={d.value >= max ? 'var(--green)' : '#93c5fd'} />
            <text x={x + bw / 2} y={y - 4} fontSize="9" textAnchor="middle" fill="var(--muted)">
              {d.value > 0 ? kMoney(d.value) : ''}
            </text>
            <text x={x + bw / 2} y={H + 12} fontSize="9" textAnchor="middle" fill="var(--muted)">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function Reportes() {
  const navigate = useNavigate()
  const [mes, setMes] = useState(currentMonthKey())
  const [periodo, setPeriodo] = useState('mes') // dia | semana | mes (para la tendencia)
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
  const numLavadas = ventasServ.reduce((s, x) => s + (x.cantidad || 1), 0)
  const comisiones = ventasServ.reduce((s, x) => s + (x.comision || 0), 0)
  const gananciaServ = ingresoServ - comisiones

  // --- Gastos ---
  // Los pagos de comisiones (categoría 'comisiones') NO se restan aquí:
  // la comisión ya está descontada del neto de servicios. Restarlos otra
  // vez duplicaría el descuento. (Sí cuentan en el cierre de turno, porque
  // ahí lo que importa es el efectivo que salió de la caja.)
  const gastosMes = (gastos || []).filter((x) => !x.anulada && x.categoria !== 'comisiones')
  const totalGastos = gastosMes.reduce((s, x) => s + x.monto, 0)
  const gastosFijos = gastosMes.filter((x) => tipoGasto(x) === 'fijo').reduce((s, x) => s + x.monto, 0)
  const gastosVariables = totalGastos - gastosFijos

  // --- Utilidad bruta (antes de gastos) y neta ---
  const utilidadBruta = gananciaProd + gananciaServ
  const utilidad = utilidadBruta - totalGastos

  // --- Ticket promedio: total vendido ÷ número de facturas del mes ---
  const ingresoTotal = ingresoProd + ingresoServ
  const numFacturas = new Set(v.map((x) => x.factura).filter((f) => f != null)).size
  const ticketPromedio = numFacturas ? Math.round(ingresoTotal / numFacturas) : 0

  // --- Ventas por servicio (ingreso + cantidad) ---
  const porServicio = {}
  for (const s of ventasServ) {
    const nombre = s.servicioNombre || 'Servicio'
    if (!porServicio[nombre]) porServicio[nombre] = { nombre, cantidad: 0, ingreso: 0 }
    porServicio[nombre].cantidad += (s.cantidad || 1)
    porServicio[nombre].ingreso += s.total || 0
  }
  const servRanking = Object.values(porServicio).sort((a, b) => b.ingreso - a.ingreso)
  const servMasVendidos = Object.values(porServicio).slice().sort((a, b) => b.cantidad - a.cantidad)

  // --- Ventas por lavador (ingreso generado en servicios) ---
  const ventasLavador = {}
  for (const s of ventasServ) {
    const nombre = s.trabajadorNombre || 'Sin asignar'
    if (!ventasLavador[nombre]) ventasLavador[nombre] = { nombre, lavados: 0, ingreso: 0, comision: 0 }
    ventasLavador[nombre].lavados += (s.cantidad || 1)
    ventasLavador[nombre].ingreso += s.total || 0
    ventasLavador[nombre].comision += s.comision || 0
  }
  const lavadorRanking = Object.values(ventasLavador).sort((a, b) => b.ingreso - a.ingreso)

  // --- Tendencia (comparativo por día / semana / mes) sobre TODAS las ventas ---
  const buckets = periodo === 'dia' ? ultimosDias(7)
    : periodo === 'semana' ? ultimasSemanas(8)
      : ultimosMeses(6).slice().reverse().map((k) => ({ key: k, label: monthLabel(k).split(' ')[0].slice(0, 3) }))
  const keyDe = (x) => periodo === 'dia' ? dayKey(x.fecha) : periodo === 'semana' ? lunesKey(x.fecha) : x.mes
  const activas = (todasVentas || []).filter((x) => !x.anulada)
  const trendData = buckets.map((b) => ({
    label: b.label,
    value: activas.filter((x) => keyDe(x) === b.key).reduce((s, x) => s + x.total, 0),
  }))

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

        {/* Ventas por tipo: lavadas (servicios) vs nevera (productos) */}
        <div className="card stat-card">
          <div className="label">Ventas del mes por tipo</div>
          <table className="tabla" style={{ marginTop: 4 }}>
            <tbody>
              <tr>
                <td>Lavadas (servicios)<div className="muted-cell">{numLavadas} {numLavadas === 1 ? 'lavada' : 'lavadas'}</div></td>
                <td className="num" style={{ fontWeight: 700, color: 'var(--green)' }}>{money(ingresoServ)}</td>
              </tr>
              <tr>
                <td>Nevera y mecatos (productos)</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(ingresoProd)}</td>
              </tr>
              <tr>
                <td><b>Total vendido</b></td>
                <td className="num"><b>{money(ingresoTotal)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>

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
          <div className="meta" style={{ fontSize: 12 }}>Fijos {money(gastosFijos)} · Variables {money(gastosVariables)}</div>
        </div>

        {/* Utilidad neta */}
        <div className="card stat-card" style={{ background: utilidad >= 0 ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.10)', borderColor: utilidad >= 0 ? 'var(--green)' : 'var(--red)' }}>
          <div className="label">Utilidad neta del mes</div>
          <div className={`value ${utilidad >= 0 ? 'green' : 'red'}`}>{money(utilidad)}</div>
          <div className="meta" style={{ fontSize: 12 }}>
            Productos + servicios − comisiones − gastos
          </div>
        </div>

        <div className="grid-2">
          <div className="card stat-card">
            <div className="label">Utilidad bruta</div>
            <div className="value">{money(utilidadBruta)}</div>
            <div className="meta" style={{ fontSize: 12 }}>Antes de gastos</div>
          </div>
          <div className="card stat-card">
            <div className="label">Ticket promedio</div>
            <div className="value">{money(ticketPromedio)}</div>
            <div className="meta" style={{ fontSize: 12 }}>{numFacturas} factura{numFacturas === 1 ? '' : 's'}</div>
          </div>
        </div>

        {/* Tendencia de ventas (comparativo por día / semana / mes) */}
        <div className="section-title">Tendencia de ventas</div>
        <div className="pill-row">
          <button className={`pill ${periodo === 'dia' ? 'active' : ''}`} onClick={() => setPeriodo('dia')}>Día</button>
          <button className={`pill ${periodo === 'semana' ? 'active' : ''}`} onClick={() => setPeriodo('semana')}>Semana</button>
          <button className={`pill ${periodo === 'mes' ? 'active' : ''}`} onClick={() => setPeriodo('mes')}>Mes</button>
        </div>
        <div className="card" style={{ padding: '14px 10px 6px' }}>
          <BarChart data={trendData} />
          <div className="meta" style={{ textAlign: 'center', fontSize: 12, marginTop: 4 }}>
            Ventas por {periodo === 'dia' ? 'día (últimos 7)' : periodo === 'semana' ? 'semana (últimas 8)' : 'mes (últimos 6)'}
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

        {/* Ventas por servicio */}
        {servRanking.length > 0 && (
          <>
            <div className="section-title">Ventas por servicio</div>
            {servRanking.slice(0, 6).map((r, i) => (
              <div className="row" key={r.nombre}>
                <div className="main">
                  <div className="title">{i + 1}. {r.nombre}</div>
                  <div className="meta">{r.cantidad} lavada{r.cantidad === 1 ? '' : 's'}</div>
                </div>
                <div className="right" style={{ fontWeight: 700 }}>{money(r.ingreso)}</div>
              </div>
            ))}
            <div className="helper" style={{ marginTop: 6 }}>
              Más vendido: <b>{servMasVendidos[0]?.nombre}</b> ({servMasVendidos[0]?.cantidad} lavadas)
            </div>
          </>
        )}

        {/* Ventas por lavador */}
        {lavadorRanking.length > 0 && (
          <>
            <div className="section-title">Ventas por lavador</div>
            {lavadorRanking.map((t) => (
              <div className="row" key={t.nombre}>
                <div className="main">
                  <div className="title">{t.nombre}</div>
                  <div className="meta">{t.lavados} lavados · comisión {money(t.comision)}</div>
                </div>
                <div className="right" style={{ fontWeight: 700 }}>{money(t.ingreso)}</div>
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
