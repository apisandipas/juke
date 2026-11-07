import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Playlist } from '@shared/types'
import { createApp } from '@server/app'
import { ConfigStore } from '@server/config'
import { SubsonicError, type CallOptions, type Params, type SubsonicClient } from '@server/subsonic'

interface Stored {
  id: string
  name: string
  owner: string
  songs: string[]
  readonly?: boolean
}

/** A Navidrome holding playlists in memory, with the owner rule Navidrome enforces. */
function fakeNavidrome() {
  const playlists: Stored[] = [
    { id: 'mine', name: 'Mine', owner: 'alex', songs: ['a', 'b', 'c'] },
    { id: 'theirs', name: 'Theirs', owner: 'sam', songs: ['a'] },
    { id: 'smart', name: 'Recently added', owner: 'alex', songs: ['b'], readonly: true },
  ]
  const calls: { endpoint: string; params: Params; options?: CallOptions }[] = []
  let next = 1

  const list = (v: Params[string]) =>
    (v === undefined ? [] : Array.isArray(v) ? v : [v]).map(String)
  const view = (p: Stored): Playlist => ({
    id: p.id,
    name: p.name,
    owner: p.owner,
    songCount: p.songs.length,
    entry: p.songs.map((id) => ({ id, title: id })),
    ...(p.readonly ? { readonly: true } : {}),
  })
  const owned = (id: Params[string]) => {
    const p = playlists.find((x) => x.id === id)
    if (!p) throw new SubsonicError('Playlist not found', 70)
    if (p.owner !== 'alex' || p.readonly) throw new SubsonicError('Not authorized', 50)
    return p
  }

  const call: SubsonicClient['call'] = async (endpoint, params = {}, options) => {
    calls.push({ endpoint, params, options })
    switch (endpoint) {
      case 'getPlaylists':
        return { playlists: { playlist: playlists.map(view) } }
      case 'getPlaylist': {
        const p = playlists.find((x) => x.id === params.id)
        if (!p) throw new SubsonicError('Playlist not found', 70)
        return { playlist: view(p) }
      }
      case 'createPlaylist': {
        if (params.playlistId) {
          const p = owned(params.playlistId)
          p.songs = list(params.songId)
          return { playlist: view(p) }
        }
        const p = {
          id: `new${next++}`,
          name: String(params.name),
          owner: 'alex',
          songs: list(params.songId),
        }
        playlists.push(p)
        return { playlist: view(p) }
      }
      case 'updatePlaylist': {
        const p = owned(params.playlistId)
        if (params.name !== undefined) p.name = String(params.name)
        p.songs.push(...list(params.songIdToAdd))
        return {}
      }
      case 'deletePlaylist':
        playlists.splice(playlists.indexOf(owned(params.id)), 1)
        return {}
      default:
        return {}
    }
  }
  return {
    playlists,
    calls,
    connect: (): SubsonicClient => ({
      call,
      fetch: async () => new Response(null, { status: 404 }),
    }),
  }
}

function setup() {
  const navidrome = fakeNavidrome()
  const store = new ConfigStore(
    { NAVIDROME_USER: 'alex', NAVIDROME_PASSWORD: 'secret' },
    mkdtempSync(join(tmpdir(), 'juke-test-')),
  )
  const app = createApp({ store, connect: navidrome.connect })
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  }
  return { navidrome, send, get: (path: string) => send('GET', path) }
}

const songsOf = (json: Record<string, unknown>) =>
  ((json.playlist as Playlist).entry ?? []).map((s) => s.id)

describe('playlists', () => {
  it('marks which playlists juke can edit', async () => {
    const { get } = setup()
    const { json } = await get('/api/library/getPlaylists')
    const all = (json.playlists as { playlist: Playlist[] }).playlist
    expect(Object.fromEntries(all.map((p) => [p.id, p.editable]))).toEqual({
      mine: true,
      theirs: false,
      smart: false,
    })
    const one = await get('/api/library/getPlaylist?id=mine')
    expect((one.json.playlist as Playlist).editable).toBe(true)
  })

  it('creates a playlist with songs, sent as a form body', async () => {
    const { send, navidrome } = setup()
    const res = await send('POST', '/api/playlists', { name: '  Road trip ', songIds: ['a', 'b'] })
    expect(res.status).toBe(201)
    expect(res.json.playlist).toMatchObject({ name: 'Road trip', editable: true })
    expect(songsOf(res.json)).toEqual(['a', 'b'])
    const create = navidrome.calls.find((c) => c.endpoint === 'createPlaylist')
    expect(create?.options).toEqual({ post: true })
  })

  it('refuses a blank name or bad song ids', async () => {
    const { send } = setup()
    expect((await send('POST', '/api/playlists', { name: '   ' })).status).toBe(400)
    expect((await send('POST', '/api/playlists', { name: 'x', songIds: [1] })).status).toBe(400)
    expect((await send('PATCH', '/api/playlists/mine', {})).status).toBe(400)
  })

  it('renames and appends songs', async () => {
    const { send } = setup()
    const res = await send('PATCH', '/api/playlists/mine', { name: 'Renamed', add: ['d', 'a'] })
    expect(res.status).toBe(200)
    expect((res.json.playlist as Playlist).name).toBe('Renamed')
    expect(songsOf(res.json)).toEqual(['a', 'b', 'c', 'd', 'a'])
  })

  it('replaces the songs to reorder and remove', async () => {
    const { send } = setup()
    const res = await send('PUT', '/api/playlists/mine/songs', {
      songIds: ['c', 'a'],
      expect: ['a', 'b', 'c'],
    })
    expect(res.status).toBe(200)
    expect(songsOf(res.json)).toEqual(['c', 'a'])
  })

  it('refuses to overwrite a playlist that changed elsewhere', async () => {
    const { send, navidrome } = setup()
    const res = await send('PUT', '/api/playlists/mine/songs', {
      songIds: ['a'],
      expect: ['a', 'b'],
    })
    expect(res.status).toBe(409)
    expect(navidrome.playlists[0]?.songs).toEqual(['a', 'b', 'c'])
  })

  it('deletes', async () => {
    const { send, navidrome } = setup()
    expect((await send('DELETE', '/api/playlists/mine')).status).toBe(200)
    expect(navidrome.playlists.map((p) => p.id)).not.toContain('mine')
  })

  it("passes on Navidrome's refusal to touch someone else's playlist", async () => {
    const { send } = setup()
    const res = await send('DELETE', '/api/playlists/theirs')
    expect(res.status).toBe(502)
    expect(res.json.error).toBe('Not authorized')
  })
})
