import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Relative paths for GitHub Pages
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173,      // Default port
    allowedHosts: true // Allow custom domains and tunnels
  }
})
