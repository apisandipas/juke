// The one place juke reaches Claude, through TanStack AI's Anthropic adapter
// (the same stack as Briefcase). Tests swap the whole Ask function for a fake.
import {
  chat,
  combineStrategies,
  maxIterations,
  toolDefinition,
  untilFinishReason,
} from '@tanstack/ai'
import { ANTHROPIC_MODELS, createAnthropicChat } from '@tanstack/ai-anthropic'
import { z } from 'zod'
import type { AskRequest, AskResult, Song } from '@shared/types'
import type { SubsonicCall } from '@server/subsonic'

export type AskModel = (typeof ANTHROPIC_MODELS)[number]
export const DEFAULT_ASK_MODEL: AskModel = 'claude-opus-5-5'
export const MAX_PROMPT = 500
/** Most artists list_artists returns; enough for most home libraries, and bounded in cost. */
const MAX_ARTISTS = 1500
/** Albums artist_songs opens for one artist. */
const MAX_ARTIST_ALBUMS = 6
/** Most songs one answer may hold. */
export const MAX_PICKS = 40
/** Model turns before it must answer, so one ask can't run up a bill. */
const MAX_TURNS = 8

/** A short line saying what Ask is doing now, for the person waiting. */
export type AskStep = (text: string) => void

/** Turns a request into picks from the library. Swapped for a fake in tests. */
export type Ask = (call: SubsonicCall, request: AskRequest, step?: AskStep) => Promise<AskResult>

export class AskError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 422 | 429 | 502 | 503 = 502,
  ) {
    super(message)
    this.name = 'AskError'
  }
}

/** The model to use: ANTHROPIC_MODEL if it names one the adapter knows, else the default. */
export function askModel(name: string | undefined): AskModel {
  if (!name) return DEFAULT_ASK_MODEL
  if ((ANTHROPIC_MODELS as readonly string[]).includes(name)) return name as AskModel
  console.warn(
    `juke: ANTHROPIC_MODEL ${name} isn't a known Claude model; using ${DEFAULT_ASK_MODEL}`,
  )
  return DEFAULT_ASK_MODEL
}

const SYSTEM = `You pick music for someone from their own music library, which is served by Navidrome.

Use the tools to look through the library, then answer with the songs to play. Every song you pick must have come back from a tool in this conversation; use its exact id. Never invent ids or suggest music the library doesn't have.

How to choose:
- Read the request for mood, tempo, era, genre, vocals or not, and length. "An hour" is about 15 songs; with no length given, pick 12 to 20.
- Genre tags are often missing or too broad: many libraries tag only some artists, or tag everything "Pop" or "Rock". So start with list_artists alongside list_genres, and use what you know about each artist's style to find the ones that fit; then get their songs with artist_songs. Treat the tags as a hint, not the whole picture.
- Use search when the request names artists, albums or songs.
- Mix artists unless the request asks for one. Avoid two songs from the same album in a row.
- Order the songs so they flow as a set.
- Someone is waiting with the app open. Make independent tool calls together in one turn, and stop looking once you have enough to choose from.
- If the library has nothing that fits, return no picks and say why in the title.

Each pick gets a short reason, under 15 words, about why it fits this request. The title names the set in a few words.`

const PickSchema = z.object({
  title: z.string().describe('A short name for the set, a few words'),
  picks: z
    .array(
      z.object({
        id: z.string().describe('The song id, exactly as a tool returned it'),
        reason: z.string().describe('Why this song fits, under 15 words'),
      }),
    )
    .describe('The songs to play, in order'),
})

/** The fields of a song worth showing the model; less text, lower cost. */
function brief(song: Song & { genre?: string; playCount?: number }) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    year: song.year,
    genre: song.genre,
    seconds: song.duration,
    plays: song.playCount,
  }
}

interface AlbumLike {
  id: string
  name: string
  artist?: string
  year?: number
  genre?: string
  songCount?: number
  playCount?: number
}
const briefAlbum = (a: AlbumLike) => ({
  id: a.id,
  name: a.name,
  artist: a.artist,
  year: a.year,
  genre: a.genre,
  songs: a.songCount,
  plays: a.playCount,
})

/**
 * The read-only library tools the model may call. Every song a tool returns
 * is recorded in `seen`, which is the only place picks can come from.
 */
