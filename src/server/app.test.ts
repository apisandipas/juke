import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ConnectionCheck, JukeConfig, SetupFields } from '@shared/types'
import { createApp } from '@server/app'
import { ConfigStore, type Settings } from '@server/config'
import { SubsonicError, type SubsonicClient } from '@server/subsonic'

const CODE = 'ABCD-EFGH'

/** A Navidrome that knows one account and can be told to misbehave. */
function fakeNavidrome(opts: { password?: string; admin?: boolean; jukebox?: boolean } = {}) {
  const connected: Settings[] = []
  const connect = (settings: Settings): SubsonicClient => {
    connected.push(settings)
    const call: SubsonicClient['call'] = async (endpoint) => {
      if (settings.navidromeUrl.includes('unreachable')) {
        throw new SubsonicError('no answer from unreachable (ECONNREFUSED)', 0)
      }
      if (settings.navidromePassword !== (opts.password ?? 'nd-secret')) {
        throw new SubsonicError('Wrong username or password', 40)
      }
      switch (endpoint) {
        case 'ping':
          return {}
        case 'getUser':
          return { user: { username: settings.navidromeUser, adminRole: opts.admin ?? true } }
        case 'jukeboxControl':
          if (opts.jukebox === false || opts.admin === false) {
            throw new SubsonicError('Jukebox is disabled', 0)
          }
          return {
            jukeboxPlaylist: { currentIndex: -1, playing: false, gain: 1, position: 0, entry: [] },
          }
        default:
          return {}
      }
    }
    return { call, fetch: async () => new Response(null, { status: 404 }) }
  }
  return { connect, connected }
}

function setup(env: Record<string, string> = {}, navidrome = fakeNavidrome()) {
  const dir = mkdtempSync(join(tmpdir(), 'juke-test-'))
  const store = new ConfigStore(env, dir)
  const app = createApp({
    store,
    connect: navidrome.connect,
    setupCode: store.settings() ? null : CODE,
  })
  const post = (path: string, body: unknown, cookie?: string) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
  const get = (path: string, cookie?: string) =>
    app.request(path, cookie ? { headers: { cookie } } : undefined)
  return { app, store, dir, post, get, navidrome }
}

const FORM = {
  code: CODE,
  navidromeUrl: 'http://music.local:4533/',
  navidromeUser: 'alex',
  navidromePassword: 'nd-secret',
  name: 'Living room',
  jukePassword: 'juke-password',
}

const cookieFrom = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? ''

describe('configured from the environment', () => {
  const env = { NAVIDROME_USER: 'alex', NAVIDROME_PASSWORD: 'nd-secret' }

  it('starts without setup or sign-in when no juke password is set', async () => {
    const { get } = setup(env)
    const config = (await (await get('/api/config')).json()) as JukeConfig
    expect(config).toEqual({
      name: 'the jukebox',
      needsSetup: false,
      auth: { enabled: false, signedIn: true },
      ask: false,
    })
    expect((await get('/api/state')).status).toBe(200)
  })

  it('refuses the setup routes', async () => {
    const { get, post } = setup(env)
    expect((await get('/api/setup')).status).toBe(409)
    expect((await post('/api/setup', FORM)).status).toBe(409)
  })

  it('asks for JUKE_PASSWORD when it is set', async () => {
    const { get, post } = setup({ ...env, JUKE_PASSWORD: 'let-me-in', JUKE_NAME: 'Kitchen' })
    const before = (await (await get('/api/config')).json()) as JukeConfig
    expect(before.name).toBe('Kitchen')
    expect(before.auth).toEqual({ enabled: true, signedIn: false })
    expect((await get('/api/state')).status).toBe(401)

    expect((await post('/api/login', { password: 'nope' })).status).toBe(401)
    const login = await post('/api/login', { password: 'let-me-in' })
    expect(login.status).toBe(200)
    const cookie = cookieFrom(login)
    expect(cookie).toMatch(/^juke_session=/)
    expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/i)
    expect((await get('/api/state', cookie)).status).toBe(200)
  })
})

