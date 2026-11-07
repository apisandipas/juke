import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AskRequest, JukeConfig, Song } from '@shared/types'
import { createApp } from '@server/app'
import { keepKnown, libraryTools, type Ask } from '@server/ask'
import { ConfigStore } from '@server/config'
import type { SubsonicCall, SubsonicClient } from '@server/subsonic'

const song = (id: string): Song => ({ id, title: `Song ${id}`, artist: 'Artist' })

function setup(ask?: Ask | null) {
  const call: SubsonicCall = async () => ({})
  const client: SubsonicClient = { call, fetch: async () => new Response(null, { status: 404 }) }
  const store = new ConfigStore(
    { NAVIDROME_USER: 'alex', NAVIDROME_PASSWORD: 'secret' },
    mkdtempSync(join(tmpdir(), 'juke-test-')),
  )
  const app = createApp({ store, connect: () => client, ask })
  const post = (body: unknown) =>
    app.request('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { app, post }
}

describe('Ask', () => {
  it('is off without a key: hidden in config, 404 on the route', async () => {
    const { app, post } = setup(null)
    const config = (await (await app.request('/api/config')).json()) as JukeConfig
    expect(config.ask).toBe(false)
    expect((await post({ prompt: 'jazz' })).status).toBe(404)
  })

  it('passes the prompt and what is playing to the model, and returns its picks', async () => {
    const seen: AskRequest[] = []
    const ask: Ask = async (_call, request) => {
      seen.push(request)
      return { title: 'Rainy Sunday', picks: [{ song: song('1'), reason: 'Slow and quiet' }] }
    }
    const { app, post } = setup(ask)
    const config = (await (await app.request('/api/config')).json()) as JukeConfig
    expect(config.ask).toBe(true)

    const res = await post({ prompt: '  rainy sunday  ', nowPlaying: { ...song('9'), extra: 1 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      title: 'Rainy Sunday',
      picks: [{ reason: 'Slow and quiet' }],
    })
    expect(seen[0]).toEqual({
      prompt: 'rainy sunday',
      nowPlaying: { id: '9', title: 'Song 9', artist: 'Artist', album: undefined },
    })
  })

  it('refuses an empty or very long prompt', async () => {
    const { post } = setup(async () => ({ title: '', picks: [] }))
    expect((await post({ prompt: '   ' })).status).toBe(400)
    expect((await post({ prompt: 'x'.repeat(501) })).status).toBe(400)
  })

  it('runs at most two asks at once', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { post } = setup(async () => {
      await gate
      return { title: '', picks: [] }
    })
    const first = post({ prompt: 'a' })
    const second = post({ prompt: 'b' })
    expect((await post({ prompt: 'c' })).status).toBe(429)
    release()
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
  })
})

describe('picks', () => {
  it('keeps only songs the library returned, once each', () => {
    const seen = new Map([
      ['a', song('a')],
      ['b', song('b')],
    ])
    const kept = keepKnown(
      [
        { id: 'a', reason: ' fits ' },
        { id: 'made-up', reason: 'not in the library' },
        { id: 'a', reason: 'again' },
        { id: 'b', reason: 'also fits' },
      ],
      seen,
    )
    expect(kept.map((p) => [p.song.id, p.reason])).toEqual([
      ['a', 'fits'],
      ['b', 'also fits'],
    ])
  })

  it('records every song a library tool returns', async () => {
    const call: SubsonicCall = async (endpoint) => {
      if (endpoint === 'getRandomSongs') return { randomSongs: { song: [song('r1'), song('r2')] } }
      if (endpoint === 'getAlbum') return { album: { id: 'al', name: 'Album', song: [song('t1')] } }
      return {}
    }
    const seen = new Map<string, Song>()
    const tools = libraryTools(call, seen)
    const run = (name: string, input: object) =>
      tools.find((t) => t.name === name)!.execute!(input as never) as Promise<unknown>
    const random = (await run('random_songs', { genre: 'Jazz' })) as { id: string }[]
    expect(random.map((s) => s.id)).toEqual(['r1', 'r2'])
    await run('get_album', { id: 'al' })
    expect([...seen.keys()]).toEqual(['r1', 'r2', 't1'])
  })
})
