import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { LIBRARY_ENDPOINTS, type JukeboxCommand, type LibraryEndpoint } from '@shared/types'
import { CommandError, type Jukebox } from '@server/jukebox'
import { SubsonicError, type SubsonicClient } from '@server/subsonic'

const COVER_SIZES = new Set([64, 128, 256, 512, 1024])

export function createApp(deps: {
  subsonic: SubsonicClient
  jukebox: Jukebox
  staticDir?: string
}) {
  const { subsonic, jukebox } = deps
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof CommandError) return c.json({ error: err.message }, err.status)
    if (err instanceof SubsonicError) return c.json({ error: err.message, code: err.code }, 502)
    console.error(err)
    return c.json({ error: err.message || 'Internal error' }, 500)
  })

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/state', async (c) => c.json(await jukebox.refresh()))

  // One stream per open tab. Navidrome is polled only while at least one is
  // connected, and every tab sees the same state.
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let resolveClosed: () => void = () => {}
      const closed = new Promise<void>((resolve) => (resolveClosed = resolve))
      const send = (state: unknown) => {
        void stream.writeSSE({ event: 'state', data: JSON.stringify(state) }).catch(resolveClosed)
      }
      const unsubscribe = jukebox.subscribe(send)
      stream.onAbort(resolveClosed)
      send(jukebox.current)
      // Comments keep idle proxies from closing the connection.
      const keepAlive = setInterval(() => void stream.write(': keep-alive\n\n'), 25_000)
      await closed
      clearInterval(keepAlive)
      unsubscribe()
    }),
  )

  app.post('/api/jukebox', async (c) => {
    const command = await c.req.json<JukeboxCommand>().catch(() => null)
    if (!command || typeof command.action !== 'string') {
      throw new CommandError('Expected a JSON command with an action')
    }
    return c.json(await jukebox.run(command))
  })

  app.get('/api/library/:endpoint', async (c) => {
    const endpoint = c.req.param('endpoint')
    if (!LIBRARY_ENDPOINTS.includes(endpoint as LibraryEndpoint)) {
      return c.json({ error: `Unknown library endpoint ${endpoint}` }, 404)
    }
    const payload = await subsonic.call(endpoint, c.req.query())
    // Drop the envelope fields; the browser only wants the result.
    for (const key of ['status', 'version', 'type', 'serverVersion', 'openSubsonic']) {
      delete payload[key]
    }
    return c.json(payload)
  })

  app.get('/api/cover/:id', async (c) => {
    const requested = Number(c.req.query('size') ?? 512)
    const size = COVER_SIZES.has(requested) ? requested : 512
    const res = await subsonic.fetch('getCoverArt', { id: c.req.param('id'), size })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !res.body || !type.startsWith('image/')) return c.body(null, 404)
    return c.body(res.body, 200, {
      'content-type': type,
      // Art for an id rarely changes, and the browser cache saves a round
      // trip through Navidrome for every queue row.
      'cache-control': 'private, max-age=86400',
    })
  })

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  if (deps.staticDir) {
    app.use('/*', serveStatic({ root: deps.staticDir }))
    // Client-side routes live in the hash, so any other path is the app shell.
    app.get('/*', serveStatic({ root: deps.staticDir, path: 'index.html' }))
  }

  return app
}
