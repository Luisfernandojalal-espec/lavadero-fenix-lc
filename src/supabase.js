import { createClient } from '@supabase/supabase-js'

// Las llaves se leen de variables de entorno (archivo .env, ver .env.example).
// Si todavía no están configuradas, `supabase` queda en null y la app
// sigue funcionando 100% local/offline sin errores.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey) : null

export const syncDisponible = Boolean(supabase)

// --- Conexión del dispositivo a la nube (cuenta compartida del negocio) ---
// Con esto la base de datos deja de aceptar a cualquiera con la llave pública:
// solo los dispositivos "conectados" (autenticados) pueden leer o escribir.

export async function sesionNube() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session || null
}

export async function conectarNube(email, password) {
  if (!supabase) throw new Error('Nube no configurada')
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
}

export async function desconectarNube() {
  if (!supabase) return
  await supabase.auth.signOut()
}
