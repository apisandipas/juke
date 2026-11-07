import { serve } from '@hono/node-server'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '@server/app'
import { createAsk } from '@server/ask'
import { createSetupCode } from '@server/auth'
import { checkConnection } from '@server/checks'
import { ConfigStore, fromEnv } from '@server/config'
import { createSubsonicClient } from '@server/subsonic'

// Settings live in JUKE_DATA_DIR. Under systemd, StateDirectory= sets
// STATE_DIRECTORY, which works the same way.
const dataDir = resolve(process.env.JUKE_DATA_DIR ?? process.env.STATE_DIRECTORY ?? 'data')
const store = new ConfigStore(process.env, dataDir)
const settings = store.settings()
const setupCode = settings ? null : createSetupCode()

// The built web app sits beside the compiled server (dist/web next to
// dist/server). In dev Vite serves it instead and this directory is absent.
const builtWeb = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
const staticDir = process.env.JUKE_STATIC_DIR ?? (existsSync(builtWeb) ? builtWeb : undefined)

// Ask is optional and uses the operator's own key; without one it stays off.
const anthropicKey = fromEnv(process.env, 'ANTHROPIC_API_KEY')
const ask = anthropicKey
  ? createAsk({ apiKey: anthropicKey, model: process.env.ANTHROPIC_MODEL })
  : null

const port = Number(process.env.JUKE_PORT ?? 4600)
const hostname = process.env.JUKE_HOST ?? '0.0.0.0'

serve({ fetch: createApp({ store, setupCode, staticDir, ask }).fetch, port, hostname }, () => {
  console.log(`juke listening on http://${hostname}:${port}${staticDir ? '' : ' (API only)'}`)
  console.log(ask ? 'juke: Ask is on' : 'juke: Ask is off (set ANTHROPIC_API_KEY to turn it on)')
  if (setupCode) {
    console.log(
      [
        '',
        'juke needs setting up. Open it in a browser and enter this setup code:',
        '',
        `    ${setupCode}`,
        '',
        `Settings will be saved to ${store.path}.`,
        'Or set NAVIDROME_URL, NAVIDROME_USER and NAVIDROME_PASSWORD and restart.',
        '',
      ].join('\n'),
    )
  } else if (!store.jukePassword()) {
    console.log('juke: JUKE_PASSWORD is not set, so anyone who can reach this port can use juke')
  }
})

// Set up from the start: say now if Navidrome can't be used, rather than
// leaving it for the first phone to find. Navidrome may still be starting,
// so this only warns.
if (settings) {
  const client = createSubsonicClient({
    baseUrl: settings.navidromeUrl,
    user: settings.navidromeUser,
    password: settings.navidromePassword,
  })
  void checkConnection(client, settings.navidromeUser).then((checks) => {
    for (const check of checks) {
      if (!check.ok) console.warn(`juke: ${check.label}: failed. ${check.detail}`)
    }
  })
}
