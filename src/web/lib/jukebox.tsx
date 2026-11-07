import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { JukeboxCommand, JukeboxState, Song } from '@shared/types'
import { sendCommand } from '@/lib/api'
import { plural } from '@/lib/format'
import { LocalPlayer } from '@/lib/localPlayer'
import type { PlayerCommand } from '@/lib/localQueue'
import { useToast } from '@/lib/toast'

export type Connection = 'connecting' | 'live' | 'reconnecting'

/** Where the music comes out: the server's speakers, or the device holding juke. */
export type Output = 'jukebox' | 'device'

interface JukeboxContextValue {
  /** The output the controls act on. */
  output: Output
  state: JukeboxState | null
  connection: Connection
  current: Song | undefined
  send: (command: PlayerCommand) => Promise<boolean>
  /** Queue songs with a confirmation toast; how is 'next' or 'end'. */
  enqueue: (songs: Song[], how: 'next' | 'end') => Promise<void>
  /** False on iOS, where only the hardware buttons change a page's volume. */
  canSetVolume: boolean
  /** The jukebox, whichever output is active, for the output switch. */
  jukebox: { state: JukeboxState | null; connection: Connection }
  /**
   * Switch output. With `handoff`, the song, position and queue move across:
   * the old output pauses and the new one carries on where it left off.
   */
  setOutput: (output: Output, handoff: boolean) => Promise<void>
}

const JukeboxContext = createContext<JukeboxContextValue | null>(null)

const OUTPUT_KEY = 'juke:output'

function savedOutput(): Output {
  try {
    return localStorage.getItem(OUTPUT_KEY) === 'device' ? 'device' : 'jukebox'
  } catch {
    return 'jukebox'
  }
}

let localPlayer: LocalPlayer | null = null
/** Made on first use, so a device that never plays locally never touches its audio. */
function getLocalPlayer(): LocalPlayer {
  localPlayer ??= new LocalPlayer()
  return localPlayer
}

const noSubscribe = () => () => {}
const noState = () => null

/**
 * Re-stamps a state with this device's clock. The server's sampledAt comes
 * from the server's clock, and a phone's can be seconds off, which would throw
 * off the interpolated position.
 */
function received(state: JukeboxState): JukeboxState {
  return { ...state, sampledAt: Date.now() }
}

/** Where a state's song is now, in seconds, allowing for time since it was sampled. */
export function positionOf(state: JukeboxState, now = Date.now()): number {
  const elapsed = state.status.playing ? Math.max(0, (now - state.sampledAt) / 1000) : 0
  const duration = state.queue[state.status.currentIndex]?.duration ?? Infinity
  return Math.min(duration, state.status.position + elapsed)
}

/** The jukebox takes ids; the songs themselves stay in the browser. */
function toJukebox(command: PlayerCommand): JukeboxCommand {
  if ('songs' in command) {
    const { songs, ...rest } = command
    return { ...rest, ids: songs.map((s) => s.id) } as JukeboxCommand
  }
  return command
}

export function useJukebox(): JukeboxContextValue {
  const ctx = useContext(JukeboxContext)
  if (!ctx) throw new Error('useJukebox outside JukeboxProvider')
  return ctx
}

export function JukeboxProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [remote, setRemote] = useState<JukeboxState | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [output, setOutputState] = useState<Output>(savedOutput)
  const local = output === 'device' ? getLocalPlayer() : null
  const localState = useSyncExternalStore(
    local?.subscribe ?? noSubscribe,
    local?.getState ?? noState,
  )

  useEffect(() => {
    // EventSource reconnects by itself; this only tracks whether it is up.
    // It stays open on either output, so the switch can show the jukebox.
    const events = new EventSource('/api/events')
    events.addEventListener('state', (e) => {
      setRemote(received(JSON.parse((e as MessageEvent<string>).data) as JukeboxState))
      setConnection('live')
    })
    events.onerror = () => setConnection('reconnecting')
    return () => events.close()
  }, [])

  const sendRemote = useCallback(
    async (command: PlayerCommand) => {
      // Flip play/pause at once; the next poll corrects it if Navidrome disagrees.
      if (command.action === 'play' || command.action === 'pause') {
        setRemote((s) => {
          if (!s) return s
          // Carry the interpolated position over so a pause doesn't jump back.
          const now = Date.now()
          const playing = command.action === 'play'
          return {
            ...s,
            sampledAt: now,
            status: { ...s.status, playing, position: positionOf(s, now) },
          }
        })
      }
      try {
        setRemote(received(await sendCommand(toJukebox(command))))
        return true
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error')
        return false
      }
    },
    [toast],
  )

  const send = useCallback(
    async (command: PlayerCommand) => {
      if (output === 'jukebox') return sendRemote(command)
      try {
        // Synchronous, so play() runs inside the tap (iOS requires it).
        getLocalPlayer().run(command)
        return true
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error')
        return false
      }
    },
    [output, sendRemote, toast],
  )

  const enqueue = useCallback(
    async (songs: Song[], how: 'next' | 'end') => {
      const ok = await send({ action: how === 'next' ? 'playNext' : 'addToQueue', songs })
      if (ok) {
        toast(
          `${plural(songs.length, 'song')} ${how === 'next' ? 'playing next' : 'added to queue'}`,
        )
      }
    },
    [send, toast],
  )

  const setOutput = useCallback(
    async (next: Output, handoff: boolean) => {
      if (next === output) return
      const remember = () => {
        try {
          localStorage.setItem(OUTPUT_KEY, next)
        } catch {
          // Not remembered; the choice lasts until reload.
        }
        setOutputState(next)
      }

      if (next === 'device') {
        const player = getLocalPlayer()
        const from = remote
        const song = from?.queue[from.status.currentIndex]
        if (handoff && from && song) {
          // Start here first, inside the tap, then quiet the speakers.
          player.takeOver(from.queue, from.status.currentIndex, positionOf(from))
          remember()
          if (from.status.playing) await sendRemote({ action: 'pause' })
          toast('Moved to this device')
        } else remember()
        return
      }

      const player = getLocalPlayer()
      const from = player.getState()
      const index = from.status.currentIndex
      if (handoff && from.queue[index]) {
        const position = player.position
        player.run({ action: 'pause' })
        remember()
        const ok = await sendRemote({ action: 'playNow', songs: from.queue, startIndex: index })
        if (ok && position > 1) await sendRemote({ action: 'seek', position: Math.floor(position) })
        if (ok) toast('Moved to the jukebox')
      } else {
        player.run({ action: 'pause' })
        remember()
      }
    },
    [output, remote, sendRemote, toast],
  )

  const value = useMemo<JukeboxContextValue>(() => {
    const state = output === 'device' ? localState : remote
    const index = state?.status.currentIndex ?? -1
    return {
      output,
      state,
      connection: output === 'device' ? 'live' : connection,
      current: state?.queue[index],
      send,
      enqueue,
      canSetVolume: output === 'jukebox' || (local?.canSetVolume ?? true),
      jukebox: { state: remote, connection },
      setOutput,
    }
  }, [output, localState, remote, connection, send, enqueue, local, setOutput])

  return <JukeboxContext.Provider value={value}>{children}</JukeboxContext.Provider>
}

/**
 * Playback position in seconds, advanced locally between samples. Navidrome
 * reports whole seconds about once a second, which would make the progress
 * bar step visibly.
 */
export function usePosition(): number {
  const { state } = useJukebox()
  const [now, setNow] = useState(() => Date.now())
  const playing = state?.status.playing ?? false

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [playing])

  return state ? positionOf(state, now) : 0
}
