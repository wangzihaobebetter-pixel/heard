import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' — the app deploys to a GitHub Pages project sub-path and must also
// run from file:// and from `vite preview`. Hash routing, never history API.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
  server: { host: true, port: 4173 },
  preview: { host: true, port: 4173 }
})
