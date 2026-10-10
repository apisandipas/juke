import { describe, expect, it } from 'vitest'
import { CommandError, Jukebox } from '@server/jukebox'
import type { Params } from '@server/subsonic'

/**
 * In-memory jukeboxControl that follows Navidrome 0.64's core/playback
 * semantics: set clears and closes the active track, remove re-finds the
 * current track by id, skip only starts if it was already playing.
 */
class FakeNavidrome {
  items: string[] = []
  index = -1
  active: string | null = null
  playing = false
  position = 0
  gain = 1
  calls: string[] = []
  /** Times the active track was closed, i.e. playback was interrupted. */
  interruptions = 0

  call = async (endpoint: string, params: Params = {}) => {
    if (endpoint !== 'jukeboxControl') throw new Error(`unexpected ${endpoint}`)
    const action = String(params.action)
    this.calls.push(action)
    const ids = [params.id ?? []].flat().map(String)
    switch (action) {
      case 'get':
        return {
          jukeboxPlaylist: { ...this.status(), entry: this.items.map((id) => ({ id, title: id })) },
        }
      case 'status':
        return { jukeboxStatus: this.status() }
      case 'set':
        this.close()
        this.items = [...ids]
        this.index = ids.length ? 0 : -1
        break
      case 'add':
        this.items.push(...ids)
        if (this.index === -1 && this.items.length) this.index = 0
        break
      case 'start':
        if (!this.active && this.items.length) this.active = this.items[this.index]!
        this.playing = this.active !== null
        break
      case 'stop':
        this.playing = false
        break
      case 'skip': {
        const index = Number(params.index)
        const wasPlaying = this.playing
        if (index !== this.index && this.active) this.close()
        this.index = Math.max(0, Math.min(index, this.items.length - 1))
        this.active = this.items[this.index] ?? null
        this.position = Number(params.offset ?? 0)
        this.playing = wasPlaying
        break
      }
      case 'remove': {
        const index = Number(params.index)
        if (this.playing && index === this.index) this.playing = false
        const current = this.items[this.index]
        this.items.splice(index, 1)
        this.index = current === undefined ? -1 : this.items.indexOf(current)
        break
      }
      case 'setGain':
        this.gain = Number(params.gain)
        break
      default:
        throw new Error(`unhandled ${action}`)
    }
    return { jukeboxStatus: this.status() }
  }

  private close() {
    if (this.active) this.interruptions++
    this.active = null
    this.playing = false
  }

  private status() {
    return {
      currentIndex: this.index,
      playing: this.playing,
      gain: this.gain,
      position: this.position,
    }
  }
}

async function playing(ids: string[], at: number) {
  const nd = new FakeNavidrome()
  const jukebox = new Jukebox(nd.call)
  await jukebox.run({ action: 'playNow', ids, startIndex: at })
  nd.interruptions = 0
  nd.calls = []
  return { nd, jukebox }
}

describe('Jukebox', () => {
  it('playNow loads the list and starts at the chosen track', async () => {
    const nd = new FakeNavidrome()
    const state = await new Jukebox(nd.call).run({
      action: 'playNow',
      ids: ['a', 'b', 'c'],
      startIndex: 1,
    })
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(state.status).toMatchObject({ currentIndex: 1, playing: true })
  })

  it('playNext inserts after the current track without interrupting it', async () => {
    const { nd, jukebox } = await playing(['a', 'b', 'c', 'd'], 1)
    const state = await jukebox.run({ action: 'playNext', ids: ['x', 'y'] })
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b', 'x', 'y', 'c', 'd'])
    expect(state.status).toMatchObject({ currentIndex: 1, playing: true })
    expect(nd.interruptions).toBe(0)
    expect(nd.calls).not.toContain('set')
  })

  it('playNext on the last track appends without removing anything', async () => {
    const { nd, jukebox } = await playing(['a', 'b'], 1)
    const state = await jukebox.run({ action: 'playNext', ids: ['x'] })
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b', 'x'])
    expect(nd.calls.filter((c) => c === 'remove')).toHaveLength(0)
  })

  it('move reorders upcoming tracks and keeps the unchanged prefix in place', async () => {
    const { nd, jukebox } = await playing(['a', 'b', 'c', 'd', 'e'], 0)
    const state = await jukebox.run({ action: 'move', from: 4, to: 3 })
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b', 'c', 'e', 'd'])
    // Only d and e had to come out and go back in.
    expect(nd.calls.filter((c) => c === 'remove')).toHaveLength(2)
    expect(nd.interruptions).toBe(0)
  })

  it('refuses to move tracks at or before the current one', async () => {
    const { jukebox } = await playing(['a', 'b', 'c'], 1)
    await expect(jukebox.run({ action: 'move', from: 0, to: 2 })).rejects.toBeInstanceOf(
      CommandError,
    )
  })

  it('clearUpcoming keeps history and the current track', async () => {
    const { jukebox } = await playing(['a', 'b', 'c', 'd'], 1)
    const state = await jukebox.run({ action: 'clearUpcoming' })
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b'])
    expect(state.status.currentIndex).toBe(1)
  })

  it('shuffleUpcoming keeps the same tracks after the current one', async () => {
    const { jukebox } = await playing(['a', 'b', 'c', 'd', 'e', 'f'], 1)
    const state = await jukebox.run({ action: 'shuffleUpcoming' })
    const ids = state.queue.map((s) => s.id)
    expect(ids.slice(0, 2)).toEqual(['a', 'b'])
    expect([...ids.slice(2)].sort()).toEqual(['c', 'd', 'e', 'f'])
  })

  it('removing an earlier track keeps the current one current', async () => {
    const { jukebox } = await playing(['a', 'b', 'c'], 2)
    const state = await jukebox.run({ action: 'remove', index: 0 })
    expect(state.queue.map((s) => s.id)).toEqual(['b', 'c'])
    expect(state.status.currentIndex).toBe(1)
  })

  it('refuses to remove the current track', async () => {
    const { jukebox } = await playing(['a', 'b'], 0)
    await expect(jukebox.run({ action: 'remove', index: 0 })).rejects.toThrow(/Skip/)
  })

  it('previous restarts the track when past the threshold, else goes back', async () => {
    const { nd, jukebox } = await playing(['a', 'b', 'c'], 1)
    nd.position = 30
    let state = await jukebox.run({ action: 'previous' })
    expect(state.status).toMatchObject({ currentIndex: 1, position: 0 })
    state = await jukebox.run({ action: 'previous' })
    expect(state.status.currentIndex).toBe(0)
  })

  it('next refuses at the end of the queue', async () => {
    const { jukebox } = await playing(['a', 'b'], 1)
    await expect(jukebox.run({ action: 'next' })).rejects.toThrow(/No next/)
  })

  it('a failed command does not block the ones after it', async () => {
    const { jukebox } = await playing(['a', 'b'], 1)
    await expect(jukebox.run({ action: 'next' })).rejects.toThrow()
    const state = await jukebox.run({ action: 'volume', gain: 1.7 })
    expect(state.status.gain).toBe(1)
  })

  it('records a poll failure without losing the last good state', async () => {
    const nd = new FakeNavidrome()
    let down = false
    const jukebox = new Jukebox((endpoint, params) =>
      down ? Promise.reject(new Error('connect ECONNREFUSED')) : nd.call(endpoint, params),
    )
    await jukebox.run({ action: 'playNow', ids: ['a'] })
    down = true
    const state = await jukebox.refresh()
    expect(state.error).toMatch(/ECONNREFUSED/)
    expect(state.queue.map((s) => s.id)).toEqual(['a'])
  })
})
