import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const API_PORT = parseInt(process.env.VITE_API_PORT || '3000', 10)

function getPackageName(id: string) {
  const normalized = id.replace(/\\/g, '/')
  const match = /\/node_modules\/(@[^/]+\/[^/]+|[^/]+)/.exec(normalized)
  return match ? match[1] : null
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const packageName = getPackageName(id)
          if (!packageName) return

          if (packageName === 'docx') {
            return 'docx'
          }
          if (packageName === 'jspdf' || packageName === 'fflate' || packageName === 'dompurify') {
            return 'jspdf'
          }
          if (packageName === 'html2canvas') {
            return 'html2canvas'
          }
          if (packageName === 'core-js') {
            return 'core-js'
          }
          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'react-router-dom') {
            return 'react'
          }
          if (packageName === 'lucide-react' || packageName === 'lucide') {
            return 'icons'
          }
          if (packageName === 'leaflet') {
            return 'maps'
          }
          return 'vendor'
        },
      },
    },
  },
})
