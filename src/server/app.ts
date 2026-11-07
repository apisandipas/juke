import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import {
  LIBRARY_ENDPOINTS,
  type AskRequest,
  type JukeConfig,
  type JukeboxCommand,
  type LibraryEndpoint,
  type SetupRequest,
} from '@shared/types'
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  Throttle,
  createSession,
  fingerprint,
  hashPassword,
  normalizeCode,
  safeEqual,
  verifyPassword,
  verifySession,
} from '@server/auth'
import { AskError, MAX_PROMPT, type Ask } from '@server/ask'
import { checkConnection } from '@server/checks'
import type { ConfigStore, Settings } from '@server/config'
import { CommandError, Jukebox } from '@server/jukebox'
import { PlaylistError, markEditable, playlistRoutes } from '@server/playlists'
import { SubsonicError, createSubsonicClient, type SubsonicClient } from '@server/subsonic'

const COVER_SIZES = new Set([64, 128, 256, 512, 1024])
/** Bit rates a device may ask Navidrome to transcode down to; 0 means the original file. */
const BIT_RATES = new Set([0, 96, 128, 192, 256, 320])
/** Headers from Navidrome's stream that the browser needs for seeking and buffering. */
const STREAM_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']
export const MIN_PASSWORD = 8

/** Routes that work before setup and without signing in. */
const OPEN_ROUTES = new Set(['/api/health', '/api/config', '/api/login', '/api/logout'])

export interface AppDeps {
  store: ConfigStore
  /** Builds a Subsonic client; tests swap in a fake. */
  connect?: (settings: Settings) => SubsonicClient
  /** Required to submit the setup form. Ignored once juke is set up. */
  setupCode?: string | null
  /** Builds the jukebox for a client; tests pass options such as a fake clock. */
  jukebox?: (client: SubsonicClient) => Jukebox
  staticDir?: string
  /** Ask, when the person running juke set an Anthropic API key. */
  ask?: Ask | null
}

/** Asks running at once, across every device. Each one costs API tokens. */
const MAX_ASKS = 2

interface Live {
  subsonic: SubsonicClient
  jukebox: Jukebox
  /** The Navidrome account juke signs in as. */
  user: string
}

