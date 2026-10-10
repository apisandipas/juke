import { defineConfig } from 'vite'
import { aliases } from './aliases.ts'

// Bundles the proxy, dependencies included, into one file at
// dist/server/main.js, so a deploy needs Node and dist/ but no node_modules.
export default defineConfig({
  resolve: { alias: aliases },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'src/server/main.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'main.js' } },
  },
})
