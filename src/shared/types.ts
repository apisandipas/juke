// Shapes shared by the proxy and the web app. Subsonic types cover only the
// fields juke reads; Navidrome sends many more.

export interface Song {
  id: string
  title: string
  artist?: string
  artistId?: string
  album?: string
  albumId?: string
  track?: number
  discNumber?: number
  year?: number
  duration?: number
  coverArt?: string
}

export interface Album {
  id: string
  name: string
  artist?: string
  artistId?: string
  year?: number
  songCount?: number
  duration?: number
  coverArt?: string
  song?: Song[]
}

export interface Artist {
  id: string
  name: string
  albumCount?: number
  coverArt?: string
  album?: Album[]
}

export interface Playlist {
  id: string
  name: string
  comment?: string
  owner?: string
  songCount?: number
  duration?: number
  coverArt?: string
  entry?: Song[]
}

export interface JukeboxStatus {
  /** Index into the queue; -1 when nothing is selected. */
  currentIndex: number
  playing: boolean
  /** Volume, 0..1. */
  gain: number
  /** Whole seconds into the current track. */
  position: number
}

export interface JukeboxState {
  status: JukeboxStatus
  queue: Song[]
  /** Epoch ms when status.position was sampled, for client-side interpolation. */
  sampledAt: number
  /** Set when the last poll of Navidrome failed; the rest is the last good state. */
  error: string | null
}

export type JukeboxCommand =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'next' }
  | { action: 'previous' }
  | { action: 'seek'; position: number }
  | { action: 'jump'; index: number }
  | { action: 'volume'; gain: number }
  | { action: 'playNow'; ids: string[]; startIndex?: number }
  | { action: 'playNext'; ids: string[] }
  | { action: 'addToQueue'; ids: string[] }
  | { action: 'remove'; index: number }
  | { action: 'move'; from: number; to: number }
  | { action: 'clearUpcoming' }
  | { action: 'shuffleUpcoming' }

/** Read-only Subsonic endpoints the proxy forwards to the browser. */
export const LIBRARY_ENDPOINTS = [
  'getAlbumList2',
  'getAlbum',
  'getArtists',
  'getArtist',
  'getPlaylists',
  'getPlaylist',
  'search3',
] as const

export type LibraryEndpoint = (typeof LIBRARY_ENDPOINTS)[number]
