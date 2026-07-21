import { db } from './db'
import { supabase, syncDisponible } from './supabase'

// Tablas locales que se sincronizan con la tabla "registros" de Supabase.
const TABLAS = ['productos', 'servicios', 'trabajadores', 'ventas', 'gastos', 'movimientos_inv', 'clientes', 'abonos', 'mesas', 'turnos', 'pagos_comision', 'gastos_fijos', 'ordenes', 'proveedores', 'compras']
const LAST_PULL_KEY = 'fenix_last_pull'      // legacy: cursor por el reloj del CLIENTE (ms)
const CURSOR_KEY = 'fenix_sync_cursor'       // nuevo: cursor por el reloj del SERVIDOR (ISO)
const PAGE = 1000                            // tamaño de página al bajar (evita el tope de PostgREST)

// --- Estado observable para mostrar en la interfaz ---
let estado = { fase: 'idle', ultima: null } // fase: idle|sincronizando|ok|offline|error
const oyentes = new Set()
function setEstado(parcial) {
  estado = { ...estado, ...parcial }
  oyentes.forEach((cb) => cb(estado))
}
export function subscribeSync(cb) {
  oyentes.add(cb)
  cb(estado)
  return () => oyentes.delete(cb)
}

// ¿El error de la nube es por falta de autenticación (RLS)?
function esErrorAuth(error) {
  const msg = (error?.message || '').toLowerCase()
  return error?.code === '42501' || error?.status === 401 ||
    msg.includes('row-level security') || msg.includes('jwt') ||
    msg.includes('permission denied') || msg.includes('not authorized')
}

function getLastPull() {
  return parseInt(localStorage.getItem(LAST_PULL_KEY) || '0', 10)
}
function setLastPull(ts) {
  localStorage.setItem(LAST_PULL_KEY, String(ts))
}

// Sube los registros locales sin sincronizar (synced = 0), tabla por tabla.
// Se hace por tabla para que si una falla, las demás sí suban (robusto).
async function push() {
  let authErr = null
  let otroErr = null
  for (const tabla of TABLAS) {
    const pendientes = await db[tabla].filter((r) => r.synced === 0).toArray()
    if (pendientes.length === 0) continue

    const filas = pendientes.map((r) => {
      const { synced, ...data } = r // no guardamos el flag local en la nube
      return { id: r.id, tabla, data, updated_at: r.updatedAt }
    })

    const { error } = await supabase.from('registros').upsert(filas)
    if (error) {
      if (esErrorAuth(error)) { authErr = error; break } // auth afecta a todas: paramos
      console.warn('[sync] no se pudo subir', tabla, '·', error.message)
      otroErr = error
      continue // salta esta tabla, intenta las demás
    }
    // Marcar como sincronizados (sin tocar updatedAt para no re-disparar el push).
    for (const r of pendientes) await db[tabla].update(r.id, { synced: 1 })
  }
  if (authErr) { const e = new Error('AUTH'); e.auth = true; throw e }
  if (otroErr) throw otroErr
}

// Aplica una fila bajada de la nube al almacén local, resolviendo conflictos
// por "el más reciente gana" (por updatedAt del cliente, best-effort).
async function aplicarFila(fila) {
  if (!TABLAS.includes(fila.tabla)) return
  const local = await db[fila.tabla].get(fila.id)
  if (!local || (fila.updated_at || 0) >= (local.updatedAt || 0)) {
    await db[fila.tabla].put({ ...fila.data, synced: 1 })
  }
}

// ¿El error es porque la columna `synced_at` todavía no existe en la nube
// (migración no aplicada aún)? En ese caso caemos al modo legacy.
function faltaSyncedAt(error) {
  const msg = (error?.message || '').toLowerCase()
  return error?.code === '42703' || msg.includes('synced_at')
}
// PostgREST responde 416 / PGRST103 ("Requested Range Not Satisfiable") cuando
// el offset de .range() supera el total de filas. Eso NO es un error: significa
// que ya no hay más páginas. (Pasa cuando una página trae exactamente PAGE
// filas y no había más.) Antes tumbaba la sincronización con "error".
function esFinDeRango(error) {
  const msg = (error?.message || '').toLowerCase()
  return error?.code === 'PGRST103' || error?.status === 416 ||
    msg.includes('range not satisfiable') || msg.includes('not satisfiable')
}
let modoLegacy = false // se vuelve true si la nube aún no tiene synced_at

