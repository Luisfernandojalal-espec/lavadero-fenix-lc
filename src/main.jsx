import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import { AuthProvider } from './auth.jsx'
import './styles.css'

// Auto-actualización de la PWA. Con registerType:'autoUpdate' el service worker
// nuevo se activa solo y la página se recarga sola cuando hay un build nuevo.
// PERO un dispositivo con la app abierta todo el día nunca revisa si hay versión
// nueva. Aquí forzamos ese chequeo cada minuto y cada vez que se vuelve a la app,
// para que todos los dispositivos abiertos se actualicen sin recargar a mano.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (!r) return
    const revisar = () => { if (navigator.onLine) r.update() }
    setInterval(revisar, 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisar()
    })
    window.addEventListener('focus', revisar)
  },
})

// Botón "Actualizar" de la interfaz: fuerza a buscar la versión nueva (activa
// el service worker que esté esperando) y recarga. Así el usuario actualiza a
// mano sin tener que saber el atajo de recargar. Expuesto como global para que
// lo llame el botón del encabezado (ui.jsx).
window.__fenixActualizar = async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.update().catch(() => {})))
      // Si quedó un service worker nuevo esperando, actívalo ya.
      for (const r of regs) r.waiting?.postMessage?.({ type: 'SKIP_WAITING' })
    }
  } catch { /* sin SW o sin soporte: recargamos igual */ }
  // Recarga (pequeña espera para que alcance a activarse el SW nuevo).
  setTimeout(() => window.location.reload(), 250)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
)
