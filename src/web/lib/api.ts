import type {
  Album,
  Artist,
  ConnectionCheck,
  JukeConfig,
  JukeboxCommand,
  JukeboxState,
  LibraryEndpoint,
  Playlist,
  SetupFields,
  SetupRequest,
  Song,
} from '@shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Extra fields the server sent with the error, such as `field` or `checks`. */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Fired when the server says juke needs setting up or this device needs to
 * sign in, so the app can swap to that screen from wherever the call was.
 */
export const GATE_EVENT = 'juke:gate'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError('Juke server is unreachable', 0)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>
  if (!res.ok) {
    if (body.auth === true || body.setup === true) window.dispatchEvent(new Event(GATE_EVENT))
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body)
  }
  return body as T
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const session = {
  config: () => request<JukeConfig>('/api/config'),
  signIn: (password: string) => request<JukeConfig>('/api/login', json({ password })),
  signOut: () => request<JukeConfig>('/api/logout', json({})),
  setupFields: () => request<{ fields: SetupFields; minPassword: number }>('/api/setup'),
  testSetup: (form: SetupRequest) =>
    request<{ checks: ConnectionCheck[]; ok: boolean }>('/api/setup/test', json(form)),
  saveSetup: (form: SetupRequest) => request<JukeConfig>('/api/setup', json(form)),
}

export function sendCommand(command: JukeboxCommand): Promise<JukeboxState> {
  return request('/api/jukebox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
}

function library<T>(endpoint: LibraryEndpoint, params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  return request<T>(`/api/library/${endpoint}?${qs}`)
}

export type AlbumListType = 'newest' | 'recent' | 'frequent' | 'alphabeticalByName' | 'random'

export const api = {
  albumList: (type: AlbumListType, offset: number, size = 40) =>
    library<{ albumList2: { album?: Album[] } }>('getAlbumList2', { type, offset, size }).then(
      (r) => r.albumList2.album ?? [],
    ),
  album: (id: string) => library<{ album: Album }>('getAlbum', { id }).then((r) => r.album),
  artists: () =>
    library<{ artists: { index?: { name: string; artist?: Artist[] }[] } }>('getArtists').then(
      (r) => (r.artists.index ?? []).map((i) => ({ letter: i.name, artists: i.artist ?? [] })),
    ),
  artist: (id: string) => library<{ artist: Artist }>('getArtist', { id }).then((r) => r.artist),
  playlists: () =>
    library<{ playlists: { playlist?: Playlist[] } }>('getPlaylists').then(
      (r) => r.playlists.playlist ?? [],
    ),
  playlist: (id: string) =>
    library<{ playlist: Playlist }>('getPlaylist', { id }).then((r) => r.playlist),
  search: (query: string) =>
    library<{ searchResult3: { artist?: Artist[]; album?: Album[]; song?: Song[] } }>('search3', {
      query,
      artistCount: 5,
      albumCount: 8,
      songCount: 20,
    }).then((r) => ({
      artists: r.searchResult3.artist ?? [],
      albums: r.searchResult3.album ?? [],
      songs: r.searchResult3.song ?? [],
    })),
}

type PlaylistReply = { playlist: Playlist }
const playlistPath = (id: string) => `/api/playlists/${encodeURIComponent(id)}`

/** Changes to Navidrome playlists. Each answers with the playlist as it now is. */
export const playlistApi = {
  create: (name: string, songIds: string[] = []) =>
    request<PlaylistReply>('/api/playlists', json({ name, songIds })).then((r) => r.playlist),
  rename: (id: string, name: string) =>
    request<PlaylistReply>(playlistPath(id), json({ name }, 'PATCH')).then((r) => r.playlist),
  add: (id: string, songIds: string[]) =>
    request<PlaylistReply>(playlistPath(id), json({ add: songIds }, 'PATCH')).then(
      (r) => r.playlist,
    ),
  /** Replace the songs; refused if the playlist no longer holds `expect`. */
  setSongs: (id: string, songIds: string[], expect: string[]) =>
    request<PlaylistReply>(`${playlistPath(id)}/songs`, json({ songIds, expect }, 'PUT')).then(
      (r) => r.playlist,
    ),
  remove: (id: string) =>
    request<{ ok: true }>(playlistPath(id), { method: 'DELETE' }).then(() => undefined),
}

export type CoverSize = 64 | 128 | 256 | 512 | 1024

export function coverUrl(id: string | undefined, size: CoverSize): string | undefined {
  return id ? `/api/cover/${encodeURIComponent(id)}?size=${size}` : undefined
}
