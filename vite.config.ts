import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { aliases } from './aliases.ts'

const apiPort = process.env.JUKE_PORT ?? '4600'
// Hostnames other devices use to reach the dev server, e.g. "laptop,desktop".
const devHosts = (process.env.JUKE_DEV_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: aliases },
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    host: true,
    allowedHosts: devHosts,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
})
