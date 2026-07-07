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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
)
