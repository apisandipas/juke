import { ArrowRightLeft, ChevronDown, Smartphone, Speaker } from 'lucide-react'
import { useSheet, type SheetAction } from '@/components/ActionSheet'
import { capitalized, useSpeaker } from '@/lib/config'
import { useJukebox } from '@/lib/jukebox'

/**
 * Where the music is and whether juke can see it, and the switch between the
 * jukebox and this device. The failure states matter most: a remote that
 * silently shows stale state is worse than none.
 */
export function StatusLine() {
  const { state, connection, output } = useJukebox()
  const speaker = useSpeaker()
  const openSwitch = useOutputSwitch()
  const where = output === 'device' ? 'this device' : speaker

  let tone: 'ok' | 'idle' | 'bad' = 'idle'
  let text: string
  if (connection === 'connecting' && !state) {
    text = 'Connecting…'
  } else if (connection === 'reconnecting') {
    tone = 'bad'
    text = 'Lost connection to juke, retrying…'
  } else if (state?.error) {
    tone = 'bad'
    text = output === 'device' ? state.error : `Can’t reach Navidrome: ${state.error}`
  } else if (state?.status.playing) {
    tone = 'ok'
    text = `Playing on ${where}`
  } else {
    text = state?.queue.length ? `Paused on ${where}` : capitalized(where)
  }

  const Icon = output === 'device' ? Smartphone : Speaker

  return (
    <div className="mb-4 flex min-h-6 items-center gap-2">
      <p
        className={`flex min-w-0 flex-1 items-baseline gap-2 text-sm ${tone === 'bad' ? 'text-danger' : 'text-muted'}`}
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
      <button
        onClick={openSwitch}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 text-xs font-medium text-muted hover:bg-raised hover:text-text"
        aria-label={`Output: ${where}. Change`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {output === 'device' ? 'This device' : capitalized(speaker)}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** Opens the sheet that switches output, or moves the music across. */
export function useOutputSwitch() {
  const { output, state, jukebox, setOutput } = useJukebox()
  const speaker = useSpeaker()
  const openSheet = useSheet()

  return () => {
    const toDevice = output === 'jukebox'
    const other = toDevice ? 'this device' : speaker
    // Moving needs a song loaded on the current output.
    const from = toDevice ? jukebox.state : state
    const song = from?.queue[from.status.currentIndex]
    const actions: SheetAction[] = []
    if (song) {
      actions.push({
        label: `Move the music to ${other}`,
        icon: ArrowRightLeft,
        hint: 'song, place and queue',
        onSelect: () => void setOutput(toDevice ? 'device' : 'jukebox', true),
      })
    }
    actions.push({
      label: toDevice ? 'Play on this device' : `Play on ${speaker}`,
      icon: toDevice ? Smartphone : Speaker,
      hint: toDevice ? 'its own queue' : undefined,
      onSelect: () => void setOutput(toDevice ? 'device' : 'jukebox', false),
    })
    openSheet({
      title: toDevice ? `Playing on ${speaker}` : 'Playing on this device',
      subtitle: song ? [song.title, song.artist].filter(Boolean).join(' · ') : 'Nothing playing',
      actions,
    })
  }
}
