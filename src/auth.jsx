import { createContext, useContext, useState, useCallback } from 'react'

// Sesión del usuario que está usando este dispositivo.
// Se guarda en el propio celular (localStorage): al abrir la app recuerda
// quién entró, hasta que cierre sesión.
const AuthCtx = createContext(null)
const KEY = 'fenix_session'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
  })

  const login = useCallback((u) => {
    const sess = { id: u.id, nombre: u.nombre, rol: u.rol || 'trabajador' }
    localStorage.setItem(KEY, JSON.stringify(sess))
    setUser(sess)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(KEY)
    setUser(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ user, login, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
