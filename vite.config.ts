import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Ensures assets load correctly in Electron (file:// protocol)
  define: {
    // Polyfill process.env so existing code continues to work
    'process.env': {} 
  }
})