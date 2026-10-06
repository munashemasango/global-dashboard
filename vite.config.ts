import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/recharts/') || /\/node_modules\/(d3-|victory-vendor)/.test(id)) {
            return 'charts'
          }
          if (id.includes('/node_modules/leaflet/') || id.includes('/node_modules/react-leaflet/')) {
            return 'maps'
          }
          if (/\/node_modules\/(world-atlas|topojson-client|topojson-specification)/.test(id)) {
            return 'geodata'
          }
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