export function createApp(deps: AppDeps) {
  const { store } = deps
  const connect = deps.connect ?? defaultConnect
  const makeJukebox = deps.jukebox ?? ((client: SubsonicClient) => new Jukebox(client.call))
  let setupCode = deps.setupCode ?? null
  const throttle = new Throttle()

  const startLive = (settings: Settings): Live => {
    const subsonic = connect(settings)
    return { subsonic, jukebox: makeJukebox(subsonic), user: settings.navidromeUser }
  }
  const initial = store.settings()
  let live: Live | null = initial ? startLive(initial) : null

  const app = new Hono<{ Variables: { live: Live } }>()

  app.onError((err, c) => {
    if (err instanceof CommandError) return c.json({ error: err.message }, err.status)
    if (err instanceof PlaylistError) return c.json({ error: err.message }, err.status)
    if (err instanceof AskError) return c.json({ error: err.message }, err.status)
    if (err instanceof SubsonicError) return c.json({ error: err.message, code: err.code }, 502)
    console.error(err)
    return c.json({ error: err.message || 'Internal error' }, 500)
  })

  // ---- Sign-in -------------------------------------------------------------

  const signedIn = (c: Context): boolean => {
    const password = store.jukePassword()
    if (!password) return true
    return verifySession(getCookie(c, SESSION_COOKIE), store.sessionSecret(), fingerprint(password))
  }

  const startSession = (c: Context) => {
    const password = store.jukePassword()
    if (!password) return
    setCookie(c, SESSION_COOKIE, createSession(store.sessionSecret(), fingerprint(password)), {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: isHttps(c),
      maxAge: SESSION_DAYS * 86_400,
    })
  }

  const config = (c: Context, signedInNow?: boolean): JukeConfig => {
    const enabled = store.jukePassword() !== null
    return {
      name: store.name(),
      needsSetup: live === null,
      auth: { enabled, signedIn: signedInNow ?? signedIn(c) },
      ask: Boolean(deps.ask),
    }
  }

  // Gate the API: set up first, then signed in.
  app.use('/api/*', async (c, next) => {
    if (OPEN_ROUTES.has(c.req.path) || c.req.path.startsWith('/api/setup')) return next()
    if (!live) return c.json({ error: 'juke needs setting up', setup: true }, 503)
    if (!signedIn(c)) return c.json({ error: 'Sign in to juke', auth: true }, 401)
    c.set('live', live)
    return next()
  })

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/config', (c) => c.json(config(c)))

  app.post('/api/login', async (c) => {
    const password = store.jukePassword()
    if (!password) return c.json(config(c))
    const who = clientAddress(c)
    if (throttle.blocked(who)) {
      return c.json({ error: 'Too many wrong passwords. Wait 15 minutes and try again.' }, 429)
    }
    const body = await c.req.json<{ password?: unknown }>().catch(() => null)
    const given = typeof body?.password === 'string' ? body.password : ''
    const ok =
      password.kind === 'env'
        ? safeEqual(given, password.value)
        : verifyPassword(given, password.value)
    if (!ok) {
      throttle.fail(who)
      return c.json({ error: 'Wrong password' }, 401)
    }
    throttle.clear(who)
    startSession(c)
    return c.json(config(c, true))
  })

  app.post('/api/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json(config(c, store.jukePassword() === null))
  })

  // ---- Setup ---------------------------------------------------------------

  /** Settings from the form, with the environment and saved values filling what it leaves out. */
  const merged = (body: SetupRequest): Settings | string => {
    const current = store.fields()
    const pick = (field: 'navidromeUrl' | 'navidromeUser' | 'name') => {
      const given = typeof body[field] === 'string' ? body[field].trim() : ''
      return store.fromEnv(field) || !given ? current[field].value : given
    }
    const navidromeUrl = pick('navidromeUrl').replace(/\/+$/, '')
    const navidromeUser = pick('navidromeUser')
    const name = pick('name')
    const given = typeof body.navidromePassword === 'string' ? body.navidromePassword : ''
    const password =
      store.fromEnv('navidromePassword') || !given ? store.navidromePassword() : given
    if (!/^https?:\/\/[^/]/i.test(navidromeUrl)) {
      return 'The Navidrome address must start with http:// or https://'
    }
    if (!navidromeUser) return 'Enter the Navidrome username'
    if (!password) return 'Enter the Navidrome password'
    if (name.length > 40) return 'Keep the speaker name to 40 characters or fewer'
    return { navidromeUrl, navidromeUser, navidromePassword: password, name }
  }

  /** Shared guard for the setup routes: not set up yet, and the right code. */
  const setupGuard = async (c: Context): Promise<SetupRequest | Response> => {
    if (live) return c.json({ error: 'juke is already set up' }, 409)
    const who = clientAddress(c)
    if (throttle.blocked(who)) {
      return c.json({ error: 'Too many wrong setup codes. Wait 15 minutes and try again.' }, 429)
    }
    const body = await c.req.json<SetupRequest>().catch(() => null)
    if (!body || typeof body !== 'object') return c.json({ error: 'Expected a JSON body' }, 400)
    const code = normalizeCode(typeof body.code === 'string' ? body.code : '')
    if (!setupCode || !safeEqual(code, normalizeCode(setupCode))) {
      throttle.fail(who)
      return c.json(
        { error: 'That setup code is wrong. juke prints it in its log.', field: 'code' },
        403,
      )
    }
    throttle.clear(who)
    return body
  }

  app.get('/api/setup', (c) => {
    if (live) return c.json({ error: 'juke is already set up' }, 409)
    return c.json({ fields: store.fields(), minPassword: MIN_PASSWORD })
  })

  app.post('/api/setup/test', async (c) => {
    const body = await setupGuard(c)
    if (body instanceof Response) return body
    const settings = merged(body)
    if (typeof settings === 'string') return c.json({ error: settings }, 400)
    const checks = await checkConnection(connect(settings), settings.navidromeUser)
    return c.json({ checks, ok: allPassed(checks) })
  })

  app.post('/api/setup', async (c) => {
    const body = await setupGuard(c)
    if (body instanceof Response) return body
    const settings = merged(body)
    if (typeof settings === 'string') return c.json({ error: settings }, 400)

    const envPassword = store.fromEnv('jukePassword')
    const jukePassword = typeof body.jukePassword === 'string' ? body.jukePassword : ''
    if (!envPassword && jukePassword.length < MIN_PASSWORD) {
      return c.json(
        {
          error: `Pick a juke password of at least ${MIN_PASSWORD} characters`,
          field: 'jukePassword',
        },
        400,
      )
    }

    const checks = await checkConnection(connect(settings), settings.navidromeUser)
    if (!allPassed(checks)) {
      return c.json({ error: 'juke can’t use that Navidrome yet', checks }, 422)
    }

    try {
      store.save({
        ...settings,
        passwordHash: envPassword ? undefined : hashPassword(jukePassword),
      })
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      return c.json({ error: `Couldn’t save settings to ${store.path}: ${why}` }, 500)
    }
    live = startLive(settings)
    setupCode = null
    startSession(c)
    console.log(`juke: set up, using ${settings.navidromeUrl} as ${settings.navidromeUser}`)
    return c.json({ ...config(c, true), checks })
  })

  // ---- Jukebox and library -------------------------------------------------

  app.get('/api/state', async (c) => c.json(await c.var.live.jukebox.refresh()))

  // One stream per open tab. Navidrome is polled only while at least one is
  // connected, and every tab sees the same state.
  app.get('/api/events', (c) => {
    const { jukebox } = c.var.live
    return streamSSE(c, async (stream) => {
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
    })
  })

  app.post('/api/jukebox', async (c) => {
    const command = await c.req.json<JukeboxCommand>().catch(() => null)
    if (!command || typeof command.action !== 'string') {
      throw new CommandError('Expected a JSON command with an action')
    }
    return c.json(await c.var.live.jukebox.run(command))
  })

  app.get('/api/library/:endpoint', async (c) => {
    const endpoint = c.req.param('endpoint')
    if (!LIBRARY_ENDPOINTS.includes(endpoint as LibraryEndpoint)) {
      return c.json({ error: `Unknown library endpoint ${endpoint}` }, 404)
    }
    const payload = await c.var.live.subsonic.call(endpoint, c.req.query())
    // Drop the envelope fields; the browser only wants the result.
    for (const key of ['status', 'version', 'type', 'serverVersion', 'openSubsonic']) {
      delete payload[key]
    }
    if (endpoint === 'getPlaylists' || endpoint === 'getPlaylist') {
      markEditable(payload, c.var.live.user)
    }
    return c.json(payload)
  })

  app.get('/api/cover/:id', async (c) => {
    const requested = Number(c.req.query('size') ?? 512)
    const size = COVER_SIZES.has(requested) ? requested : 512
    const res = await c.var.live.subsonic.fetch('getCoverArt', { id: c.req.param('id'), size })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !res.body || !type.startsWith('image/')) return c.body(null, 404)
    return c.body(res.body, 200, {
      'content-type': type,
      // Art for an id rarely changes, and the browser cache saves a round
      // trip through Navidrome for every queue row.
      'cache-control': 'private, max-age=86400',
    })
  })

  // Audio for playing on this device. Range passes through so the browser
  // can seek; the Navidrome credentials never reach it.
  app.get('/api/stream/:id', async (c) => {
    const rate = Number(c.req.query('maxBitRate') ?? 0)
    const range = c.req.header('range')
    const res = await c.var.live.subsonic.fetch(
      'stream',
      { id: c.req.param('id'), maxBitRate: BIT_RATES.has(rate) && rate > 0 ? rate : undefined },
      { stream: true, signal: c.req.raw.signal, headers: range ? { range } : undefined },
    )
    const type = res.headers.get('content-type') ?? ''
    // Subsonic reports errors (a missing song, say) as a JSON or XML body with status 200.
    if (!res.ok && res.status !== 416) {
      await res.body?.cancel()
      return c.json({ error: `Navidrome returned HTTP ${res.status} for that song` }, 502)
    }
    if (/json|xml/.test(type)) {
      await res.body?.cancel()
      return c.json({ error: 'Navidrome couldn’t stream that song' }, 502)
    }
    const headers = new Headers({ 'cache-control': 'private, no-cache' })
    for (const name of STREAM_HEADERS) {
      const value = res.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(res.body, { status: res.status, headers })
  })

  // Play counts for songs played on a device. submission false is "now playing".
  app.post('/api/scrobble', async (c) => {
    const body = await c.req.json<{ id?: unknown; submission?: unknown }>().catch(() => null)
    if (!body || typeof body.id !== 'string' || !body.id) {
      return c.json({ error: 'Expected a song id' }, 400)
    }
    await c.var.live.subsonic.call('scrobble', {
      id: body.id,
      submission: body.submission !== false,
      time: Date.now(),
    })
    return c.json({ ok: true })
  })

  // Ask: songs from the library for a request in plain words. Off (404)
  // unless an Anthropic API key is set.
  let asking = 0
  app.post('/api/ask', async (c) => {
    const ask = deps.ask
    if (!ask) return c.json({ error: 'Ask is off: no Anthropic API key is set' }, 404)
    const body = await c.req.json<Partial<AskRequest>>().catch(() => null)
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) throw new AskError('Say what you’d like to hear', 400)
    if (prompt.length > MAX_PROMPT) {
      throw new AskError(`Keep it to ${MAX_PROMPT} characters or fewer`, 400)
    }
    const playing = body?.nowPlaying
    const nowPlaying =
      playing && typeof playing.id === 'string' && typeof playing.title === 'string'
        ? {
            id: playing.id,
            title: playing.title.slice(0, 200),
            artist: playing.artist?.slice(0, 200),
            album: playing.album?.slice(0, 200),
          }
        : undefined
    if (asking >= MAX_ASKS) throw new AskError('Already picking songs. Try again in a moment.', 429)
    asking++
    try {
      return c.json(await ask(c.var.live.subsonic.call, { prompt, nowPlaying }))
    } finally {
      asking--
    }
  })

  playlistRoutes(app)

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  if (deps.staticDir) {
    // Built assets have content hashes in their names, so they can be cached
    // for good. Everything else (index.html above all) is checked on each
    // load, or a home-screen app on iOS keeps running an old version.
    const cacheHeaders = (path: string, c: Context) => {
      c.header(
        'cache-control',
        path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      )
    }
    app.use('/*', serveStatic({ root: deps.staticDir, onFound: cacheHeaders }))
    // Client-side routes live in the hash, so any other path is the app shell.
    app.get('/*', serveStatic({ root: deps.staticDir, path: 'index.html', onFound: cacheHeaders }))
  }

  return app
}

function allPassed(checks: { ok: boolean }[]): boolean {
  return checks.length === 3 && checks.every((check) => check.ok)
}

function defaultConnect(settings: Settings): SubsonicClient {
  return createSubsonicClient({
    baseUrl: settings.navidromeUrl,
    user: settings.navidromeUser,
    password: settings.navidromePassword,
  })
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https'
}

/** The peer address, for throttling. Not X-Forwarded-For, which any client can set. */
function clientAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    // app.request() in tests has no socket.
    return 'local'
  }
}