describe('setup form', () => {
  it('blocks the API until set up', async () => {
    const { get } = setup()
    expect((await get('/api/state')).status).toBe(503)
    const config = (await (await get('/api/config')).json()) as JukeConfig
    expect(config.needsSetup).toBe(true)
  })

  it('shows environment values and their sources, never secrets', async () => {
    const { get } = setup({ NAVIDROME_URL: 'http://nd:4533', NAVIDROME_PASSWORD: 'nd-secret' })
    const { fields } = (await (await get('/api/setup')).json()) as { fields: SetupFields }
    expect(fields.navidromeUrl).toEqual({
      value: 'http://nd:4533',
      source: 'env',
      env: 'NAVIDROME_URL',
    })
    expect(fields.navidromeUser.source).toBe('missing')
    expect(fields.navidromePassword).toEqual({
      value: '',
      source: 'env',
      env: 'NAVIDROME_PASSWORD',
    })
    expect(fields.name).toMatchObject({ value: 'the jukebox', source: 'default' })
  })

  it('needs the setup code, ignoring case and the dash', async () => {
    const { post } = setup()
    const wrong = await post('/api/setup/test', { ...FORM, code: 'WRONG-CODE' })
    expect(wrong.status).toBe(403)
    const loose = await post('/api/setup/test', { ...FORM, code: 'abcd efgh' })
    expect(loose.status).toBe(200)
  })

  it('stops accepting codes after repeated wrong guesses', async () => {
    const { post } = setup()
    for (let i = 0; i < 10; i++) await post('/api/setup/test', { ...FORM, code: 'NOPE' })
    expect((await post('/api/setup/test', FORM)).status).toBe(429)
  })

  it('reports which connection check failed', async () => {
    const checks = async (form: object, navidrome = fakeNavidrome()) => {
      const res = await setup({}, navidrome).post('/api/setup/test', { ...FORM, ...form })
      return ((await res.json()) as { checks: ConnectionCheck[] }).checks
    }
    const failed = (list: ConnectionCheck[]) => list.find((c) => !c.ok)

    expect((await checks({})).every((c) => c.ok)).toBe(true)
    expect(failed(await checks({ navidromeUrl: 'http://unreachable' }))?.id).toBe('reach')
    expect(failed(await checks({ navidromePassword: 'wrong' }))?.id).toBe('signIn')
    const notAdmin = failed(await checks({}, fakeNavidrome({ admin: false })))
    expect(notAdmin?.id).toBe('jukebox')
    expect(notAdmin?.detail).toMatch(/isn't a Navidrome admin/)
    const off = failed(await checks({}, fakeNavidrome({ jukebox: false })))
    expect(off?.detail).toMatch(/ND_JUKEBOX_ENABLED/)
  })

  it('saves, starts the jukebox and signs the device in', async () => {
    const { post, get, store, dir } = setup()
    const res = await post('/api/setup', FORM)
    expect(res.status).toBe(200)
    const config = (await res.json()) as JukeConfig
    expect(config).toMatchObject({ name: 'Living room', needsSetup: false })
    const cookie = cookieFrom(res)

    expect((await get('/api/state', cookie)).status).toBe(200)
    expect((await get('/api/state')).status).toBe(401)

    const file = join(dir, 'settings.json')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    expect(saved.navidromeUrl).toBe('http://music.local:4533')
    expect(saved.passwordHash).toMatch(/^scrypt\$/)
    expect(JSON.stringify(saved)).not.toContain('juke-password')

    // A restart reads the same file and keeps the device signed in.
    const restarted = createApp({
      store: new ConfigStore({}, dir),
      connect: fakeNavidrome().connect,
    })
    expect((await restarted.request('/api/state', { headers: { cookie } })).status).toBe(200)
    expect(store.settings()?.name).toBe('Living room')

    // The setup routes close once it's done.
    expect((await post('/api/setup', FORM)).status).toBe(409)
  })

  it('keeps environment values over the form', async () => {
    const navidrome = fakeNavidrome()
    const { post, dir } = setup({ NAVIDROME_URL: 'http://from-env:4533' }, navidrome)
    expect((await post('/api/setup', FORM)).status).toBe(200)
    expect(navidrome.connected.at(-1)?.navidromeUrl).toBe('http://from-env:4533')
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as object
    expect(saved).not.toHaveProperty('navidromeUrl')
  })

  it('refuses to save when a check fails, or the juke password is short', async () => {
    const { post, dir } = setup()
    expect((await post('/api/setup', { ...FORM, navidromePassword: 'wrong' })).status).toBe(422)
    expect((await post('/api/setup', { ...FORM, jukePassword: 'short' })).status).toBe(400)
    expect(() => statSync(join(dir, 'settings.json'))).toThrow()
  })

  it('needs no juke password in the form when JUKE_PASSWORD is set', async () => {
    const { post } = setup({ JUKE_PASSWORD: 'let-me-in' })
    const res = await post('/api/setup', { ...FORM, jukePassword: undefined })
    expect(res.status).toBe(200)
    expect((await post('/api/login', { password: 'let-me-in' })).status).toBe(200)
  })
})
