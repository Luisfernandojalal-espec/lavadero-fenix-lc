import { db } from './db'
import { supabase, syncDisponible } from './supabase'

// Tablas locales que se sincronizan con la tabla "registros" de Supabase.
const TABLAS = ['productos', 'servicios', 'trabajadores', 'ventas', 'gastos']
const LAST_PULL_KEY = 'fenix_last_pull'

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

// Sube todos los registros locales que aún no están sincronizados (synced = 0).
async function push() {
  const filas = []
  const idsPorTabla = {}
  for (const tabla of TABLAS) {
    const pendientes = await db[tabla].filter((r) => r.synced === 0).toArray()
    idsPorTabla[tabla] = []
    for (const r of pendientes) {
      const { synced, ...data } = r // no guardamos el flag local en la nube
      filas.push({ id: r.id, tabla, data, updated_at: r.updatedAt })
      idsPorTabla[tabla].push(r.id)
    }
  }
  if (filas.length === 0) return

  const { error } = await supabase.from('registros').upsert(filas)
  if (error) {
    if (esErrorAuth(error)) { const e = new Error('AUTH'); e.auth = true; throw e }
    throw error
  }

  // Marcar como sincronizados (sin tocar updatedAt para no re-disparar el push).
  for (const tabla of TABLAS) {
    for (const id of idsPorTabla[tabla]) {
      await db[tabla].update(id, { synced: 1 })
    }
  }
}

// Baja los registros que cambiaron en la nube desde la última vez.
async function pull() {
  const desde = getLastPull()
  const { data: filas, error } = await supabase
    .from('registros')
    .select('id, tabla, data, updated_at')
    .gt('updated_at', desde)
    .order('updated_at', { ascending: true })
  if (error) throw error
  if (!filas || filas.length === 0) return

  let maxTs = desde
  for (const fila of filas) {
    if (!TABLAS.includes(fila.tabla)) continue
    const local = await db[fila.tabla].get(fila.id)
    // "El más reciente gana": si lo local es más nuevo, no lo pisamos.
    if (!local || fila.updated_at >= (local.updatedAt || 0)) {
      await db[fila.tabla].put({ ...fila.data, synced: 1 })
    }
    if (fila.updated_at > maxTs) maxTs = fila.updated_at
  }
  setLastPull(maxTs)
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
    setEstado({ fase: 'ok', ultima: Date.now() })
  } catch (e) {
    if (e?.auth) {
      setEstado({ fase: 'auth' }) // el dispositivo necesita conectarse a la nube
    } else {
      console.warn('[sync] error:', e?.message || e)
      setEstado({ fase: 'error' })
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
