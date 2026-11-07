/**
 * A stand-in Navidrome for working on juke without a real Navidrome: the
 * Subsonic endpoints juke calls, an invented library, and a jukebox that
 * follows Navidrome 0.64's queue semantics and advances in real time.
 * Nothing plays; it only keeps time.
 *
 *   npm run dev:mock    # mock on :4599, proxy pointed at it, Vite on :5173
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

// ---- Invented library -------------------------------------------------------

const PALETTE = [
  '#c2410c',
  '#0f766e',
  '#7c3aed',
  '#be123c',
  '#1d4ed8',
  '#a16207',
  '#15803d',
  '#475569',
]

interface MockSong {
  id: string
  title: string
  artist: string
  artistId: string
  album: string
  albumId: string
  track: number
  discNumber: number
  year: number
  duration: number
  coverArt: string
}

const CATALOG: { artist: string; albums: { name: string; year: number; tracks: string[] }[] }[] = [
  {
    artist: 'The Lantern Arcade',
    albums: [
      {
        name: 'Neon on Wet Asphalt',
        year: 2021,
        tracks: [
          'Overture for Trams',
          'Coin-Op Heart',
          'Last Train Static',
          'Rain Check',
          'Arcade Lights Out',
        ],
      },
      {
        name: 'Quarter Past Midnight',
        year: 2024,
        tracks: [
          'B-Side Boulevard',
          'Jukebox Saint',
          'Slow Fade',
          'Two for a Dollar',
          'Closing Time Waltz',
          'Encore (Reprise)',
        ],
      },
    ],
  },
  {
    artist: 'Marisol Okafor-Lindqvist and the Very Long Band Name Ensemble',
    albums: [
      {
        name: 'An Album Title That Goes On Long Enough to Test Truncation Everywhere',
        year: 2019,
        tracks: [
          'Short',
          'A Song Whose Title Is Also Considerably Longer Than Most Song Titles Tend to Be',
          'Interlude',
        ],
      },
    ],
  },
  {
    artist: 'Copper Tides',
    albums: [
      {
        name: 'Low Water',
        year: 2016,
        tracks: ['Estuary', 'Salt Lines', 'Undertow', 'Harbour Bell'],
      },
      {
        name: 'High Water',
        year: 2018,
        tracks: ['Flood Stage', 'Levee', 'Silt', 'Driftwood', 'Moonrise'],
      },
    ],
  },
  {
    artist: 'Ghost Signal',
    albums: [
      {
        name: 'Carrier Wave',
        year: 2023,
        tracks: ['Handshake', 'Packet Loss', 'Ping', 'Timeout', 'Reconnect'],
      },
    ],
  },
  {
    artist: 'Bea & the Birch Trees',
    albums: [
      {
        name: 'Porch Songs',
        year: 2012,
        tracks: ['Screen Door', 'Lemonade', 'Fireflies', 'Gravel Road'],
      },
    ],
  },
]

const artists: { id: string; name: string; albumCount: number }[] = []
const albums: {
  id: string
  name: string
  artist: string
  artistId: string
  year: number
  coverArt: string
  songs: MockSong[]
}[] = []
const songs = new Map<string, MockSong>()

CATALOG.forEach((a, ai) => {
  const artistId = `ar-${ai}`
  artists.push({ id: artistId, name: a.artist, albumCount: a.albums.length })
  a.albums.forEach((al, li) => {
    const albumId = `al-${ai}-${li}`
    const list = al.tracks.map((title, ti) => {
      const song: MockSong = {
        id: `so-${ai}-${li}-${ti}`,
        title,
        artist: a.artist,
        artistId,
        album: al.name,
        albumId,
        track: ti + 1,
        discNumber: 1,
        year: al.year,
        duration: 140 + ((ai * 37 + li * 53 + ti * 71) % 200),
        coverArt: albumId,
      }
      songs.set(song.id, song)
      return song
    })
    albums.push({
      id: albumId,
      name: al.name,
      artist: a.artist,
      artistId,
      year: al.year,
      coverArt: albumId,
      songs: list,
    })
  })
})

const playlists = [
  {
    id: 'pl-0',
    name: 'Late Night Kitchen',
    comment: 'For doing dishes at 1am',
    ids: albums.flatMap((a) => a.songs.slice(0, 2).map((s) => s.id)),
  },
  { id: 'pl-1', name: 'Empty Playlist', comment: '', ids: [] as string[] },
]

const albumJson = (a: (typeof albums)[number]) => ({
  id: a.id,
  name: a.name,
  artist: a.artist,
  artistId: a.artistId,
  year: a.year,
  coverArt: a.coverArt,
  songCount: a.songs.length,
  duration: a.songs.reduce((s, x) => s + x.duration, 0),
})

// ---- Jukebox, after core/playback in Navidrome 0.64 -------------------------

const jb = {
  items: [] as MockSong[],
  index: -1,
  loaded: false,
  playing: false,
  gain: 1,
  /** Position in seconds at playStartedAt (or the paused position). */
  offset: 0,
  playStartedAt: 0,
}

