import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '@server/app'
import { ConfigStore } from '@server/config'
import type { CallOptions, Params, SubsonicClient } from '@server/subsonic'

const AUDIO = new Uint8Array(100).map((_, i) => i)

/** A Navidrome that streams one song, honouring Range, and records calls. */
function setup() {
  const fetches: { endpoint: string; params: Params; options?: CallOptions }[] = []
  const calls: { endpoint: string; params: Params }[] = []
  const client: SubsonicClient = {
    call: async (endpoint, params = {}) => {
      calls.push({ endpoint, params })
      return {}
    },
    fetch: async (endpoint, params = {}, options) => {
      fetches.push({ endpoint, params, options })
      if (params.id !== 'song') {
        return Response.json({ 'subsonic-response': { status: 'failed' } })
      }
      const range = options?.headers?.range?.match(/bytes=(\d+)-(\d*)/)
      if (!range) {
        return new Response(AUDIO, {
          headers: { 'content-type': 'audio/flac', 'accept-ranges': 'bytes', 'x-secret': 'no' },
        })
      }
      const start = Number(range[1])
      const end = range[2] ? Number(range[2]) : AUDIO.length - 1
      return new Response(AUDIO.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-type': 'audio/flac',
          'content-range': `bytes ${start}-${end}/${AUDIO.length}`,
          'content-length': String(end - start + 1),
        },
      })
    },
  }
  const store = new ConfigStore(
    { NAVIDROME_USER: 'alex', NAVIDROME_PASSWORD: 'secret' },
    mkdtempSync(join(tmpdir(), 'juke-test-')),
  )
  const app = createApp({ store, connect: () => client })
  return { app, fetches, calls }
}

describe('streaming to this device', () => {
  it('streams a whole song with only the headers the browser needs', async () => {
    const { app, fetches } = setup()
    const res = await app.request('/api/stream/song')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/flac')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('x-secret')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO)
    expect(fetches[0]?.options?.stream).toBe(true)
  })

  it('passes Range through for seeking', async () => {
    const { app } = setup()
    const res = await app.request('/api/stream/song', { headers: { range: 'bytes=10-19' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO.slice(10, 20))
  })

  it('accepts only known bit rates', async () => {
    const { app, fetches } = setup()
    await app.request('/api/stream/song?maxBitRate=192')
    await app.request('/api/stream/song?maxBitRate=7')
    expect(fetches.map((f) => f.params.maxBitRate)).toEqual([192, undefined])
  })

  it('reports a Subsonic error body as a failure, not audio', async () => {
    const { app } = setup()
    const res = await app.request('/api/stream/missing')
    expect(res.status).toBe(502)
  })

  it('scrobbles plays and now-playing', async () => {
    const { app, calls } = setup()
    const post = (body: unknown) =>
      app.request('/api/scrobble', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ id: 'song' })).status).toBe(200)
    expect((await post({ id: 'song', submission: false })).status).toBe(200)
    expect((await post({})).status).toBe(400)
    const scrobbles = calls.filter((c) => c.endpoint === 'scrobble')
    expect(scrobbles.map((c) => c.params.submission)).toEqual([true, false])
  })
})
