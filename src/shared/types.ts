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
  /** Smart playlists, which Navidrome fills from rules. */
  readonly?: boolean
  /** Set by juke: owned by juke's Navidrome account and not a smart playlist. */
  editable?: boolean
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
  /** expectId: the id the browser saw at `from`; the move is refused if it no longer matches. */
  | { action: 'move'; from: number; to: number; expectId?: string }
  | { action: 'clearUpcoming' }
  | { action: 'shuffleUpcoming' }

/** What the web app needs before anything else: is juke set up, and is this device signed in. */
export interface JukeConfig {
  /** What the UI calls the speakers, e.g. "Living room" or "the jukebox". */
  name: string
  needsSetup: boolean
  auth: { enabled: boolean; signedIn: boolean }
  /** Ask is on: the person running juke set an Anthropic API key. */
  ask: boolean
}

/** What the Ask box sends. */
export interface AskRequest {
  prompt: string
  /** What's playing, so "more like this" has something to go on. */
  nowPlaying?: Song
}

/** One line of /api/ask's streamed answer: progress, then the result or an error. */
export type AskEvent = { step: string } | { result: AskResult } | { error: string }

/** Songs picked from the library, each with why. */
export interface AskResult {
  title: string
  picks: { song: Song; reason: string }[]
}

export type SetupField =
  'navidromeUrl' | 'navidromeUser' | 'navidromePassword' | 'name' | 'jukePassword'

/** Where a setting's value comes from. Environment variables always win. */
export type SettingSource = 'env' | 'saved' | 'default' | 'missing'

/** Each field for the setup form. Secrets come back with an empty value and only their source. */
export type SetupFields = Record<SetupField, { value: string; source: SettingSource; env: string }>

/** What the setup form sends. Empty or omitted fields keep the value juke already has. */
export interface SetupRequest {
  code: string
  navidromeUrl?: string
  navidromeUser?: string
  navidromePassword?: string
  name?: string
  jukePassword?: string
}

export interface ConnectionCheck {
  id: 'reach' | 'signIn' | 'jukebox'
  label: string
  ok: boolean
  /** Why it failed and what to change. Absent when it passed. */
  detail?: string
}

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
