import type {
  Album,
  Artist,
  JukeboxCommand,
  JukeboxState,
  LibraryEndpoint,
  Playlist,
  Song,
} from '@shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError('Juke server is unreachable', 0)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status)
  return body as T
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

export type CoverSize = 64 | 128 | 256 | 512 | 1024

export function coverUrl(id: string | undefined, size: CoverSize): string | undefined {
  return id ? `/api/cover/${encodeURIComponent(id)}?size=${size}` : undefined
}
