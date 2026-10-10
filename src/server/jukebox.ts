import type { JukeboxCommand, JukeboxState, JukeboxStatus, Song } from '@shared/types'
import type { SubsonicCall } from '@server/subsonic'

/** A command that cannot be carried out in the current state; maps to HTTP 400/409. */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message)
    this.name = 'CommandError'
  }
}

type Listener = (state: JukeboxState) => void

/** Seconds into a track after which "previous" restarts it instead of going back. */
const RESTART_THRESHOLD = 3

const EMPTY_STATUS: JukeboxStatus = { currentIndex: -1, playing: false, gain: 1, position: 0 }

/**
 * Owns the single view of Navidrome's jukebox that every browser shares.
 *
 * Navidrome's jukeboxControl has no insert or move, and `set` closes the
 * playing mpv, so every queue edit here is done by rewriting only the tracks
 * after the current one (remove them from the end, then add the new tail).
 * The current track keeps playing through all of it.
 *
 * Known upstream wrinkle: after a remove, Navidrome re-finds the current
 * track by id, taking the first match. If the same song is queued both
 * before and at the current position, the index can jump back to the
 * earlier copy.
 */
export class Jukebox {
  private state: JukeboxState = { status: EMPTY_STATUS, queue: [], sampledAt: 0, error: null }
  private listeners = new Set<Listener>()
  private lock: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | undefined
  private ticks = 0
  private polling = false
  /** Commands queued or running. Reads in this window can see a half-rewritten queue. */
  private pending = 0
  /** Bumped when a command starts, so a read that began before it is dropped. */
  private generation = 0

