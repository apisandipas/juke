import { fileURLToPath } from 'node:url'

// Path aliases, shared by the web build, the server build and vitest. Keep
// in step with "paths" in tsconfig.json and tsconfig.server.json.
const src = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url))

export const aliases = {
  '@/': src('web/'),
  '@shared/': src('shared/'),
  '@server/': src('server/'),
}
