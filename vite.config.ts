import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { aliases } from './aliases.ts'

const apiPort = process.env.JUKE_PORT ?? '4600'

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: aliases },
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    host: true,
    allowedHosts: ['madrox', 'galactus'],
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
})
