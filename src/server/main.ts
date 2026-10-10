import { serve } from '@hono/node-server'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '@server/app'
import { Jukebox } from '@server/jukebox'
import { createSubsonicClient } from '@server/subsonic'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`juke: ${name} is not set (see .env.example)`)
    process.exit(1)
  }
  return value
}

function password(): string {
  const file = process.env.NAVIDROME_PASSWORD_FILE
  if (file) return readFileSync(file, 'utf8').trim()
  return required('NAVIDROME_PASSWORD')
}

const subsonic = createSubsonicClient({
  baseUrl: process.env.NAVIDROME_URL ?? 'http://localhost:4533',
  user: required('NAVIDROME_USER'),
  password: password(),
})

const jukebox = new Jukebox(subsonic.call)

// The built web app sits beside the compiled server (dist/web next to
// dist/server). In dev Vite serves it instead and this directory is absent.
const builtWeb = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
const staticDir = process.env.JUKE_STATIC_DIR ?? (existsSync(builtWeb) ? builtWeb : undefined)

const port = Number(process.env.JUKE_PORT ?? 4600)
const hostname = process.env.JUKE_HOST ?? '0.0.0.0'

serve({ fetch: createApp({ subsonic, jukebox, staticDir }).fetch, port, hostname }, () => {
  console.log(`juke listening on http://${hostname}:${port}${staticDir ? '' : ' (API only)'}`)
})