export function libraryTools(
  call: SubsonicCall,
  seen: Map<string, Song>,
  step: AskStep = () => {},
) {
  const songs = (list: unknown) => {
    const out = (Array.isArray(list) ? list : []) as Song[]
    for (const s of out) seen.set(s.id, s)
    return out.map(brief)
  }
  const count = z.number().int().min(1).max(50)

  return [
    toolDefinition({
      name: 'search_library',
      description:
        'Search artists, albums and songs by name. Use for requests that name an artist, album or song.',
      inputSchema: z.object({ query: z.string().min(1) }),
    }).server(async ({ query }) => {
      step(`Searching for “${query}”`)
      const r = await call('search3', { query, artistCount: 5, albumCount: 10, songCount: 25 })
      const found = (r.searchResult3 ?? {}) as {
        artist?: { id: string; name: string; albumCount?: number }[]
        album?: AlbumLike[]
        song?: Song[]
      }
      return {
        artists: (found.artist ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          albums: a.albumCount,
        })),
        albums: (found.album ?? []).map(briefAlbum),
        songs: songs(found.song),
      }
    }),
    toolDefinition({
      name: 'list_artists',
      description:
        'Every artist in the library, with an id and album count. Use your own knowledge of these artists to find ones that fit, especially when genre tags are missing.',
      inputSchema: z.object({}),
    }).server(async () => {
      step('Looking at artists')
      const r = await call('getArtists')
      const index = ((r.artists as { index?: unknown[] } | undefined)?.index ?? []) as {
        artist?: { id: string; name: string; albumCount?: number }[]
      }[]
      const all = index.flatMap((i) => i.artist ?? [])
      return {
        total: all.length,
        artists: all
          .slice(0, MAX_ARTISTS)
          .map((a) => ({ id: a.id, name: a.name, albums: a.albumCount })),
      }
    }),
    toolDefinition({
      name: 'artist_songs',
      description: `An artist's songs, from up to ${MAX_ARTIST_ALBUMS} of their albums, in one call.`,
      inputSchema: z.object({ id: z.string() }),
    }).server(async ({ id }) => {
      const r = await call('getArtist', { id })
      const artist = r.artist as { name: string; album?: AlbumLike[] } | undefined
      if (!artist) return { error: 'No such artist' }
      step(`Listening through ${artist.name}`)
      const albums = await Promise.all(
        (artist.album ?? [])
          .slice(0, MAX_ARTIST_ALBUMS)
          .map((a) => call('getAlbum', { id: a.id }).catch(() => ({}) as Record<string, unknown>)),
      )
      return {
        name: artist.name,
        albums: albums.flatMap((res) => {
          const album = res.album as (AlbumLike & { song?: unknown }) | undefined
          return album ? [{ name: album.name, year: album.year, songs: songs(album.song) }] : []
        }),
      }
    }),
    toolDefinition({
      name: 'list_genres',
      description: 'Every genre tag in the library, with how many songs and albums carry it.',
      inputSchema: z.object({}),
    }).server(async () => {
      step('Looking at genres')
      const r = await call('getGenres')
      const genres = ((r.genres as { genre?: unknown[] } | undefined)?.genre ?? []) as {
        value: string
        songCount?: number
        albumCount?: number
      }[]
      return genres
        .map((g) => ({ genre: g.value, songs: g.songCount, albums: g.albumCount }))
        .sort((a, b) => (b.songs ?? 0) - (a.songs ?? 0))
    }),
    toolDefinition({
      name: 'random_songs',
      description:
        'Random songs, optionally limited to one genre (exact name from list_genres) and a range of years.',
      inputSchema: z.object({
        genre: z.string().optional(),
        fromYear: z.number().int().optional(),
        toYear: z.number().int().optional(),
        count: count.optional(),
      }),
    }).server(async ({ genre, fromYear, toYear, count: size }) => {
      const years =
        fromYear && toYear ? ` from ${fromYear}–${toYear}` : fromYear ? ` from ${fromYear} on` : ''
      step(`Picking random ${genre ? `${genre} ` : ''}songs${years}`)
      const r = await call('getRandomSongs', { genre, fromYear, toYear, size: size ?? 30 })
      return songs((r.randomSongs as { song?: unknown } | undefined)?.song)
    }),
    toolDefinition({
      name: 'songs_by_genre',
      description: 'Songs tagged with one genre (exact name from list_genres), from an offset.',
      inputSchema: z.object({
        genre: z.string(),
        count: count.optional(),
        offset: z.number().int().min(0).optional(),
      }),
    }).server(async ({ genre, count: size, offset }) => {
      step(`Browsing ${genre}`)
      const r = await call('getSongsByGenre', { genre, count: size ?? 30, offset: offset ?? 0 })
      return songs((r.songsByGenre as { song?: unknown } | undefined)?.song)
    }),
    toolDefinition({
      name: 'list_albums',
      description:
        'Albums in an order: most played (frequent), recently played (recent), recently added (newest), starred, highest rated, or random.',
      inputSchema: z.object({
        order: z.enum(['frequent', 'recent', 'newest', 'starred', 'highest', 'random']),
        count: count.optional(),
      }),
    }).server(async ({ order, count: size }) => {
      const what = {
        frequent: 'most played',
        recent: 'recently played',
        newest: 'newest',
        starred: 'starred',
        highest: 'highest rated',
        random: 'random',
      }[order]
      step(`Checking ${what} albums`)
      const r = await call('getAlbumList2', { type: order, size: size ?? 20 })
      const albums = ((r.albumList2 as { album?: unknown[] } | undefined)?.album ??
        []) as AlbumLike[]
      return albums.map(briefAlbum)
    }),
    toolDefinition({
      name: 'get_album',
      description: "An album's songs, in track order.",
      inputSchema: z.object({ id: z.string() }),
    }).server(async ({ id }) => {
      const r = await call('getAlbum', { id })
      const album = r.album as (AlbumLike & { song?: unknown }) | undefined
      if (!album) return { error: 'No such album' }
      step(`Looking at ${album.name}`)
      return { ...briefAlbum(album), songs: songs(album.song) }
    }),
    toolDefinition({
      name: 'get_artist',
      description: "An artist's albums.",
      inputSchema: z.object({ id: z.string() }),
    }).server(async ({ id }) => {
      const r = await call('getArtist', { id })
      const artist = r.artist as { name: string; album?: AlbumLike[] } | undefined
      if (!artist) return { error: 'No such artist' }
      step(`Looking at ${artist.name}`)
      return { name: artist.name, albums: (artist.album ?? []).map(briefAlbum) }
    }),
  ]
}

