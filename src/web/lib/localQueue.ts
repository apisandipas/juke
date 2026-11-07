import type { JukeboxCommand, Song } from '@shared/types'

/**
 * The commands every output understands. The same as the jukebox's, except
 * that queueing carries whole songs: playing on this device needs titles and
 * art up front, and the jukebox only sends the ids on.
 */
export type PlayerCommand =
  | Exclude<JukeboxCommand, { ids: string[] }>
  | { action: 'playNow'; songs: Song[]; startIndex?: number }
  | { action: 'playNext'; songs: Song[] }
  | { action: 'addToQueue'; songs: Song[] }

/** Queue commands only; play, pause, seek and volume act on the audio, not the list. */
export type QueueCommand = Extract<
  PlayerCommand,
  {
    action:
      | 'playNow'
      | 'playNext'
      | 'addToQueue'
      | 'remove'
      | 'move'
      | 'clearUpcoming'
      | 'shuffleUpcoming'
      | 'jump'
      | 'next'
  }
>

export interface LocalQueue {
  queue: Song[]
  /** Index of the current song; -1 when nothing is loaded. */
  index: number
}

export class QueueError extends Error {}

/**
 * Applies a queue command. Pure: returns the new queue, and whether the
 * current song changed (so the player loads it) and should start playing.
 */
export function applyQueue(
  { queue, index }: LocalQueue,
  command: QueueCommand,
  random: () => number = Math.random,
): LocalQueue & { load: boolean; play?: boolean } {
  const current = queue[index]
  const result = (next: Song[], nextIndex: number, play?: boolean) => ({
    queue: next,
    index: nextIndex,
    load: next[nextIndex] !== current,
    play,
  })
  const inRange = (i: number, length = queue.length) => Number.isInteger(i) && i >= 0 && i < length

  switch (command.action) {
    case 'playNow': {
      if (command.songs.length === 0) throw new QueueError('Nothing to play')
      const start = command.startIndex ?? 0
      if (!inRange(start, command.songs.length)) throw new QueueError('No song at that position')
      // Copy so a replay of the same list still counts as a new current song.
      return { ...result([...command.songs], start, true), load: true }
    }
    case 'playNext':
      return result(
        [...queue.slice(0, index + 1), ...command.songs, ...queue.slice(index + 1)],
        index,
      )
    case 'addToQueue':
      return result([...queue, ...command.songs], index)
    case 'jump':
      if (!inRange(command.index)) throw new QueueError('No song at that position')
      return { ...result(queue, command.index, true), load: true }
    case 'next':
      if (index + 1 >= queue.length) throw new QueueError('Nothing after this song')
      return result(queue, index + 1)
    case 'remove': {
      const at = command.index
      if (!inRange(at)) throw new QueueError('No song at that position')
      const next = queue.filter((_, i) => i !== at)
      if (at < index) return result(next, index - 1)
      if (at > index) return result(next, index)
      // The current song: the one after it takes its place, or the one before at the end.
      return result(next, Math.min(index, next.length - 1))
    }
    case 'move': {
      const { from, to } = command
      if (!inRange(from) || !inRange(to)) throw new QueueError('No song at that position')
      if (command.expectId !== undefined && queue[from]?.id !== command.expectId) {
        throw new QueueError('The queue changed; try again')
      }
      const next = [...queue]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      let nextIndex = index
      if (from === index) nextIndex = to
      else if (from < index && to >= index) nextIndex = index - 1
      else if (from > index && to <= index) nextIndex = index + 1
      return result(next, nextIndex)
    }
    case 'clearUpcoming':
      return result(queue.slice(0, index + 1), index)
    case 'shuffleUpcoming': {
      const upcoming = queue.slice(index + 1)
      for (let i = upcoming.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[upcoming[i], upcoming[j]] = [upcoming[j]!, upcoming[i]!]
      }
      return result([...queue.slice(0, index + 1), ...upcoming], index)
    }
  }
}

/** Seconds of a song that count as having played it, as Last.fm and Navidrome reckon it. */
export function scrobbleThreshold(duration: number | undefined): number {
  if (!duration || duration <= 30) return Infinity
  return Math.min(duration / 2, 240)
}
