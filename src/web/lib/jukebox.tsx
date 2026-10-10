import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { JukeboxCommand, JukeboxState, Song } from '@shared/types'
import { sendCommand } from '@/lib/api'
import { plural } from '@/lib/format'
import { useToast } from '@/lib/toast'

export type Connection = 'connecting' | 'live' | 'reconnecting'

interface JukeboxContextValue {
  state: JukeboxState | null
  connection: Connection
  current: Song | undefined
  send: (command: JukeboxCommand) => Promise<boolean>
  /** Queue songs with a confirmation toast; how is 'next' or 'end'. */
  enqueue: (ids: string[], how: 'next' | 'end') => Promise<void>
}

const JukeboxContext = createContext<JukeboxContextValue | null>(null)

/**
 * Re-stamps a state with this device's clock. The server's sampledAt comes
 * from Galactus's clock, and a phone's can be seconds off, which would throw
 * off the interpolated position.
 */
function received(state: JukeboxState): JukeboxState {
  return { ...state, sampledAt: Date.now() }
}

export function useJukebox(): JukeboxContextValue {
  const ctx = useContext(JukeboxContext)
  if (!ctx) throw new Error('useJukebox outside JukeboxProvider')
  return ctx
}

export function JukeboxProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [state, setState] = useState<JukeboxState | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')

  useEffect(() => {
    // EventSource reconnects by itself; this only tracks whether it is up.
    const events = new EventSource('/api/events')
    events.addEventListener('state', (e) => {
      setState(received(JSON.parse((e as MessageEvent<string>).data) as JukeboxState))
      setConnection('live')
    })
    events.onerror = () => setConnection('reconnecting')
    return () => events.close()
  }, [])

  const send = useCallback(
    async (command: JukeboxCommand) => {
      // Flip play/pause at once; the next poll corrects it if Navidrome disagrees.
      if (command.action === 'play' || command.action === 'pause') {
        setState((s) => {
          if (!s) return s
          // Carry the interpolated position over so a pause doesn't jump back.
          const now = Date.now()
          const elapsed = s.status.playing ? (now - s.sampledAt) / 1000 : 0
          const position = s.status.position + elapsed
          const playing = command.action === 'play'
          return { ...s, sampledAt: now, status: { ...s.status, playing, position } }
        })
      }
      try {
        setState(received(await sendCommand(command)))
        return true
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error')
        return false
      }
    },
    [toast],
  )

  const enqueue = useCallback(
    async (ids: string[], how: 'next' | 'end') => {
      const ok = await send({ action: how === 'next' ? 'playNext' : 'addToQueue', ids })
      if (ok)
        toast(`${plural(ids.length, 'song')} ${how === 'next' ? 'playing next' : 'added to queue'}`)
    },
    [send, toast],
  )

  const value = useMemo<JukeboxContextValue>(() => {
    const index = state?.status.currentIndex ?? -1
    return { state, connection, current: state?.queue[index], send, enqueue }
  }, [state, connection, send, enqueue])

  return <JukeboxContext.Provider value={value}>{children}</JukeboxContext.Provider>
}

/**
 * Playback position in seconds, advanced locally between server samples.
 * Navidrome reports whole seconds about once a second, which would make the
 * progress bar step visibly.
 */
export function usePosition(): number {
  const { state, current } = useJukebox()
  const [now, setNow] = useState(() => Date.now())
  const playing = state?.status.playing ?? false

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [playing])

  if (!state) return 0
  const elapsed = playing ? Math.max(0, (now - state.sampledAt) / 1000) : 0
  const duration = current?.duration ?? Infinity
  return Math.min(duration, state.status.position + elapsed)
}
