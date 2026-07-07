import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// Formato de dinero simple para el PDF (evita espacios especiales que
// algunas fuentes del PDF no dibujan bien).
function m(n) {
  return '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO')
}

// Carga el logo como dataURL para incrustarlo en el PDF.
async function logoDataUrl() {
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'logo.jpg')
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const AZUL = [14, 165, 233]
const OSCURO = [15, 23, 42]
const GRIS = [100, 116, 139]

export async function descargarReportePDF(d) {
  const doc = await construirReporte(d)
  doc.save(`Reporte ${d.mesLabel}.pdf`)
}

// ---------- PDF del cierre de turno ----------
function fh(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export async function descargarCierrePDF(t) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 40

  const logo = await logoDataUrl()
  if (logo) { try { doc.addImage(logo, 'JPEG', margin, 34, 56, 56) } catch { /* ignora */ } }
  const x = margin + (logo ? 70 : 0)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...OSCURO)
  doc.text('LAVADERO FÉNIX LC', x, 52)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRIS)
  doc.text('Villa Caribe', x, 68)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...AZUL)
  doc.text('Cierre de turno', x, 86)
  doc.setDrawColor(226, 232, 240)
  doc.line(margin, 100, W - margin, 100)

  const r = t.resumen || {}
  const dif = r.diferencia || 0
  autoTable(doc, {
    startY: 112,
    head: [['Concepto', 'Valor']],
    body: [
      ['Apertura', `${fh(t.abiertoEn)} — ${t.abiertoPor || ''}`],
      ['Cierre', `${fh(t.cerradoEn)} — ${t.cerradoPor || ''}`],
      ['Base efectivo (apertura)', m(t.base)],
      ['Ventas en efectivo', m(r.contado)],
      ['Abonos recibidos', m(r.abonos)],
      ['Gastos pagados', '- ' + m(r.gastos).slice(2)],
      ['EFECTIVO ESPERADO EN CAJA', m(r.esperado)],
      ['Efectivo contado', m(r.contadoReal)],
      [dif === 0 ? 'CAJA CUADRADA' : dif > 0 ? 'SOBRANTE' : 'FALTANTE', m(Math.abs(dif))],
      ['Base transferencia (apertura)', m(t.baseTransferencia || 0)],
      ['Ventas por transferencia (al banco)', m(r.transferencias || 0)],
      ['Total en transferencia (banco)', m((t.baseTransferencia || 0) + (r.transferencias || 0))],
      ['Ventas a crédito (fiado)', m(r.credito)],
      ['Número de ventas del turno', String(r.ventasCount ?? '')],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: AZUL, halign: 'left' },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: (data) => {
      const c = data.row.raw[0]
      if (c === 'EFECTIVO ESPERADO EN CAJA') data.cell.styles.fontStyle = 'bold'
      if (c === 'CAJA CUADRADA') data.cell.styles.textColor = [22, 163, 74]
      if (c === 'SOBRANTE') data.cell.styles.textColor = [217, 119, 6]
      if (c === 'FALTANTE') { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold' }
      if (data.column.index === 0 && !['Apertura', 'Cierre'].includes(c)) data.cell.styles.fontStyle ||= 'bold'
    },
  })

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS)
  doc.text('Generado por Lavadero Fénix LC · Sistema POS', margin, doc.internal.pageSize.getHeight() - 24)

  const dfecha = new Date(t.cerradoEn)
  const p = (n) => String(n).padStart(2, '0')
  doc.save(`Cierre_${dfecha.getFullYear()}-${p(dfecha.getMonth() + 1)}-${p(dfecha.getDate())}_${p(dfecha.getHours())}${p(dfecha.getMinutes())}.pdf`)
}

// Devuelve una URL para previsualizar el PDF (usada en pruebas).
export async function reportePDFBlobUrl(d) {
  const doc = await construirReporte(d)
  return doc.output('bloburl')
}

async function construirReporte(d) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 40

  // --- Encabezado con logo ---
  const logo = await logoDataUrl()
  if (logo) {
    try { doc.addImage(logo, 'JPEG', margin, 34, 56, 56) } catch { /* ignora */ }
  }
  const x = margin + (logo ? 70 : 0)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...OSCURO)
  doc.text('LAVADERO FÉNIX LC', x, 52)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRIS)
  doc.text('Villa Caribe', x, 68)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...AZUL)
  doc.text(`Reporte de ${d.mesLabel}`, x, 86)

  doc.setDrawColor(226, 232, 240)
  doc.line(margin, 100, W - margin, 100)

  // --- Resumen ---
  autoTable(doc, {
    startY: 112,
    head: [['Resumen del mes', 'Monto']],
    body: [
      ['Ganancia de productos (nevera y mecatos)', m(d.gananciaProd)],
      ['   Vendido en productos', m(d.ingresoProd)],
      ['   Costo de esos productos', m(d.costoProd)],
      ['Servicios (neto, ya sin comisiones)', m(d.gananciaServ)],
      ['   Vendido en servicios', m(d.ingresoServ)],
      ['Comisiones a trabajadores', m(d.comisiones)],
      ['Gastos del mes', m(d.totalGastos)],
      ['UTILIDAD NETA DEL MES', m(d.utilidad)],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: AZUL, halign: 'left' },
    columnStyles: { 1: { halign: 'right', cellWidth: 140 } },
    didParseCell: (data) => {
      const t = data.row.raw[0]
      if (t === 'UTILIDAD NETA DEL MES') {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fontSize = 12
        data.cell.styles.textColor = d.utilidad >= 0 ? [22, 163, 74] : [220, 38, 38]
      } else if (t.startsWith('   ')) {
        data.cell.styles.textColor = GRIS
        data.cell.styles.fontSize = 9
      } else if (data.column.index === 0) {
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  // --- Estado actual del negocio ---
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 20,
    head: [['Estado actual del negocio', 'Valor']],
    body: [
      ['Cuentas por cobrar (fiado pendiente)', m(d.porCobrar || 0)],
      ['Valor del inventario (a costo)', m(d.valorInventario || 0)],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: AZUL },
    columnStyles: { 1: { halign: 'right', cellWidth: 140 } },
  })

  // --- Ranking de productos ---
  if (d.ranking && d.ranking.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 20,
      head: [['Producto que más deja', 'Unidades', 'Ganancia']],
      body: d.ranking.map((r) => [r.nombre, String(r.unidades), m(r.ganancia)]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: AZUL },
      columnStyles: { 1: { halign: 'center', cellWidth: 80 }, 2: { halign: 'right', cellWidth: 110 } },
    })
  }

  // --- Comisiones por trabajador ---
  if (d.trabRanking && d.trabRanking.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 20,
      head: [['Trabajador', 'Lavados', 'Comisión a pagar']],
      body: d.trabRanking.map((t) => [t.nombre, String(t.lavados), m(t.comision)]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: AZUL },
      columnStyles: { 1: { halign: 'center', cellWidth: 80 }, 2: { halign: 'right', cellWidth: 130 } },
    })
  }

  // --- Detalle de gastos ---
  if (d.gastos && d.gastos.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 20,
      head: [['Gasto', 'Monto']],
      body: d.gastos.map((g) => [g.concepto, m(g.monto)]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [217, 119, 6] },
      columnStyles: { 1: { halign: 'right', cellWidth: 140 } },
    })
  }

  // --- Pie ---
  const hoy = new Date()
  const fecha = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS)
  doc.text(`Generado el ${fecha} · Lavadero Fénix LC`, margin, doc.internal.pageSize.getHeight() - 24)

  return doc
}
