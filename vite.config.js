import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// En local (dev/preview) la app vive en "/"; publicada en GitHub Pages
// vive en "/lavadero-fenix-lc/". El base se ajusta solo según el comando.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/lavadero-fenix-lc/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registramos el SW a mano en main.jsx (con chequeo periódico de updates),
      // así que desactivamos la auto-inyección para no registrarlo dos veces.
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Lavadero Fénix',
        short_name: 'Fénix',
        description: 'Gestión de servicios, productos y ganancias del lavadero',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'es-CO',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}']
      }
    })
  ]
}))
