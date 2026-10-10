import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { useRef, useState } from 'react'
import { useJukebox } from '@/lib/jukebox'

/** How often a drag sends the new volume, so the room hears it move. */
const SEND_EVERY_MS = 150

export function Volume() {
  const { state, send } = useJukebox()
  const [dragging, setDragging] = useState<number | null>(null)
  const lastSent = useRef(0)
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seq = useRef(0)
  const beforeMute = useRef(1)
  const gain = dragging ?? state?.status.gain ?? 1
  const percent = Math.round(gain * 100)

  function change(value: number) {
    const mine = ++seq.current
    setDragging(value)
    clearTimeout(pending.current)
    const wait = SEND_EVERY_MS - (Date.now() - lastSent.current)
    const fire = () => {
      lastSent.current = Date.now()
      void send({ action: 'volume', gain: value }).then(() => {
        // Hand back to server state only once no newer change is in flight.
        if (seq.current === mine) setDragging(null)
      })
    }
    if (wait <= 0) fire()
    else pending.current = setTimeout(fire, wait)
  }

  const Icon = gain === 0 ? VolumeX : gain < 0.5 ? Volume1 : Volume2

  return (
    <div className="mt-6 flex items-center gap-3">
      <button
        onClick={() => {
          if (gain > 0) beforeMute.current = gain
          change(gain === 0 ? beforeMute.current : 0)
        }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-text"
        aria-label={gain === 0 ? 'Unmute' : 'Mute'}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </button>
      <input
        type="range"
        className="slider"
        min={0}
        max={100}
        step={1}
        value={percent}
        style={{ '--fill': `${percent}%` } as React.CSSProperties}
        aria-label="Volume"
        aria-valuetext={`${percent}%`}
        onChange={(e) => change(Number(e.target.value) / 100)}
      />
      <span className="w-9 shrink-0 text-right text-xs text-faint tabular-nums">{percent}</span>
    </div>
  )
}
