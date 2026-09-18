import { useState, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, stamp, gastoMontoCaja, gastoMontoTransfer, labelMedioGasto, medioPagoGasto, cuadreTurno } from '../db'
import { money, monthKey, shortDate } from '../format'
import { Header, Sheet, useToast, MoneyInput } from '../components/ui'
import { descargarCierrePDF } from '../pdf'
import { montoEfectivo, montoTransferencia } from '../ventas'
import { useAuth } from '../auth'

export default function Turno() {
  const { user } = useAuth()
  const { show, node } = useToast()
  const esDueno = user?.rol === 'dueño'

  const turnos = useLiveQuery(() => db.turnos.toArray(), [], [])
  const ventas = useLiveQuery(() => db.ventas.toArray(), [], [])
  const abonos = useLiveQuery(() => db.abonos.toArray(), [], [])
  const gastos = useLiveQuery(() => db.gastos.toArray(), [], [])
  const mesas = useLiveQuery(() => db.mesas.where('activo').equals(1).toArray(), [], [])

  const abierto = (turnos || []).find((t) => t.estado === 'abierto' && !t.anulada)
  const cerrados = (turnos || []).filter((t) => t.estado === 'cerrado' && !t.anulada).sort((a, b) => b.cerradoEn - a.cerradoEn)
  // Cierres borrados (borrado suave): se pueden restaurar si fue por error.
  const eliminados = (turnos || []).filter((t) => t.estado === 'cerrado' && t.anulada).sort((a, b) => b.cerradoEn - a.cerradoEn)
  const mesasAbiertas = (mesas || []).filter((m) => m.estado === 'ocupada')

  // Resumen en vivo del turno abierto: MISMA función que el cuadre de un
  // cierre, para que no puedan separarse nunca (antes eran dos copias).
  const cuadre = cuadreTurno({ turno: abierto, ventas: ventas || [], abonos: abonos || [], gastos: gastos || [] })
  const efectivoV = (ventas || []).filter((v) => !v.anulada && v.fecha >= (abierto?.abiertoEn || 0) && montoEfectivo(v) > 0)
  const efectivo = cuadre.contado
  const transferencias = cuadre.transferencias
  const credito = cuadre.credito
  const abonosT = cuadre.abonos
  const abonosTransferT = cuadre.abonosTransfer
  const salidasT = cuadre.salidasLista
  const gastosT = cuadre.gastos
  const gastosTransferT = cuadre.gastosTransfer
  const esperado = cuadre.esperado
  const baseTransferAbierto = abierto?.baseTransferencia || 0
  const totalTransfer = cuadre.totalTransfer
  const vTurno = { length: cuadre.ventasCount }

  // --- Abrir turno ---
  const [abrirOpen, setAbrirOpen] = useState(false)
  const [base, setBase] = useState(0)                 // efectivo con el que se abre
  const [baseTransfer, setBaseTransfer] = useState(0) // transferencia/banco con la que se abre
  const guardandoRef = useRef(false) // candado anti-doble-toque para los .add
  async function abrirTurno() {
    if (guardandoRef.current) return
    guardandoRef.current = true
    try {
    // Evita dos turnos abiertos (ej. otro dispositivo lo abrió hace un momento)
    const yaAbierto = (await db.turnos.toArray()).some((t) => t.estado === 'abierto')
    if (yaAbierto) { setAbrirOpen(false); return show('Ya hay un turno abierto') }
    const now = Date.now()
    await db.turnos.add(stamp({
      id: uid(), estado: 'abierto', mes: monthKey(now),
      abiertoEn: now, abiertoPor: user?.nombre || '', base, baseTransferencia: baseTransfer,
    }))
    setAbrirOpen(false); setBase(0); setBaseTransfer(0)
    show('Turno abierto')
    } finally { guardandoRef.current = false }
  }

  // --- Editar la apertura de un turno YA abierto (ajustar bases sin cerrarlo) ---
  const [editApOpen, setEditApOpen] = useState(false)
  function abrirEditarApertura() {
    setBase(abierto.base || 0)
    setBaseTransfer(abierto.baseTransferencia || 0)
    setEditApOpen(true)
  }
  async function guardarApertura() {
    await db.turnos.update(abierto.id, stamp({ base, baseTransferencia: baseTransfer }))
    setEditApOpen(false)
    show('Apertura del turno actualizada')
  }

  // --- Registrar / editar una salida / pago del turno (ej. pagos por Nequi) ---
  const [salidaOpen, setSalidaOpen] = useState(false)
  const [salEditId, setSalEditId] = useState(null) // null = nueva; id = editando
  const [salConcepto, setSalConcepto] = useState('')
  const [salMonto, setSalMonto] = useState(0)
  const [salMedio, setSalMedio] = useState('transferencia') // Nequi por defecto (el caso del cliente)
  const [salEfectivo, setSalEfectivo] = useState(0) // parte en efectivo cuando el medio es 'mixto'
  // 'gasto' = pago del negocio (cuenta como gasto). 'retiro' = plata que el
  // dueño/socios sacan de la caja: SÍ sale del turno pero NO es un gasto del
  // negocio (no resta de la utilidad ni suma a "gastos variables").
  const [salTipo, setSalTipo] = useState('gasto')
  function nuevaSalida() { setSalEditId(null); setSalConcepto(''); setSalMonto(0); setSalMedio('transferencia'); setSalEfectivo(0); setSalTipo('gasto'); setSalidaOpen(true) }
  function editarSalida(g) { setSalEditId(g.id); setSalConcepto(g.concepto || ''); setSalMonto(g.monto || 0); setSalMedio(g.medioPago || 'transferencia'); setSalEfectivo(g.pagoEfectivo || 0); setSalTipo(g.categoria === 'retiro' ? 'retiro' : 'gasto'); setSalidaOpen(true) }
  async function guardarSalida() {
    if (!salConcepto.trim()) return show(salTipo === 'retiro' ? 'Escribe de qué es el retiro' : 'Escribe qué se pagó')
    if (salMonto <= 0) return show('Escribe el valor')
    if (guardandoRef.current) return
    guardandoRef.current = true
    try {
      const mp = medioPagoGasto(salMedio, salMonto, salEfectivo) // arma medioPago (+ split si es mixto)
      const categoria = salTipo === 'retiro' ? 'retiro' : 'otro'
      if (salEditId) {
        await db.gastos.update(salEditId, stamp({ concepto: salConcepto.trim(), monto: salMonto, categoria, ...mp }))
        show('Salida actualizada')
      } else {
        const now = Date.now()
        await db.gastos.add(stamp({
          id: uid(), concepto: salConcepto.trim(), categoria, monto: salMonto,
          tipo: 'variable', ...mp, responsable: user?.nombre || '',
          salidaTurno: 1, // salió de la caja/transferencia de ESTE turno
          fecha: now, mes: monthKey(now),
        }))
        show(salTipo === 'retiro' ? 'Retiro registrado' : 'Salida registrada')
      }
      setSalidaOpen(false)
    } finally { guardandoRef.current = false }
  }
  async function eliminarSalida() {
    if (!salEditId) return
    await db.gastos.update(salEditId, stamp({ anulada: 1 }))
    setSalidaOpen(false)
    show('Salida eliminada')
  }

  // --- Cerrar turno ---
  const [cerrarOpen, setCerrarOpen] = useState(false)
  const [contadoReal, setContadoReal] = useState(0)
  // Transferencia contada al cierre (lo que de verdad muestra el Nequi/banco).
  // Arranca PRE-LLENADA con lo esperado: si el cajero no revisa el Nequi no se
  // inventa un faltante (la lección del cierre con efectivo $0); si lo revisa y
  // hay otra cifra, la corrige y queda el descuadre de transferencia registrado.
  const [contadoTransfer, setContadoTransfer] = useState(0)
  async function cerrarTurno() {
    const diferencia = contadoReal - esperado
    const diferenciaTransfer = contadoTransfer - totalTransfer
    const cerrado = {
      estado: 'cerrado', cerradoEn: Date.now(), cerradoPor: user?.nombre || '',
      resumen: {
        contado: efectivo, transferencias, credito, abonos: abonosT, abonosTransfer: abonosTransferT, gastos: gastosT,
        gastosTransfer: gastosTransferT, totalTransfer,
        esperado, contadoReal, diferencia, contadoTransfer, diferenciaTransfer, ventasCount: vTurno.length,
      },
    }
    await db.turnos.update(abierto.id, stamp(cerrado))
    setCerrarOpen(false); setContadoReal(0); setContadoTransfer(0)
    show(diferencia === 0 ? 'Turno cerrado · caja cuadrada' : 'Turno cerrado')
    // Descarga automática del comprobante
    descargarCierrePDF({ ...abierto, ...cerrado })
  }

  // Detalle de un cierre anterior
  const [det, setDet] = useState(null)
  // Corregir / eliminar un cierre ya hecho (solo dueño). Sirve para el caso de
  // cerrar el turno sin teclear el efectivo contado (aparece "Faltó $X") o para
  // borrar un turno creado por error (ej. uno repetido para "arreglar" el otro).
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [contadoEdit, setContadoEdit] = useState(0)
  const [contadoTransferEdit, setContadoTransferEdit] = useState(0)
  function abrirDetalle(t) { setCorrigiendo(false); setConfirmDel(false); setDet(t) }
  async function guardarCorreccion() {
    if (!det) return
    const nuevoResumen = { ...(det.resumen || {}), contadoReal: contadoEdit, contadoTransfer: contadoTransferEdit }
    await db.turnos.update(det.id, stamp({ resumen: nuevoResumen }))
    setDet({ ...det, resumen: nuevoResumen }) // refresca el sheet abierto
    setCorrigiendo(false)
    show('Conteo del cierre corregido')
  }
  async function eliminarCierre() {
    if (!det) return
    await db.turnos.update(det.id, stamp({ anulada: 1 })) // borrado suave (se propaga por sync)
    setConfirmDel(false); setDet(null)
    show('Cierre eliminado · puedes restaurarlo abajo')
  }
  // Devuelve a la lista un cierre borrado por error (quita la marca de anulado).
  async function restaurarCierre(t) {
    await db.turnos.update(t.id, stamp({ anulada: 0 }))
    show('Cierre restaurado')
  }

  // --- Reabrir un turno ya cerrado ---
  // Caso real: se cierra el turno y después aparecen pagos mal registrados. Antes
  // no había forma de volver atrás: el único botón era "Eliminar este cierre", y
  // el dueño lo usó pensando que así se reabría (y perdió el cuadre).
  // OJO con el rango: un turno abierto cuenta TODO lo que pase desde `abiertoEn`
  // sin tope, así que reabrir uno viejo se tragaría las ventas de los días
  // siguientes. Por eso solo se permite reabrir el ÚLTIMO cierre y se avisa si no
  // es de hoy.
  const [confirmReabrir, setConfirmReabrir] = useState(false)
  async function reabrirTurno() {
    if (!det) return
    // No pueden existir dos turnos abiertos: el resumen en vivo toma el primero.
    const yaAbierto = (await db.turnos.toArray()).some((t) => t.estado === 'abierto' && !t.anulada)
    if (yaAbierto) { setConfirmReabrir(false); return show('Ya hay un turno abierto. Ciérralo antes de reabrir este.') }
    await db.turnos.update(det.id, stamp({ estado: 'abierto', cerradoEn: null, cerradoPor: null }))
    setConfirmReabrir(false); setDet(null)
    show('Turno reabierto · corrige lo que falte y ciérralo otra vez')
  }

  const difColor = (d) => (d === 0 ? 'var(--green)' : d > 0 ? 'var(--amber)' : 'var(--red)')

  // Recalcula el cuadre de un turno YA cerrado con los DATOS ACTUALES (mismas
  // fórmulas del cierre en vivo), acotado a su rango [abiertoEn, cerradoEn].
  // Así, si después se corrige un abono / gasto / venta, el comprobante de esa
  // noche se ajusta. El "efectivo contado" (contadoReal) NO se recalcula: fue un
  // conteo físico manual, se conserva del cierre. La diferencia se recalcula con
  // el esperado nuevo. (Solo cambia lo que se muestra; no se reescribe el turno.)
  function cuadreCerrado(t) {
    return cuadreTurno({ turno: t, ventas: ventas || [], abonos: abonos || [], gastos: gastos || [] })
  }

  return (
    <>
      <Header title="Turno" sub="Apertura y cierre de caja" />
      <div className="content">

        {!abierto && (
          <>
            <div className="empty" style={{ paddingBottom: 12 }}>No hay un turno abierto.</div>
            <button className="btn" onClick={() => { setBase(0); setBaseTransfer(0); setAbrirOpen(true) }}>Abrir turno</button>
          </>
        )}

        {abierto && (
          <>
            <div className="dato-fuerte">
              Turno abierto por <b>{abierto.abiertoPor}</b> · {shortDate(abierto.abiertoEn)}
            </div>

            {/* Antes esto era UNA tabla de 10 filas donde se mezclaban la caja y
                el Nequi, y los dos números que importan quedaban enterrados en
                la mitad. Ahora es un bloque por "bolsillo": primero la cifra
                grande (lo que tiene que haber) y debajo, en letra chica, de
                dónde sale. En el celular se lee de un vistazo. */}
            <div className="arqueo">
              {/* El rótulo va COMPLETO ("Efectivo esperado en caja"): al resumirlo
                  a "Efectivo · caja" el dueño dejó de reconocer la cifra que
                  llevaba años buscando y creyó que se había quitado.
                  Y el desglose muestra TODAS las líneas aunque vayan en cero,
                  para poder seguir la cuenta completa: base + ventas + abonos
                  − gastos = lo esperado. */}
              <section className="bolsillo">
                <div className="bolsillo-head">
                  <span className="bolsillo-tag">Efectivo esperado en caja</span>
                </div>
                <div className="bolsillo-cifra">{money(esperado)}</div>
                <div className="bolsillo-pie">lo que debe haber en el cajón ahora mismo</div>
                <dl className="desglose">
                  <div><dt>Base efectivo (apertura)</dt><dd>{money(abierto.base)}</dd></div>
                  <div><dt>Ventas en efectivo <em>({efectivoV.length})</em></dt><dd className="mas">+{money(efectivo)}</dd></div>
                  <div><dt>Abonos recibidos (efectivo)</dt><dd className="mas">+{money(abonosT)}</dd></div>
                  <div><dt>Gastos pagados de caja</dt><dd className="menos">−{money(gastosT)}</dd></div>
                  <div className="total"><dt>Efectivo esperado en caja</dt><dd>{money(esperado)}</dd></div>
                </dl>
              </section>

              <section className="bolsillo">
                <div className="bolsillo-head">
                  <span className="bolsillo-tag">Debe quedar en transferencia</span>
                </div>
                <div className="bolsillo-cifra">{money(totalTransfer)}</div>
                <div className="bolsillo-pie">lo que debe haber en el Nequi / banco</div>
                <dl className="desglose">
                  <div><dt>Base transferencia (apertura)</dt><dd>{money(baseTransferAbierto)}</dd></div>
                  <div><dt>Ventas por transferencia</dt><dd className="mas">+{money(transferencias)}</dd></div>
                  <div><dt>Abonos por transferencia</dt><dd className="mas">+{money(abonosTransferT)}</dd></div>
                  <div><dt>Pagos por transferencia (Nequi)</dt><dd className="menos">−{money(gastosTransferT)}</dd></div>
                  <div className="total"><dt>Debe quedar en transferencia</dt><dd>{money(totalTransfer)}</dd></div>
                </dl>
              </section>
            </div>

            {credito > 0 && (
              <div className="nota-credito">
                <span>Ventas a crédito (fiado)</span>
                <b>{money(credito)}</b>
                <small>No entra al arqueo: esa plata no ha llegado.</small>
              </div>
            )}

            {mesasAbiertas.length > 0 && (
              <div className="helper" style={{ color: 'var(--amber)', margin: '10px 0' }}>
                Atención: hay {mesasAbiertas.length} {mesasAbiertas.length === 1 ? 'mesa abierta' : 'mesas abiertas'} sin cobrar.
              </div>
            )}

            {esDueno && (
              <div className="acciones-turno">
                <button className="btn secondary" onClick={nuevaSalida}>Registrar salida o pago</button>
                <button className="btn secondary" onClick={abrirEditarApertura}>Editar apertura</button>
              </div>
            )}

            {salidasT.length > 0 && (
              <>
                <div className="section-title">Salidas del turno</div>
                <div className="helper" style={{ marginTop: -4, marginBottom: 8 }}>
                  Lo que salió de la caja o del Nequi de este turno.{esDueno ? ' Toca una salida para corregirla.' : ''}
                </div>
                <table className="tabla">
                  <tbody>
                    {salidasT.slice(0, 20).map((g) => {
                      const esInventario = g.categoria === 'inventario'
                      const esPrestamo = g.categoria === 'prestamo'
                      const editable = esDueno && g.categoria !== 'comisiones' && !esInventario && !esPrestamo
                      const medioTxt = g.medioPago === 'mixto'
                        ? `Mixto (ef ${money(gastoMontoCaja(g))} · tr ${money(gastoMontoTransfer(g))})`
                        : labelMedioGasto(g.medioPago)
                      const esRetiro = g.categoria === 'retiro'
                      return (
                        <tr key={g.id} onClick={editable ? () => editarSalida(g) : undefined} style={editable ? { cursor: 'pointer' } : undefined}>
                          <td>{g.concepto || 'Salida'}{esRetiro ? <span className="badge" style={{ marginLeft: 6, background: 'rgba(37,99,235,.12)', color: 'var(--primary)' }}>Retiro</span> : ''}<div className="muted-cell">{medioTxt}{g.responsable ? ' · ' + g.responsable : ''}{esInventario ? ' · edítala en la factura de entrada' : esPrestamo ? ' · edítalo en Créditos' : (editable ? ' · toca para editar' : '')}</div></td>
                          <td className="num" style={{ color: 'var(--red)', fontWeight: 700, whiteSpace: 'nowrap' }}>−{money(g.monto)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}

            <button className="btn btn-cerrar" style={{ marginTop: 16 }} onClick={() => { setContadoReal(0); setContadoTransfer(totalTransfer); setCerrarOpen(true) }}>
              Cerrar turno
            </button>
          </>
        )}

        {esDueno && cerrados.length > 0 && (
          <>
            <div className="section-title">Cierres anteriores</div>
            {cerrados.slice(0, 20).map((t) => {
              const r = cuadreCerrado(t)
              return (
                <div className="row" key={t.id} onClick={() => abrirDetalle(t)} style={{ cursor: 'pointer' }}>
                  <div className="main">
                    <div className="title">{shortDate(t.cerradoEn)}</div>
                    <div className="meta">{t.abiertoPor} → {t.cerradoPor} · {r.ventasCount} ventas</div>
                  </div>
                  <div className="right">
                    <div style={{ fontWeight: 700 }}>{money(r.contadoReal)}</div>
                    <div className="meta" style={{ color: difColor(r.diferencia) }}>
                      {r.diferencia === 0 ? 'Cuadrada' :
                        (r.diferencia > 0 ? `Sobró ${money(r.diferencia)}` : `Faltó ${money(-r.diferencia)}`)}
                    </div>
                    {r.diferenciaTransfer != null && r.diferenciaTransfer !== 0 && (
                      <div className="meta" style={{ color: difColor(r.diferenciaTransfer) }}>
                        {r.diferenciaTransfer > 0 ? `Nequi: sobró ${money(r.diferenciaTransfer)}` : `Nequi: faltó ${money(-r.diferenciaTransfer)}`}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* Cierres eliminados: el borrado es SUAVE (anulada:1), así que un
            cierre borrado por error se puede devolver tal cual estaba. */}
        {esDueno && eliminados.length > 0 && (
          <>
            <div className="section-title">Cierres eliminados</div>
            <div className="helper" style={{ marginTop: -4, marginBottom: 6 }}>
              Los cierres que borraste quedan aquí por si fue por error. Restaurar lo devuelve a la lista con sus mismos datos.
            </div>
            {eliminados.slice(0, 10).map((t) => {
              const r = cuadreCerrado(t)
              return (
                <div className="row" key={t.id}>
                  <div className="main">
                    <div className="title">{shortDate(t.cerradoEn)}</div>
                    <div className="meta">{t.abiertoPor} → {t.cerradoPor} · {r.ventasCount} ventas · {money(r.contadoReal)}</div>
                  </div>
                  <div className="right">
                    <button className="chip-lavador" onClick={() => restaurarCierre(t)}>Restaurar</button>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Registrar salida / pago del turno */}
      <Sheet open={salidaOpen} onClose={() => setSalidaOpen(false)} title={salEditId ? 'Editar salida' : 'Registrar salida / pago'}>
        <label>¿Qué es?</label>
        <div className="pill-row">
          <button className={`pill ${salTipo === 'gasto' ? 'active' : ''}`} onClick={() => setSalTipo('gasto')}>Gasto del negocio</button>
          <button className={`pill ${salTipo === 'retiro' ? 'active' : ''}`} onClick={() => setSalTipo('retiro')}>Retiro (plata para ti)</button>
        </div>
        <div className="helper" style={{ marginBottom: 8 }}>
          {salTipo === 'retiro'
            ? 'Plata que sacas de la caja para ti o los socios. Sale del turno pero NO es un gasto (no baja la utilidad del negocio).'
            : 'Un pago del negocio (recarga, domicilio, insumo, factura…). Se descuenta de la caja y cuenta como gasto.'}
        </div>
        {!salEditId && salTipo === 'gasto' && (
          <div className="helper" style={{ marginBottom: 8, color: 'var(--amber)' }}>
            Si es una compra de productos para vender (cerveza, gaseosa, mecatos…), NO la registres aquí: hazla en Inventario → Factura de entrada, que descuenta la plata del turno y suma el stock. Registrarla en los dos lados la cuenta doble.
          </div>
        )}
        <label>{salTipo === 'retiro' ? '¿De qué es el retiro?' : '¿Qué se pagó?'}</label>
        <input value={salConcepto} placeholder={salTipo === 'retiro' ? 'Ej: Retiro para mí, gasto personal…' : 'Ej: Pago factura proveedor, recarga…'}
          onChange={(e) => setSalConcepto(e.target.value)} />
        <label>Valor</label>
        <MoneyInput value={salMonto} onChange={setSalMonto} />
        <label>¿De dónde salió?</label>
        <div className="pill-row">
          <button className={`pill ${salMedio === 'transferencia' ? 'active' : ''}`} onClick={() => setSalMedio('transferencia')}>Transferencia (Nequi)</button>
          <button className={`pill ${salMedio === 'caja' ? 'active' : ''}`} onClick={() => setSalMedio('caja')}>Efectivo (caja)</button>
          <button className={`pill ${salMedio === 'mixto' ? 'active' : ''}`} onClick={() => setSalMedio('mixto')}>Mixto</button>
        </div>
        {salMedio === 'mixto' && (
          <>
            <label>¿Cuánto en efectivo?</label>
            <MoneyInput value={salEfectivo} onChange={setSalEfectivo} />
            <div className="helper">Va por transferencia (Nequi): <b>{money(Math.max(0, salMonto - Math.min(salEfectivo, salMonto)))}</b></div>
          </>
        )}
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarSalida}>{salEditId ? 'Guardar cambios' : 'Registrar salida'}</button>
        {salEditId && <><div style={{ height: 10 }} /><button className="btn danger" onClick={eliminarSalida}>Eliminar salida</button></>}
      </Sheet>

      {/* Abrir turno */}
      <Sheet open={abrirOpen} onClose={() => setAbrirOpen(false)} title="Abrir turno">
        <label>Efectivo con el que abres</label>
        <MoneyInput value={base} onChange={setBase} />
        <div className="helper">El efectivo que hay en la caja al empezar el turno.</div>
        <label>Transferencia con la que abres (banco)</label>
        <MoneyInput value={baseTransfer} onChange={setBaseTransfer} />
        <div className="helper">Saldo inicial en transferencia / banco. Opcional.</div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={abrirTurno}>Abrir turno</button>
      </Sheet>

      {/* Editar apertura del turno ya abierto (ajusta bases sin cerrarlo) */}
      <Sheet open={editApOpen} onClose={() => setEditApOpen(false)} title="Editar apertura del turno">
        <label>Efectivo con el que abriste</label>
        <MoneyInput value={base} onChange={setBase} />
        <label>Transferencia con la que abriste (banco)</label>
        <MoneyInput value={baseTransfer} onChange={setBaseTransfer} />
        <div className="helper">Ajusta las bases del turno abierto. No cambia las ventas ya registradas; solo recalcula el efectivo esperado y el total en transferencia.</div>
        <div style={{ height: 14 }} />
        <button className="btn" onClick={guardarApertura}>Guardar</button>
      </Sheet>

      {/* Cerrar turno */}
      <Sheet open={cerrarOpen} onClose={() => setCerrarOpen(false)} title="Cerrar turno">
        <div className="dato-fuerte">Efectivo esperado: <b>{money(esperado)}</b></div>
        <label>Efectivo contado (lo que hay realmente en caja)</label>
        <MoneyInput value={contadoReal} onChange={setContadoReal} />
        {contadoReal > 0 && (
          <div className="helper" style={{ marginTop: 8, fontSize: 14, color: difColor(contadoReal - esperado) }}>
            {contadoReal - esperado === 0 ? 'Caja cuadrada.' :
              contadoReal - esperado > 0 ? `Sobrante de ${money(contadoReal - esperado)}` :
                `Faltante de ${money(esperado - contadoReal)}`}
          </div>
        )}
        <div className="dato-fuerte" style={{ marginTop: 12 }}>Debe quedar en transferencia: <b>{money(totalTransfer)}</b></div>
        <label>Transferencia contada (lo que muestra el Nequi / banco)</label>
        <MoneyInput value={contadoTransfer} onChange={setContadoTransfer} />
        <div className="helper">Ya viene con lo que debería haber. Si el Nequi muestra otra cifra, corrígela aquí y el descuadre queda registrado.</div>
        {contadoTransfer !== totalTransfer && (
          <div className="helper" style={{ marginTop: 4, fontSize: 14, color: difColor(contadoTransfer - totalTransfer) }}>
            {contadoTransfer - totalTransfer > 0
              ? `Sobrante en transferencia de ${money(contadoTransfer - totalTransfer)}`
              : `Faltante en transferencia de ${money(totalTransfer - contadoTransfer)}`}
          </div>
        )}
        {mesasAbiertas.length > 0 && (
          <div className="helper" style={{ color: 'var(--amber)', marginTop: 8 }}>
            Hay {mesasAbiertas.length} {mesasAbiertas.length === 1 ? 'mesa abierta' : 'mesas abiertas'}. Se recomienda cobrarlas antes de cerrar.
          </div>
        )}
        <div style={{ height: 14 }} />
        <button className="btn" onClick={cerrarTurno}>Confirmar cierre</button>
        <div className="helper" style={{ textAlign: 'center', marginTop: 6 }}>Se descarga el comprobante en PDF.</div>
      </Sheet>

      {/* Detalle de cierre anterior */}
      <Sheet open={!!det} onClose={() => setDet(null)} title={det ? `Cierre · ${shortDate(det.cerradoEn)}` : ''}>
        {det && (() => {
          const r = cuadreCerrado(det)
          return (
            <>
              {/* Mismo criterio que el turno abierto: primero el VEREDICTO de cada
                  bolsillo (que es lo que se busca al abrir un cierre) y debajo,
                  en chico, de dónde salen las cifras. Antes eran 17 filas con la
                  caja y el Nequi entreveradas. */}
              <div className="cierre-meta">
                <div><span>Apertura</span><b>{shortDate(det.abiertoEn)}</b><em>{det.abiertoPor}</em></div>
                <div><span>Cierre</span><b>{shortDate(det.cerradoEn)}</b><em>{det.cerradoPor}</em></div>
              </div>

              <div className="arqueo">
                <section className="bolsillo">
                  <div className="bolsillo-head"><span className="bolsillo-tag">Efectivo · caja</span></div>
                  <div className="veredicto" style={{ color: difColor(r.diferencia) }}>
                    {r.diferencia === 0 ? 'Caja cuadrada'
                      : (r.diferencia > 0 ? `Sobró ${money(r.diferencia)}` : `Faltó ${money(-r.diferencia)}`)}
                  </div>
                  <dl className="desglose destacado">
                    <div><dt>Efectivo esperado en caja</dt><dd>{money(r.esperado)}</dd></div>
                    <div><dt>Efectivo contado</dt><dd>{money(r.contadoReal)}</dd></div>
                  </dl>
                  <dl className="desglose">
                    <div><dt>Base de apertura</dt><dd>{money(det.base)}</dd></div>
                    <div><dt>Ventas en efectivo</dt><dd className="mas">+{money(r.contado)}</dd></div>
                    <div><dt>Abonos recibidos (efectivo)</dt><dd className="mas">+{money(r.abonos)}</dd></div>
                    <div><dt>Gastos pagados</dt><dd className="menos">−{money(r.gastos)}</dd></div>
                  </dl>
                </section>

                <section className="bolsillo">
                  <div className="bolsillo-head"><span className="bolsillo-tag">Transferencia · Nequi</span></div>
                  {r.contadoTransfer != null ? (
                    <>
                      <div className="veredicto" style={{ color: difColor(r.diferenciaTransfer) }}>
                        {r.diferenciaTransfer === 0 ? 'Nequi cuadrado'
                          : (r.diferenciaTransfer > 0 ? `Sobró ${money(r.diferenciaTransfer)}` : `Faltó ${money(-r.diferenciaTransfer)}`)}
                      </div>
                      <dl className="desglose destacado">
                        <div><dt>Debe quedar en transferencia</dt><dd>{money(r.totalTransfer)}</dd></div>
                        <div><dt>Transferencia contada</dt><dd>{money(r.contadoTransfer)}</dd></div>
                      </dl>
                    </>
                  ) : (
                    <>
                      <div className="bolsillo-cifra">{money(r.totalTransfer)}</div>
                      <div className="bolsillo-pie">debía quedar en el banco · no se contó al cerrar</div>
                    </>
                  )}
                  <dl className="desglose">
                    <div><dt>Base de apertura</dt><dd>{money(det.baseTransferencia || 0)}</dd></div>
                    <div><dt>Ventas por transferencia</dt><dd className="mas">+{money(r.transferencias)}</dd></div>
                    {(r.abonosTransfer || 0) > 0 && <div><dt>Abonos por transferencia</dt><dd className="mas">+{money(r.abonosTransfer)}</dd></div>}
                    {r.gastosTransfer > 0 && <div><dt>Pagos por Nequi</dt><dd className="menos">−{money(r.gastosTransfer)}</dd></div>}
                  </dl>
                </section>
              </div>

              {r.credito > 0 && (
                <div className="nota-credito">
                  <span>Ventas a crédito (fiado)</span>
                  <b>{money(r.credito)}</b>
                  <small>No entra al arqueo: esa plata no había llegado.</small>
                </div>
              )}
              {/* Desglose: de qué se compone "Gastos pagados" y los abonos.
                  Sin esto solo se veían totales y era imposible auditar un
                  descuadre (ej. buscar de dónde salen $4.000 de un lavador). */}
              {r.salidasLista.length > 0 && (
                <>
                  <div className="section-title" style={{ marginTop: 14 }}>Salidas y pagos del turno</div>
                  <table className="tabla compacta">
                    <tbody>
                      {r.salidasLista.map((g) => {
                        const medioTxt = g.medioPago === 'mixto'
                          ? `Mixto (ef ${money(gastoMontoCaja(g))} · tr ${money(gastoMontoTransfer(g))})`
                          : labelMedioGasto(g.medioPago)
                        const etiqueta = g.categoria === 'comisiones' ? 'Comisión'
                          : g.categoria === 'inventario' ? 'Inventario'
                            : g.categoria === 'prestamo' ? 'Préstamo'
                              : g.categoria === 'retiro' ? 'Retiro' : null
                        return (
                          <tr key={g.id}>
                            <td className="muted-cell" style={{ whiteSpace: 'nowrap' }}>{shortDate(g.fecha)}</td>
                            <td>
                              {g.concepto || 'Salida'}
                              {etiqueta && <span className="badge" style={{ marginLeft: 6 }}>{etiqueta}</span>}
                              <div className="muted-cell">{medioTxt}{g.responsable ? ' · ' + g.responsable : ''}</div>
                            </td>
                            <td className="num" style={{ color: 'var(--red)', fontWeight: 700, whiteSpace: 'nowrap' }}>−{money(g.monto)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="helper">Suma en efectivo {money(r.gastos)} · en transferencia {money(r.gastosTransfer)}.</div>
                </>
              )}

              {r.abonosLista.length > 0 && (
                <>
                  <div className="section-title" style={{ marginTop: 14 }}>Abonos recibidos en el turno</div>
                  <table className="tabla compacta">
                    <tbody>
                      {r.abonosLista.map((a) => (
                        <tr key={a.id}>
                          <td className="muted-cell" style={{ whiteSpace: 'nowrap' }}>{shortDate(a.fecha)}</td>
                          <td>{a.clienteNombre || 'Abono'}<div className="muted-cell">{a.medioPago === 'mixto'
                            ? `Mixto (ef ${money(gastoMontoCaja(a))} · tr ${money(gastoMontoTransfer(a))})`
                            : labelMedioGasto(a.medioPago)}</div></td>
                          <td className="num" style={{ color: 'var(--green)', fontWeight: 700, whiteSpace: 'nowrap' }}>{money(a.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="helper">Suma en efectivo {money(r.abonos)} · en transferencia {money(r.abonosTransfer)}.</div>
                </>
              )}

              <div style={{ height: 12 }} />
              <button className="btn" onClick={() => descargarCierrePDF({ ...det, resumen: r })}>Descargar comprobante (PDF)</button>

              {esDueno && (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                  {/* Reabrir: solo el ÚLTIMO cierre y solo si no hay otro abierto.
                      Un turno abierto cuenta todo desde `abiertoEn` sin tope, así
                      que reabrir uno viejo se tragaría las ventas posteriores. */}
                  {cerrados[0]?.id === det.id && !abierto && (
                    <>
                      {!confirmReabrir ? (
                        <button className="btn secondary" style={{ marginBottom: 10 }} onClick={() => setConfirmReabrir(true)}>
                          Reabrir turno
                        </button>
                      ) : (
                        <>
                          <div className="helper">
                            Vuelve a dejar el turno abierto para corregir pagos, registrar lo que faltó y cerrarlo otra vez. Las ventas y gastos no se tocan.
                          </div>
                          {new Date(det.cerradoEn).toDateString() !== new Date().toDateString() && (
                            <div className="helper" style={{ color: 'var(--amber)', marginTop: 4 }}>
                              OJO: este cierre es del {shortDate(det.cerradoEn)}, no de hoy. Al reabrirlo, todo lo que se haya vendido o gastado DESPUÉS va a entrar en este turno y el cuadre te va a dar distinto. Si solo necesitas corregir un pago, es mejor arreglarlo en Gastos, Créditos o Historial: el cierre se recalcula solo.
                            </div>
                          )}
                          <div style={{ height: 8 }} />
                          <button className="btn" onClick={reabrirTurno}>Sí, reabrir el turno</button>
                          <div style={{ height: 6 }} />
                          <button className="btn secondary" onClick={() => setConfirmReabrir(false)}>Cancelar</button>
                          <div style={{ height: 10 }} />
                        </>
                      )}
                    </>
                  )}
                  {cerrados[0]?.id === det.id && abierto && (
                    <div className="helper" style={{ marginBottom: 10 }}>
                      Para reabrir este turno primero tienes que cerrar el que está abierto.
                    </div>
                  )}

                  {!corrigiendo ? (
                    <button className="btn secondary" onClick={() => { setContadoEdit(r.contadoReal); setContadoTransferEdit(r.contadoTransfer ?? r.totalTransfer); setCorrigiendo(true) }}>
                      Corregir el conteo (efectivo / transferencia)
                    </button>
                  ) : (
                    <>
                      <label>Efectivo contado real (lo que de verdad quedó en caja)</label>
                      <MoneyInput value={contadoEdit} onChange={setContadoEdit} />
                      <div className="helper" style={{ marginTop: 6, color: difColor(contadoEdit - r.esperado) }}>
                        {contadoEdit - r.esperado === 0 ? 'Quedaría cuadrada.' :
                          contadoEdit - r.esperado > 0 ? `Sobraría ${money(contadoEdit - r.esperado)}` :
                            `Faltaría ${money(r.esperado - contadoEdit)}`}
                      </div>
                      <label>Transferencia contada real (lo que mostraba el Nequi / banco)</label>
                      <MoneyInput value={contadoTransferEdit} onChange={setContadoTransferEdit} />
                      <div className="helper" style={{ marginTop: 6, color: difColor(contadoTransferEdit - r.totalTransfer) }}>
                        {contadoTransferEdit - r.totalTransfer === 0 ? 'Transferencia cuadrada.' :
                          contadoTransferEdit - r.totalTransfer > 0 ? `Sobraría ${money(contadoTransferEdit - r.totalTransfer)}` :
                            `Faltaría ${money(r.totalTransfer - contadoTransferEdit)}`}
                      </div>
                      <div className="helper">Úsalo si al cerrar no tecleaste la plata que recibiste. Corrige solo el conteo; no cambia las ventas.</div>
                      <div style={{ height: 10 }} />
                      <button className="btn" onClick={guardarCorreccion}>Guardar corrección</button>
                      <div style={{ height: 6 }} />
                      <button className="btn secondary" onClick={() => setCorrigiendo(false)}>Cancelar</button>
                    </>
                  )}

                  <div style={{ height: 10 }} />
                  {!confirmDel ? (
                    <button className="btn danger" onClick={() => setConfirmDel(true)}>Eliminar este cierre</button>
                  ) : (
                    <>
                      <div className="helper" style={{ color: 'var(--red)' }}>
                        ¿Eliminar este cierre? Úsalo solo si fue creado por error (ej. un turno repetido). No borra las ventas, solo este registro de cuadre.
                      </div>
                      <div style={{ height: 6 }} />
                      <button className="btn danger" onClick={eliminarCierre}>Sí, eliminar cierre</button>
                      <div style={{ height: 6 }} />
                      <button className="btn secondary" onClick={() => setConfirmDel(false)}>Cancelar</button>
                    </>
                  )}
                </div>
              )}
            </>
          )
        })()}
      </Sheet>

      {node}
    </>
  )
}