/**
 * Keeps picks the library actually returned, once each, up to MAX_PICKS.
 * The model is told the same, but this is what makes it true.
 */
export function keepKnown(
  picks: { id: string; reason: string }[],
  seen: Map<string, Song>,
): AskResult['picks'] {
  const used = new Set<string>()
  const out: AskResult['picks'] = []
  for (const { id, reason } of picks) {
    const song = seen.get(id)
    if (!song || used.has(id)) continue
    used.add(id)
    out.push({ song, reason: reason.trim() })
    if (out.length === MAX_PICKS) break
  }
  return out
}

/** Ask backed by Claude, with the self-hoster's own key. */
export function createAsk(opts: { apiKey: string; model?: string }): Ask {
  const adapter = createAnthropicChat(askModel(opts.model), opts.apiKey)

  return async (call, request, step = () => {}) => {
    const seen = new Map<string, Song>()
    const playing = request.nowPlaying
    const context = playing
      ? `\n\nPlaying now: "${playing.title}" by ${playing.artist ?? 'unknown'}${
          playing.album ? `, from ${playing.album}` : ''
        } (id ${playing.id}).`
      : ''

    let output: z.infer<typeof PickSchema>
    try {
      output = await chat({
        adapter,
        // A refusal is retried on Anthropic's recommended model within the same request.
        modelOptions: { fallbacks: 'default' },
        // Picking songs is quick work; low effort keeps the wait short.
        // Nothing shows the thinking, so it isn't sent back.
        reasoning: { level: 'low', summary: false },
        agentLoopStrategy: combineStrategies([
          maxIterations(MAX_TURNS),
          untilFinishReason(['length']),
        ]),
        threadId: `ask:${Date.now()}`,
        systemPrompts: [SYSTEM],
        tools: libraryTools(call, seen, step),
        messages: [{ role: 'user', content: `${request.prompt}${context}` }],
        outputSchema: PickSchema,
      })
    } catch (err) {
      throw toAskError(err)
    }
    return { title: output.title.trim(), picks: keepKnown(output.picks, seen) }
  }
}

/** Plain-language errors for the person holding the phone; details go to the log. */
function toAskError(err: unknown): AskError {
  if (err instanceof AskError) return err
  console.error('juke: ask failed:', err)
  const status = (err as { status?: unknown }).status
  if (status === 401 || status === 403) {
    return new AskError('The Anthropic API key was refused. Check ANTHROPIC_API_KEY.', 503)
  }
  if (status === 429) {
    return new AskError('Too many requests to Anthropic right now. Try again in a minute.', 429)
  }
  return new AskError('Couldn’t pick songs this time. Try again, or ask another way.', 502)
}
