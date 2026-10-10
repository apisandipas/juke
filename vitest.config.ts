import { defineConfig } from 'vitest/config'
import { aliases } from './aliases.ts'

export default defineConfig({
  resolve: { alias: aliases },
  test: { include: ['src/**/*.test.ts'] },
})