// Baja los registros que cambiaron en la nube desde la última vez, ordenados
// por el reloj del SERVIDOR (synced_at). Como el orden lo pone un único reloj
// central, ya no importa si el reloj de algún dispositivo está desfasado: nada
// se queda sin bajar. Se pagina para no chocar con el tope de filas de PostgREST.
async function pull() {
  if (modoLegacy) return pullLegacy()

  const cursor = localStorage.getItem(CURSOR_KEY) || '1970-01-01T00:00:00+00:00'
  let maxCursor = cursor
  let hubo = false
  for (let desde = 0; ; desde += PAGE) {
    const { data: filas, error } = await supabase
      .from('registros')
      .select('id, tabla, data, updated_at, synced_at')
      .gt('synced_at', cursor)
      .order('synced_at', { ascending: true })
      .range(desde, desde + PAGE - 1)
    if (error) {
      if (faltaSyncedAt(error)) { modoLegacy = true; return pullLegacy() }
      if (esFinDeRango(error)) break // no hay más páginas, no es error
      throw error
    }
    if (!filas || filas.length === 0) break
    for (const fila of filas) {
      await aplicarFila(fila)
      if (fila.synced_at > maxCursor) maxCursor = fila.synced_at
      hubo = true
    }
    if (filas.length < PAGE) break
  }
  // El cursor es hora del SERVIDOR: se guarda tal cual (nunca "en el futuro"
  // desde el punto de vista de este dispositivo, porque no es su reloj).
  if (hubo) localStorage.setItem(CURSOR_KEY, maxCursor)
}

// Margen de solapamiento del modo legacy: pide un poco hacia atrás para tolerar
// pequeños desfases de reloj. Volver a bajar un registro es inofensivo (put
// idempotente). Solo se usa mientras la nube no tenga synced_at.
const MARGEN_PULL = 2 * 60 * 1000 // 2 min

// Pull LEGACY (por reloj del cliente). Se usa únicamente si la migración de
// synced_at aún no está aplicada. Paginado para no truncar en un resync total.
async function pullLegacy() {
  const now = Date.now()
  let desdeTs = getLastPull()
  if (desdeTs > now) desdeTs = 0 // marcador corrupto "en el futuro" → re-sincroniza
  const consulta = Math.max(0, desdeTs - MARGEN_PULL)
  let maxTs = desdeTs
  for (let off = 0; ; off += PAGE) {
    const { data: filas, error } = await supabase
      .from('registros')
      .select('id, tabla, data, updated_at')
      .gt('updated_at', consulta)
      .order('updated_at', { ascending: true })
      .range(off, off + PAGE - 1)
    if (error) {
      if (esFinDeRango(error)) break // no hay más páginas, no es error
      throw error
    }
    if (!filas || filas.length === 0) break
    for (const fila of filas) {
      await aplicarFila(fila)
      if (fila.updated_at > maxTs) maxTs = fila.updated_at
    }
    if (filas.length < PAGE) break
  }
  setLastPull(Math.min(maxTs, now))
}

// Fuerza volver a bajar TODO de la nube (recupera un dispositivo que se quedó
// atrás por un marcador corrupto). Reinicia el marcador y sincroniza.
export async function resyncAll() {
  setLastPull(0)
  localStorage.removeItem(CURSOR_KEY)
  await sync()
}

let sincronizando = false
export async function sync() {
  if (!syncDisponible) return
  if (!navigator.onLine) {
    setEstado({ fase: 'offline' })
    return
  }
  if (sincronizando) return
  sincronizando = true
  setEstado({ fase: 'sincronizando' })
  try {
    await push()
    await pull()
    setEstado({ fase: 'ok', ultima: Date.now(), mensaje: null })
  } catch (e) {
    if (e?.auth) {
      setEstado({ fase: 'auth' }) // el dispositivo necesita conectarse a la nube
    } else {
      const mensaje = e?.message || String(e)
      console.warn('[sync] error:', mensaje)
      setEstado({ fase: 'error', mensaje }) // guardamos el detalle para mostrarlo
    }
  } finally {
    sincronizando = false
  }
}

// Arranca la sincronización: al cargar, cada 15s, y al recuperar conexión.
let intervalo = null
export function startSync() {
  if (!syncDisponible || intervalo) return
  sync()
  intervalo = setInterval(sync, 15000)
  window.addEventListener('online', sync)
  window.addEventListener('offline', () => setEstado({ fase: 'offline' }))
  // Sincroniza al volver a la app (cambiar de pestaña / despertar el móvil).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync()
  })
}
