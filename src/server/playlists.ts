import type { Hono } from 'hono'
import type { Playlist } from '@shared/types'
import type { SubsonicClient } from '@server/subsonic'

/** Longest playlist name juke accepts. Navidrome has no limit; this keeps the UI sane. */
export const MAX_NAME = 200
/** Most songs one write may carry. A whole large library in one playlist is still fine. */
export const MAX_SONGS = 10_000

export class PlaylistError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
    this.name = 'PlaylistError'
  }
}

/**
 * Whether juke may change this playlist: it belongs to the Navidrome account
 * juke signs in as, and it is not a smart playlist. Navidrome enforces the
 * owner itself; this only lets the web app hide controls that would fail.
 */
export function isEditable(
  playlist: Playlist & { readonly?: boolean; validUntil?: string },
  user: string,
) {
  // Smart playlists come back with readonly (and a validUntil) in OpenSubsonic.
  if (playlist.readonly || playlist.validUntil) return false
  return playlist.owner === undefined || playlist.owner === user
}

/** Marks each playlist in a getPlaylists or getPlaylist payload with `editable`. */
export function markEditable(payload: Record<string, unknown>, user: string) {
  const one = payload.playlist as Playlist | undefined
  if (one) one.editable = isEditable(one, user)
  const many = (payload.playlists as { playlist?: Playlist[] } | undefined)?.playlist
  for (const p of many ?? []) p.editable = isEditable(p, user)
}

export function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw new PlaylistError('Give the playlist a name')
  if (name.length > MAX_NAME) {
    throw new PlaylistError(`Keep the name to ${MAX_NAME} characters or fewer`)
  }
  return name
}

export function parseIds(value: unknown, field = 'songIds'): string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new PlaylistError(`Expected ${field} to be a list of song ids`)
  }
  if (value.length > MAX_SONGS) {
    throw new PlaylistError(`A playlist can take at most ${MAX_SONGS} songs at once`)
  }
  return value as string[]
}

async function body(req: { json: <T>() => Promise<T> }): Promise<Record<string, unknown>> {
  const parsed = await req.json<unknown>().catch(() => null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PlaylistError('Expected a JSON body')
  }
  return parsed as Record<string, unknown>
}

async function fetchPlaylist(subsonic: SubsonicClient, id: string): Promise<Playlist> {
  const payload = await subsonic.call('getPlaylist', { id })
  const playlist = payload.playlist as Playlist | undefined
  if (!playlist) throw new PlaylistError('That playlist no longer exists', 404)
  return playlist
}

interface Live {
  subsonic: SubsonicClient
  user: string
}

/**
 * Write routes for playlists. Reads stay on /api/library. Every write
 * answers with the playlist as it now is, marked editable, so the browser
 * can show it without a second request.
 */
export function playlistRoutes<L extends Live>(app: Hono<{ Variables: { live: L } }>) {
  const fresh = async (live: Live, id: string) => {
    const payload = { playlist: await fetchPlaylist(live.subsonic, id) }
    markEditable(payload, live.user)
    return payload
  }

  // New playlist, optionally with songs (save the queue, or "new playlist" from a song).
  app.post('/api/playlists', async (c) => {
    const input = await body(c.req)
    const name = parseName(input.name)
    const songIds = input.songIds === undefined ? [] : parseIds(input.songIds)
    const { live } = c.var
    const created = await live.subsonic.call(
      'createPlaylist',
      { name, songId: songIds },
      { post: true },
    )
    // Navidrome answers with the new playlist (Subsonic 1.14+).
    const id = (created.playlist as Playlist | undefined)?.id
    if (!id) throw new Error('Navidrome made the playlist but did not say which it was')
    return c.json(await fresh(live, id), 201)
  })

  // Rename and/or append songs.
  app.patch('/api/playlists/:id', async (c) => {
    const input = await body(c.req)
    const name = input.name === undefined ? undefined : parseName(input.name)
    const add = input.add === undefined ? [] : parseIds(input.add, 'add')
    if (name === undefined && add.length === 0) throw new PlaylistError('Nothing to change')
    const { live } = c.var
    const id = c.req.param('id')
    await live.subsonic.call(
      'updatePlaylist',
      { playlistId: id, name, songIdToAdd: add },
      { post: true },
    )
    return c.json(await fresh(live, id))
  })

  // Replace the songs: how removing and reordering are saved. `expect` is the
  // list of ids the browser was editing; if the playlist has changed since,
  // the write is refused instead of silently dropping the other change.
  app.put('/api/playlists/:id/songs', async (c) => {
    const input = await body(c.req)
    const songIds = parseIds(input.songIds)
    const expect = input.expect === undefined ? undefined : parseIds(input.expect, 'expect')
    const { live } = c.var
    const id = c.req.param('id')
    if (expect) {
      const now = (await fetchPlaylist(live.subsonic, id)).entry?.map((s) => s.id) ?? []
      if (now.length !== expect.length || now.some((songId, i) => songId !== expect[i])) {
        throw new PlaylistError(
          'This playlist changed somewhere else. Reload it and make the change again.',
          409,
        )
      }
    }
    await live.subsonic.call('createPlaylist', { playlistId: id, songId: songIds }, { post: true })
    return c.json(await fresh(live, id))
  })

  app.delete('/api/playlists/:id', async (c) => {
    await c.var.live.subsonic.call('deletePlaylist', { id: c.req.param('id') })
    return c.json({ ok: true })
  })
}
