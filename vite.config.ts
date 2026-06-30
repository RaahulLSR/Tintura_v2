import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Ensures assets load correctly in Electron (file:// protocol)
  define: {
    // Polyfill process.env so existing code continues to work
    'process.env': {} 
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own cacheable chunks so the
        // main app bundle stays small and loads faster.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-pdf': ['pdf-lib'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
})