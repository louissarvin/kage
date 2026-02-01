import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Force all bs58 imports to use anchor's CommonJS-compatible version
      'bs58': resolve(__dirname, 'node_modules/@coral-xyz/anchor/node_modules/bs58'),
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['bs58', 'base-x'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
