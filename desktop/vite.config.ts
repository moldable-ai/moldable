import react from '@vitejs/plugin-react'
import { manualReloadPlugin } from './vite-plugin-manual-reload'
import path from 'path'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), manualReloadPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    hmr: {
      // Keep WebSocket open for custom events, but we intercept updates via plugin
      overlay: false,
    },
  },
})
