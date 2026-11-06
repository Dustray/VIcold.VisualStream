import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 750 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
