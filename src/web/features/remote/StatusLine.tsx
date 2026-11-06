import { capitalized, useSpeaker } from '@/lib/config'
import { useJukebox } from '@/lib/jukebox'

/**
 * Where the music is and whether juke can see it. The failure states matter
 * most: a remote that silently shows stale state is worse than none.
 */
export function StatusLine() {
  const { state, connection } = useJukebox()
  const speaker = useSpeaker()

  let tone: 'ok' | 'idle' | 'bad' = 'idle'
  let text: string
  if (connection === 'connecting' && !state) {
    text = 'Connecting…'
  } else if (connection === 'reconnecting') {
    tone = 'bad'
    text = 'Lost connection to juke, retrying…'
  } else if (state?.error) {
    tone = 'bad'
    text = `Can’t reach Navidrome: ${state.error}`
  } else if (state?.status.playing) {
    tone = 'ok'
    text = `Playing on ${speaker}`
  } else {
    text = state?.queue.length ? `Paused on ${speaker}` : capitalized(speaker)
  }

  return (
    <p
      className={`mb-4 flex min-h-6 items-baseline gap-2 text-sm ${tone === 'bad' ? 'text-danger' : 'text-muted'}`}
      role={tone === 'bad' ? 'alert' : 'status'}
    >
      <span
        className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${
          tone === 'ok' ? 'bg-accent' : tone === 'bad' ? 'bg-danger' : 'bg-faint'
        }`}
        aria-hidden
      />
      <span className={tone === 'bad' ? '' : 'truncate'}>{text}</span>
    </p>
  )
}
