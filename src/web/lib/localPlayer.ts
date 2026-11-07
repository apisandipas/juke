import type { JukeboxState, Song } from '@shared/types'
import { coverUrl } from '@/lib/api'
import {
  applyQueue,
  QueueError,
  scrobbleThreshold,
  type LocalQueue,
  type PlayerCommand,
} from '@/lib/localQueue'

const STORAGE_KEY = 'juke:local-queue'
/** How often the position is saved while playing, so a reload resumes near it. */
const SAVE_EVERY_MS = 5000

interface Saved extends LocalQueue {
  position: number
  gain: number
}

/**
 * Plays the queue on this device through one <audio> element. Commands that
 * start playback call audio.play() before anything async, because iOS only
 * allows it inside the tap that asked for it.
 */
export class LocalPlayer {
  private readonly audio = new Audio()
  private queue: Song[] = []
  private index = -1
  private error: string | null = null
  private state: JukeboxState
  private readonly listeners = new Set<() => void>()
  /** Seconds of the current song actually heard, for the play count. */
  private heard = 0
  private lastTime = 0
  private scrobbled = false
  private lastSave = 0
  /** Where to resume once the restored song's metadata loads. */
  private pendingSeek: number | null = null

  /** Whether this browser lets a page set the volume. iOS does not. */
  readonly canSetVolume: boolean