function position(): number {
  return jb.playing ? jb.offset + (Date.now() - jb.playStartedAt) / 1000 : jb.offset
}

/** Advance through finished tracks the way Navidrome's track switcher does. */
function tick() {
  while (jb.playing && jb.items[jb.index] && position() >= jb.items[jb.index]!.duration) {
    const overshoot = position() - jb.items[jb.index]!.duration
    if (jb.index + 1 >= jb.items.length) {
      jb.playing = false
      jb.loaded = false
      jb.offset = 0
      return
    }
    jb.index++
    jb.offset = overshoot
    jb.playStartedAt = Date.now()
  }
}

function setPlaying(playing: boolean) {
  jb.offset = position()
  jb.playing = playing
  jb.playStartedAt = Date.now()
}

function status() {
  tick()
  return {
    currentIndex: jb.index,
    playing: jb.playing,
    gain: jb.gain,
    position: Math.floor(position()),
  }
}

function jukeboxControl(q: URLSearchParams) {
  tick()
  const ids = q.getAll('id')
  const action = q.get('action')
  switch (action) {
    case 'get':
      return { jukeboxPlaylist: { ...status(), entry: jb.items } }
    case 'status':
      break
    case 'set':
      jb.items = ids.map((id) => songs.get(id)!).filter(Boolean)
      jb.index = jb.items.length ? 0 : -1
      jb.loaded = false
      jb.playing = false
      jb.offset = 0
      break
    case 'add':
      jb.items.push(...ids.map((id) => songs.get(id)!).filter(Boolean))
      if (jb.index === -1 && jb.items.length) jb.index = 0
      break
    case 'start':
      if (jb.items.length) {
        jb.loaded = true
        setPlaying(true)
      }
      break
    case 'stop':
      setPlaying(false)
      break
    case 'skip': {
      const index = Number(q.get('index'))
      const was = jb.playing
      jb.index = Math.max(0, Math.min(index, jb.items.length - 1))
      jb.loaded = true
      jb.offset = Number(q.get('offset') ?? 0)
      jb.playStartedAt = Date.now()
      jb.playing = was
      break
    }
    case 'remove': {
      const index = Number(q.get('index'))
      if (jb.playing && index === jb.index) setPlaying(false)
      const current = jb.items[jb.index]?.id
      if (index >= 0 && index < jb.items.length) jb.items.splice(index, 1)
      jb.index = current ? jb.items.findIndex((s) => s.id === current) : -1
      break
    }
    case 'clear':
      jb.items = []
      jb.index = -1
      jb.playing = false
      jb.offset = 0
      break
    case 'setGain':
      jb.gain = Number(q.get('gain'))
      break
    default:
      throw new Error(`Unknown action: ${action}`)
  }
  return { jukeboxStatus: status() }
}

// ---- Audio ------------------------------------------------------------------

const tones = new Map<string, Uint8Array<ArrayBuffer>>()

/**
 * A quiet tone as long as the song, as an 8 kHz 8-bit mono WAV (about 0.5 MB a
 * minute), with a pitch per song so a track change is audible.
 */
