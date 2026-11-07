import { describe, expect, it } from 'vitest'
import type { Song } from '@shared/types'
import { applyQueue, scrobbleThreshold, type LocalQueue } from '@/lib/localQueue'

const song = (id: string): Song => ({ id, title: id })
const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(song) as [Song, Song, Song, Song]
const ids = (q: LocalQueue) => q.queue.map((s) => s.id)

describe('the queue on this device', () => {
  const playing: LocalQueue = { queue: [a, b, c], index: 1 }

  it('replaces the queue and starts at the chosen song', () => {
    const next = applyQueue(playing, { action: 'playNow', songs: [c, d], startIndex: 1 })
    expect(ids(next)).toEqual(['c', 'd'])
    expect(next).toMatchObject({ index: 1, load: true, play: true })
  })

  it('queues after the current song, or at the end, without changing it', () => {
    const next = applyQueue(playing, { action: 'playNext', songs: [d] })
    expect(ids(next)).toEqual(['a', 'b', 'd', 'c'])
    expect(next).toMatchObject({ index: 1, load: false })
    expect(ids(applyQueue(playing, { action: 'addToQueue', songs: [d] }))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('keeps the current song when others are removed', () => {
    expect(applyQueue(playing, { action: 'remove', index: 0 })).toMatchObject({
      index: 0,
      load: false,
    })
    expect(applyQueue(playing, { action: 'remove', index: 2 })).toMatchObject({
      index: 1,
      load: false,
    })
  })

  it('moves on to the next song when the current one is removed', () => {
    const next = applyQueue(playing, { action: 'remove', index: 1 })
    expect(next.queue[next.index]?.id).toBe('c')
    expect(next.load).toBe(true)
    const last = applyQueue({ queue: [a, b], index: 1 }, { action: 'remove', index: 1 })
    expect(last.queue[last.index]?.id).toBe('a')
  })

  it('follows the current song through a move', () => {
    const q: LocalQueue = { queue: [a, b, c, d], index: 1 }
    const moved = (from: number, to: number) => {
      const next = applyQueue(q, { action: 'move', from, to })
      return { order: ids(next).join(''), current: next.queue[next.index]?.id, load: next.load }
    }
    expect(moved(3, 2)).toEqual({ order: 'abdc', current: 'b', load: false })
    expect(moved(0, 3)).toEqual({ order: 'bcda', current: 'b', load: false })
    expect(moved(3, 0)).toEqual({ order: 'dabc', current: 'b', load: false })
    expect(moved(1, 3)).toEqual({ order: 'acdb', current: 'b', load: false })
  })

  it('refuses a move when the song is no longer where the browser saw it', () => {
    expect(() => applyQueue(playing, { action: 'move', from: 2, to: 1, expectId: 'a' })).toThrow(
      /changed/,
    )
  })

  it('clears and shuffles only what is upcoming', () => {
    const q: LocalQueue = { queue: [a, b, c, d], index: 1 }
    expect(ids(applyQueue(q, { action: 'clearUpcoming' }))).toEqual(['a', 'b'])
    const shuffled = applyQueue(q, { action: 'shuffleUpcoming' }, () => 0)
    expect(ids(shuffled).slice(0, 2)).toEqual(['a', 'b'])
    expect(ids(shuffled).slice(2).sort()).toEqual(['c', 'd'])
  })

  it('stops at the end of the queue', () => {
    expect(() => applyQueue({ queue: [a], index: 0 }, { action: 'next' })).toThrow()
  })

  it('counts a play after half the song or four minutes', () => {
    expect(scrobbleThreshold(200)).toBe(100)
    expect(scrobbleThreshold(1200)).toBe(240)
    expect(scrobbleThreshold(20)).toBe(Infinity)
  })
})