  constructor() {
    this.audio.preload = 'auto'
    this.audio.volume = 0.5
    this.canSetVolume = this.audio.volume === 0.5
    this.audio.volume = 1

    const saved = load()
    if (saved) {
      this.queue = saved.queue
      this.index = saved.index
      this.audio.volume = saved.gain
      if (this.queue[this.index]) {
        this.audio.preload = 'metadata'
        this.audio.src = streamUrl(this.queue[this.index]!)
        this.pendingSeek = saved.position
      }
    }

    const a = this.audio
    a.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek !== null) {
        a.currentTime = this.pendingSeek
        this.pendingSeek = null
      }
      this.emit()
    })
    for (const event of ['play', 'pause', 'playing', 'waiting', 'seeked', 'volumechange']) {
      a.addEventListener(event, () => this.emit())
    }
    a.addEventListener('playing', () => {
      this.error = null
      const song = this.queue[this.index]
      if (song && this.heard === 0) void scrobble(song.id, false)
    })
    a.addEventListener('timeupdate', () => this.onTime())
    a.addEventListener('ended', () => this.onEnded())
    a.addEventListener('error', () => {
      const song = this.queue[this.index]
      this.error = song ? `Couldn’t play ${song.title}` : 'Couldn’t play that'
      this.emit()
    })

    this.state = this.snapshot()
    this.setUpMediaSession()
  }

  // ---- Store interface for useSyncExternalStore ------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): JukeboxState => this.state

  /** The queue and position, for handing playback to the jukebox. */
  get position(): number {
    return this.audio.currentTime
  }

  // ---- Commands ---------------------------------------------------------------

  /** Runs a command; throws a readable Error when it can't. Synchronous on purpose. */
  run(command: PlayerCommand): JukeboxState {
    const a = this.audio
    switch (command.action) {
      case 'play':
        if (this.index < 0) {
          if (this.queue.length === 0) throw new QueueError('Nothing queued')
          this.apply({ action: 'jump', index: 0 })
        } else this.start()
        break
      case 'pause':
        a.pause()
        break
      case 'seek':
        a.currentTime = Math.max(0, command.position)
        this.lastTime = a.currentTime
        break
      case 'volume':
        a.volume = Math.min(1, Math.max(0, command.gain))
        break
      case 'previous':
        // Like most players: back to the start first, then to the song before.
        if (a.currentTime > 3 || this.index <= 0) {
          a.currentTime = 0
          this.lastTime = 0
        } else this.apply({ action: 'jump', index: this.index - 1 })
        break
      case 'next':
        this.apply(command, true)
        break
      default:
        this.apply(command)
    }
    this.emit()
    return this.state
  }

  /** Replace everything, for a handoff from the jukebox. Starts playing at `position`. */
  takeOver(queue: Song[], index: number, position: number) {
    this.apply({ action: 'playNow', songs: queue, startIndex: index })
    this.pendingSeek = position
    this.emit()
  }

  // ---- Internals --------------------------------------------------------------

  private apply(command: Parameters<typeof applyQueue>[1], keepPlaying = false) {
    const wasPlaying = !this.audio.paused
    const next = applyQueue({ queue: this.queue, index: this.index }, command)
    if (next.load) this.leaveSong()
    this.queue = next.queue
    this.index = next.index
    if (!next.load) return
    const song = this.queue[this.index]
    if (!song) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
      return
    }
    this.pendingSeek = null
    this.audio.src = streamUrl(song)
    this.updateMetadata()
    if (next.play || keepPlaying || wasPlaying) this.start()
  }

  private start() {
    this.audio.play().catch((err: unknown) => {
      // AbortError: a newer src replaced this one before it started. Not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return
      this.error =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Tap play to start on this device'
          : `Couldn’t play: ${err instanceof Error ? err.message : String(err)}`
      this.emit()
    })
  }

  private onTime() {
    const t = this.audio.currentTime
    const step = t - this.lastTime
    // Count only steady playback, not jumps from seeking.
    if (step > 0 && step < 2) this.heard += step
    this.lastTime = t
    const song = this.queue[this.index]
    if (song && !this.scrobbled && this.heard >= scrobbleThreshold(song.duration)) {
      this.scrobbled = true
      void scrobble(song.id, true)
    }
    if (Date.now() - this.lastSave > SAVE_EVERY_MS) this.save()
  }

  private onEnded() {
    if (this.index + 1 < this.queue.length) {
      this.apply({ action: 'next' }, true)
    } else {
      this.leaveSong()
    }
    this.emit()
  }

  /** Resets the per-song counters when moving off the current song. */
  private leaveSong() {
    this.heard = 0
    this.lastTime = 0
    this.scrobbled = false
  }

  private snapshot(): JukeboxState {
    const a = this.audio
    return {
      status: {
        currentIndex: this.index,
        // Not while buffering, so the progress bar doesn't run ahead.
        playing: !a.paused && !a.ended && a.readyState >= 3,
        gain: a.volume,
        position: this.pendingSeek ?? a.currentTime,
      },
      queue: this.queue,
      sampledAt: Date.now(),
      error: this.error,
    }
  }

  private emit() {
    this.state = this.snapshot()
    this.save()
    this.updatePositionState()
    for (const listener of this.listeners) listener()
  }

  private save() {
    this.lastSave = Date.now()
    const saved: Saved = {
      queue: this.queue,
      index: this.index,
      position: this.pendingSeek ?? this.audio.currentTime,
      gain: this.audio.volume,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch {
      // Storage full or blocked: the queue lasts until reload.
    }
  }

  // ---- Lock screen and headphone controls -------------------------------------

  private setUpMediaSession() {
    if (!('mediaSession' in navigator)) return
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.safeRun({ action: 'play' })],
      ['pause', () => this.safeRun({ action: 'pause' })],
      ['previoustrack', () => this.safeRun({ action: 'previous' })],
      ['nexttrack', () => this.safeRun({ action: 'next' })],
      [
        'seekto',
        (d) => d.seekTime !== undefined && this.safeRun({ action: 'seek', position: d.seekTime }),
      ],
      [
        'seekbackward',
        (d) => this.safeRun({ action: 'seek', position: this.position - (d.seekOffset ?? 10) }),
      ],
      [
        'seekforward',
        (d) => this.safeRun({ action: 'seek', position: this.position + (d.seekOffset ?? 10) }),
      ],
    ]
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Not every browser supports every action.
      }
    }
    this.updateMetadata()
  }

  private safeRun(command: PlayerCommand) {
    try {
      this.run(command)
    } catch {
      // From the lock screen there is nowhere to show the error.
    }
  }

  private updateMetadata() {
    if (!('mediaSession' in navigator)) return
    const song = this.queue[this.index]
    if (!song) {
      navigator.mediaSession.metadata = null
      return
    }
    const art = coverUrl(song.coverArt, 512)
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist ?? '',
      album: song.album ?? '',
      artwork: art ? [{ src: art, sizes: '512x512' }] : [],
    })
  }

  private updatePositionState() {
    if (!('mediaSession' in navigator)) return
    const a = this.audio
    navigator.mediaSession.playbackState = a.paused ? 'paused' : 'playing'
    const duration = Number.isFinite(a.duration) ? a.duration : this.queue[this.index]?.duration
    if (!duration) return
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: a.playbackRate || 1,
        position: Math.min(duration, a.currentTime),
      })
    } catch {
      // Throws on a position past the duration while metadata is settling.
    }
  }
}

function streamUrl(song: Song): string {
  return `/api/stream/${encodeURIComponent(song.id)}`
}

function scrobble(id: string, submission: boolean): Promise<void> {
  // Play counts are a nicety; never let one break playback.
  return fetch('/api/scrobble', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, submission }),
  }).then(
    () => undefined,
    () => undefined,
  )
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<Saved>
    if (!Array.isArray(saved.queue) || typeof saved.index !== 'number') return null
    return {
      queue: saved.queue,
      index: Math.min(saved.index, saved.queue.length - 1),
      position: typeof saved.position === 'number' ? saved.position : 0,
      gain: typeof saved.gain === 'number' ? Math.min(1, Math.max(0, saved.gain)) : 1,
    }
  } catch {
    return null
  }
}