function toneFor(song: MockSong): Uint8Array<ArrayBuffer> {
  const cached = tones.get(song.id)
  if (cached) return cached
  const rate = 8000
  const samples = song.duration * rate
  const out = new Uint8Array(44 + samples)
  const view = new DataView(out.buffer)
  const text = (at: number, value: string) =>
    [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  const n = [...song.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  const pitch = 220 * 2 ** ((n % 12) / 12)
  for (let i = 0; i < samples; i++) {
    out[44 + i] = 128 + Math.round(20 * Math.sin((2 * Math.PI * pitch * i) / rate))
  }
  tones.set(song.id, out)
  return out
}

// ---- HTTP -------------------------------------------------------------------

const app = new Hono()
const ok = (body: object) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } })
const fail = (code: number, message: string) => ({
  'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } },
})

app.on(['GET', 'POST'], '/rest/:endpoint', async (c) => {
  const q = new URL(c.req.url).searchParams
  // Writes arrive as a form body (OpenSubsonic formPost); merge it in.
  if (c.req.method === 'POST') {
    for (const [k, v] of new URLSearchParams(await c.req.text())) q.append(k, v)
  }
  // Every playlist belongs to whoever is asking, so all of them are editable.
  const owner = q.get('u') ?? 'mock'
  const endpoint = c.req.param('endpoint').replace(/\.view$/, '')
  const id = q.get('id') ?? ''
  try {
    switch (endpoint) {
      case 'ping':
        return c.json(ok({}))
      case 'getUser':
        return c.json(ok({ user: { username: q.get('username') ?? 'mock', adminRole: true } }))
      case 'jukeboxControl':
        return c.json(ok(jukeboxControl(q)))
      case 'getAlbumList2': {
        const type = q.get('type')
        let list = [...albums]
        if (type === 'alphabeticalByName') list.sort((a, b) => a.name.localeCompare(b.name))
        else if (type === 'newest') list.sort((a, b) => b.year - a.year)
        else if (type === 'random') list.sort(() => Math.random() - 0.5)
        else if (type === 'recent' || type === 'frequent') list = []
        const offset = Number(q.get('offset') ?? 0)
        const size = Number(q.get('size') ?? 10)
        return c.json(
          ok({ albumList2: { album: list.slice(offset, offset + size).map(albumJson) } }),
        )
      }
      case 'getAlbum': {
        const a = albums.find((x) => x.id === id)
        if (!a) return c.json(fail(70, 'Album not found'))
        return c.json(ok({ album: { ...albumJson(a), song: a.songs } }))
      }
      case 'getArtists': {
        const byLetter = new Map<string, typeof artists>()
        for (const a of [...artists].sort((x, y) => x.name.localeCompare(y.name))) {
          const letter = a.name[0]!.toUpperCase()
          byLetter.set(letter, [...(byLetter.get(letter) ?? []), a])
        }
        return c.json(
          ok({ artists: { index: [...byLetter].map(([name, artist]) => ({ name, artist })) } }),
        )
      }
      case 'getArtist': {
        const a = artists.find((x) => x.id === id)
        if (!a) return c.json(fail(70, 'Artist not found'))
        return c.json(
          ok({ artist: { ...a, album: albums.filter((x) => x.artistId === id).map(albumJson) } }),
        )
      }
      case 'getPlaylists':
        return c.json(
          ok({
            playlists: {
              playlist: playlists.map((p) => ({
                id: p.id,
                name: p.name,
                comment: p.comment,
                owner,
                songCount: p.ids.length,
                duration: p.ids.reduce((s, i) => s + songs.get(i)!.duration, 0),
                coverArt: p.ids[0] ? songs.get(p.ids[0])!.coverArt : undefined,
              })),
            },
          }),
        )
      case 'getPlaylist': {
        const p = playlists.find((x) => x.id === id)
        if (!p) return c.json(fail(70, 'Playlist not found'))
        const entry = p.ids.map((i) => songs.get(i)!)
        return c.json(
          ok({
            playlist: {
              id: p.id,
              name: p.name,
              comment: p.comment,
              owner,
              songCount: entry.length,
              duration: entry.reduce((s, x) => s + x.duration, 0),
              coverArt: entry[0]?.coverArt,
              entry,
            },
          }),
        )
      }
      case 'createPlaylist': {
        const ids = q.getAll('songId').filter((i) => songs.has(i))
        const existing = playlists.find((x) => x.id === q.get('playlistId'))
        if (q.get('playlistId') && !existing) return c.json(fail(70, 'Playlist not found'))
        const p = existing ?? {
          id: `pl-${Date.now()}`,
          name: q.get('name') ?? 'New playlist',
          comment: '',
          ids: [] as string[],
        }
        p.ids = ids
        if (!existing) playlists.push(p)
        return c.json(ok({ playlist: { id: p.id, name: p.name, owner, songCount: p.ids.length } }))
      }
      case 'updatePlaylist': {
        const p = playlists.find((x) => x.id === q.get('playlistId'))
        if (!p) return c.json(fail(70, 'Playlist not found'))
        const name = q.get('name')
        if (name !== null) p.name = name
        const drop = new Set(q.getAll('songIndexToRemove').map(Number))
        p.ids = p.ids.filter((_, i) => !drop.has(i))
        p.ids.push(...q.getAll('songIdToAdd').filter((i) => songs.has(i)))
        return c.json(ok({}))
      }
      case 'deletePlaylist': {
        const at = playlists.findIndex((x) => x.id === id)
        if (at < 0) return c.json(fail(70, 'Playlist not found'))
        playlists.splice(at, 1)
        return c.json(ok({}))
      }
      case 'search3': {
        const term = (q.get('query') ?? '').toLowerCase()
        const has = (s: string) => s.toLowerCase().includes(term)
        return c.json(
          ok({
            searchResult3: {
              artist: artists.filter((a) => has(a.name)),
              album: albums.filter((a) => has(a.name) || has(a.artist)).map(albumJson),
              song: [...songs.values()].filter((s) => has(s.title) || has(s.artist)).slice(0, 20),
            },
          }),
        )
      }
      case 'getCoverArt': {
        // The second album has no art, to exercise the placeholder.
        if (id === 'al-0-1') return c.body(null, 404)
        const n = [...id].reduce((s, ch) => s + ch.charCodeAt(0), 0)
        const bg = PALETTE[n % PALETTE.length]
        const fg = PALETTE[(n + 3) % PALETTE.length]
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><circle cx="${30 + (n % 40)}" cy="${35 + (n % 30)}" r="${18 + (n % 20)}" fill="${fg}" opacity=".85"/><rect x="0" y="${70 + (n % 15)}" width="100" height="4" fill="#fff" opacity=".5"/></svg>`
        return c.body(svg, 200, { 'content-type': 'image/svg+xml' })
      }
      case 'scrobble':
        console.log(
          `mock: scrobble ${q.get('id')} (${q.get('submission') === 'false' ? 'now playing' : 'played'})`,
        )
        return c.json(ok({}))
      case 'stream': {
        const song = songs.get(id)
        if (!song) return c.json(fail(70, 'Song not found'))
        const wav = toneFor(song)
        const range = c.req.header('range')?.match(/bytes=(\d+)-(\d*)/)
        if (!range) {
          return c.body(wav, 200, {
            'content-type': 'audio/wav',
            'content-length': String(wav.length),
            'accept-ranges': 'bytes',
          })
        }
        const start = Number(range[1])
        const end = Math.min(wav.length - 1, range[2] ? Number(range[2]) : wav.length - 1)
        return c.body(wav.subarray(start, end + 1), 206, {
          'content-type': 'audio/wav',
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${wav.length}`,
          'accept-ranges': 'bytes',
        })
      }
      default:
        return c.json(fail(0, `Mock does not implement ${endpoint}`))
    }
  } catch (err) {
    return c.json(fail(0, err instanceof Error ? err.message : String(err)))
  }
})

const port = Number(process.env.MOCK_PORT ?? 4599)
serve({ fetch: app.fetch, port }, () => console.log(`mock navidrome on http://localhost:${port}`))