  constructor(
    private readonly call: SubsonicCall,
    private readonly opts: { pollMs?: number; fullRefreshEvery?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  get current(): JukeboxState {
    return this.state
  }

  /** Subscribe to state changes. Polling runs only while someone is listening. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.startPolling()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stopPolling()
    }
  }

  /**
   * Fetches the full queue and status from Navidrome and broadcasts it,
   * unless a command started meanwhile; then the command's own refresh
   * will publish the settled state.
   */
  async refresh(): Promise<JukeboxState> {
    const generation = this.generation
    await this.fetchAndPublish(() => this.pending === 0 && this.generation === generation)
    return this.state
  }

  private async fetchAndPublish(stillFresh: () => boolean): Promise<void> {
    try {
      const payload = await this.call('jukeboxControl', { action: 'get' })
      const list = payload.jukeboxPlaylist as (JukeboxStatus & { entry?: unknown[] }) | undefined
      if (!stillFresh()) return
      this.publish({
        status: toStatus(list),
        queue: (list?.entry ?? []).map(toSong),
        sampledAt: this.now(),
        error: null,
      })
    } catch (err) {
      if (stillFresh()) this.publish({ ...this.state, error: message(err) })
    }
  }

  /** Runs one command, serialized against every other command, then refreshes. */
  run(command: JukeboxCommand): Promise<JukeboxState> {
    this.pending++
    this.generation++
    const result = this.lock
      .then(async () => {
        await this.execute(command)
        // Under the lock, so this is the settled state after the command.
        await this.fetchAndPublish(() => true)
        return this.state
      })
      .finally(() => this.pending--)
    // Keep the chain alive after a failed command.
    this.lock = result.catch(() => undefined)
    return result
  }

  private async execute(cmd: JukeboxCommand): Promise<void> {
    const jc = (action: string, params: Record<string, string | number | string[]> = {}) =>
      this.call('jukeboxControl', { action, ...params })

    switch (cmd.action) {
      case 'play':
        await jc('start')
        return
      case 'pause':
        await jc('stop')
        return
      case 'volume':
        await jc('setGain', { gain: clamp(cmd.gain, 0, 1) })
        return
      case 'seek': {
        const { status } = await this.snapshot()
        if (status.currentIndex < 0) throw new CommandError('Nothing is loaded to seek in', 409)
        await jc('skip', {
          index: status.currentIndex,
          offset: Math.max(0, Math.floor(cmd.position)),
        })
        return
      }
      case 'next': {
        const { status, queue } = await this.snapshot()
        if (status.currentIndex + 1 >= queue.length) throw new CommandError('No next track', 409)
        await jc('skip', { index: status.currentIndex + 1, offset: 0 })
        return
      }
      case 'previous': {
        const { status } = await this.snapshot()
        if (status.currentIndex < 0) throw new CommandError('Nothing is loaded', 409)
        const restart = status.position > RESTART_THRESHOLD || status.currentIndex === 0
        await jc('skip', {
          index: restart ? status.currentIndex : status.currentIndex - 1,
          offset: 0,
        })
        return
      }
      case 'jump': {
        const { queue } = await this.snapshot()
        assertIndex(cmd.index, queue.length)
        await jc('skip', { index: cmd.index, offset: 0 })
        await jc('start')
        return
      }
      case 'playNow': {
        assertIds(cmd.ids)
        const start = cmd.startIndex ?? 0
        assertIndex(start, cmd.ids.length)
        await jc('set', { id: cmd.ids })
        await jc('skip', { index: start, offset: 0 })
        // start also launches Navidrome's track-switcher goroutine, without
        // which the queue never advances past the first song.
        await jc('start')
        return
      }
      case 'playNext':
        assertIds(cmd.ids)
        await this.rewriteUpcoming((tail) => [...cmd.ids, ...tail])
        return
      case 'addToQueue':
        assertIds(cmd.ids)
        await jc('add', { id: cmd.ids })
        return
      case 'remove': {
        const { status, queue } = await this.snapshot()
        assertIndex(cmd.index, queue.length)
        // Removing the current track leaves Navidrome with index -1 and a
        // paused mpv it no longer tracks; skipping is the way past it.
        if (cmd.index === status.currentIndex) {
          throw new CommandError('Skip the current track instead of removing it', 409)
        }
        await jc('remove', { index: cmd.index })
        return
      }
      case 'move': {
        const { status, queue } = await this.snapshot()
        assertIndex(cmd.from, queue.length)
        assertIndex(cmd.to, queue.length)
        // Indexes come from what the browser last saw. If a track ended in
        // between, they now point one song further along; refuse rather
        // than move the wrong song.
        if (cmd.expectId !== undefined && queue[cmd.from]?.id !== cmd.expectId) {
          throw new CommandError('The queue changed while you were moving that. Try again.', 409)
        }
        const first = status.currentIndex + 1
        if (cmd.from < first || cmd.to < first) {
          throw new CommandError('Only upcoming tracks can be reordered', 409)
        }
        await this.rewriteUpcoming((tail) => {
          const next = [...tail]
          const [moved] = next.splice(cmd.from - first, 1)
          next.splice(cmd.to - first, 0, moved!)
          return next
        })
        return
      }
      case 'clearUpcoming':
        await this.rewriteUpcoming(() => [])
        return
      case 'shuffleUpcoming':
        await this.rewriteUpcoming(shuffle)
        return
    }
  }

  /** Replaces the tracks after the current one, leaving the current track playing. */
  private async rewriteUpcoming(transform: (tail: string[]) => string[]): Promise<void> {
    const { status, queue } = await this.snapshot()
    const first = status.currentIndex + 1
    const tail = queue.slice(first).map((s) => s.id)
    const next = transform(tail)

    // Leave any unchanged prefix of the tail where it is.
    let keep = 0
    while (keep < tail.length && keep < next.length && tail[keep] === next[keep]) keep++

    for (let i = queue.length - 1; i >= first + keep; i--) {
      await this.call('jukeboxControl', { action: 'remove', index: i })
    }
    const added = next.slice(keep)
    if (added.length > 0) await this.call('jukeboxControl', { action: 'add', id: added })
  }

  /** Fresh queue and status straight from Navidrome, for commands that depend on them. */
  private async snapshot(): Promise<{ status: JukeboxStatus; queue: Song[] }> {
    const payload = await this.call('jukeboxControl', { action: 'get' })
    const list = payload.jukeboxPlaylist as (JukeboxStatus & { entry?: unknown[] }) | undefined
    return { status: toStatus(list), queue: (list?.entry ?? []).map(toSong) }
  }

  private async poll(): Promise<void> {
    // A command in flight will publish its own result; a read now could
    // catch its queue rewrite halfway through.
    if (this.polling || this.pending > 0) return
    this.polling = true
    const generation = this.generation
    const stillFresh = () => this.pending === 0 && this.generation === generation
    try {
      const every = this.opts.fullRefreshEvery ?? 10
      // A changed index means the track advanced; a periodic full refresh
      // catches queue edits made by other Subsonic clients.
      if (this.state.error || this.ticks++ % every === 0) {
        await this.fetchAndPublish(stillFresh)
        return
      }
      const payload = await this.call('jukeboxControl', { action: 'status' })
      const status = toStatus(payload.jukeboxStatus as JukeboxStatus | undefined)
      if (!stillFresh()) return
      if (status.currentIndex !== this.state.status.currentIndex) {
        await this.fetchAndPublish(stillFresh)
        return
      }
      this.publish({ ...this.state, status, sampledAt: this.now(), error: null })
    } catch (err) {
      if (stillFresh()) this.publish({ ...this.state, error: message(err) })
    } finally {
      this.polling = false
    }
  }

  private startPolling(): void {
    this.ticks = 0
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 1000)
  }

  private stopPolling(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private publish(state: JukeboxState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}

function toStatus(raw: Partial<JukeboxStatus> | undefined): JukeboxStatus {
  return {
    currentIndex: raw?.currentIndex ?? -1,
    playing: raw?.playing ?? false,
    gain: raw?.gain ?? 1,
    position: raw?.position ?? 0,
  }
}

export function toSong(raw: unknown): Song {
  const r = raw as Record<string, unknown>
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined)
  const num = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : undefined)
  return {
    id: String(r.id),
    title: str('title') ?? 'Unknown title',
    artist: str('artist'),
    artistId: str('artistId'),
    album: str('album'),
    albumId: str('albumId'),
    track: num('track'),
    discNumber: num('discNumber'),
    year: num('year'),
    duration: num('duration'),
    coverArt: str('coverArt'),
  }
}

function assertIds(ids: unknown): asserts ids is string[] {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    throw new CommandError('Expected a non-empty list of song ids')
  }
}

function assertIndex(index: unknown, length: number): asserts index is number {
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= length) {
    throw new CommandError(`Index ${String(index)} is out of range`)
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) throw new CommandError('Expected a number')
  return Math.min(hi, Math.max(lo, n))
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
