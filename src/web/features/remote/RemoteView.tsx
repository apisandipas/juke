import {
  ChevronUp,
  Library,
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  WifiOff,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Cover } from '@/components/Cover'
import { clock } from '@/lib/format'
import { useJukebox, usePosition } from '@/lib/jukebox'
import { useMediaQuery, WIDE } from '@/lib/media'
import { href } from '@/lib/router'
import { QueueList } from '@/features/queue/QueueList'
import { StatusLine } from '@/features/remote/StatusLine'
import { Volume } from '@/features/remote/Volume'

export function RemoteView() {
  const { state, current, connection } = useJukebox()
  const wide = useMediaQuery(WIDE)
  const queue = state?.queue ?? []
  // With a track on screen, keep showing it (the status line flags it as
  // stale). Without one, "nothing queued" would be a guess, so say so.
  const unreachable = !current && (connection === 'reconnecting' || Boolean(state?.error))
  const index = state?.status.currentIndex ?? -1
  const next = queue[index + 1]
  const upcomingCount = Math.max(0, queue.length - index - 1)

  return (
    <div>
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:pt-6">
        <div className="flex min-w-0 flex-col">
          <StatusLine />
          {unreachable ? (
            <Unreachable proxy={connection === 'reconnecting'} />
          ) : !state ? (
            <div className="aspect-square w-full animate-pulse rounded-xl bg-surface" />
          ) : current ? (
            <NowPlaying />
          ) : (
            <NothingQueued hasQueue={queue.length > 0} />
          )}

          {state && !unreachable && queue.length > 0 && (
            <a
              href={href.queue()}
              className="mt-6 flex items-center gap-3 rounded-xl bg-surface/80 px-4 py-3 hover:bg-raised lg:hidden"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold tracking-wide text-faint uppercase">
                  Up next{upcomingCount > 0 && ` · ${upcomingCount}`}
                </span>
                <span className="block truncate text-sm">
                  {next ? (
                    <>
                      {next.title}
                      <span className="text-muted"> · {next.artist}</span>
                    </>
                  ) : (
                    <span className="text-muted">End of queue</span>
                  )}
                </span>
              </span>
              <ChevronUp className="h-5 w-5 shrink-0 text-muted" aria-hidden />
            </a>
          )}
        </div>

        {/* Mounted only when shown: on a phone the queue is the sheet, and a
            second, hidden sortable list would duplicate its controls. */}
        {wide && (
          <aside aria-label="Queue">
            <h2 className="mb-2 px-2 text-xl font-semibold">Queue</h2>
            <QueueList />
          </aside>
        )}
      </div>
    </div>
  )
}

function NowPlaying() {
  const { state, current, send } = useJukebox()
  if (!state || !current) return null
  const { playing, currentIndex } = state.status
  const hasNext = currentIndex + 1 < state.queue.length

  return (
    <>
      <Cover
        id={current.coverArt}
        size={1024}
        alt={current.album ? `Cover of ${current.album}` : ''}
        className="mx-auto w-full max-w-[min(100%,52vh)] rounded-xl shadow-2xl shadow-black/50 lg:max-w-[min(100%,40vh)]"
      />

      <div className="mt-6 min-w-0">
        <h2 className="truncate text-2xl font-bold">{current.title}</h2>
        <p className="mt-0.5 truncate text-muted">
          {current.artistId ? (
            <a href={href.artist(current.artistId)} className="hover:text-text hover:underline">
              {current.artist}
            </a>
          ) : (
            current.artist
          )}
          {current.album && (
            <>
              {' · '}
              {current.albumId ? (
                <a href={href.album(current.albumId)} className="hover:text-text hover:underline">
                  {current.album}
                </a>
              ) : (
                current.album
              )}
            </>
          )}
        </p>
      </div>

      <SeekBar duration={current.duration ?? 0} />

      <div className="mt-2 flex items-center justify-center gap-8">
        <button
          onClick={() => void send({ action: 'previous' })}
          className="grid h-14 w-14 place-items-center rounded-full hover:bg-raised"
          aria-label="Previous"
        >
          <SkipBack className="h-7 w-7" fill="currentColor" aria-hidden />
        </button>
        <button
          onClick={() => void send({ action: playing ? 'pause' : 'play' })}
          className="grid h-18 w-18 place-items-center rounded-full bg-accent text-accent-ink shadow-lg shadow-accent/20 hover:brightness-110 active:scale-95"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <Pause className="h-8 w-8" fill="currentColor" aria-hidden />
          ) : (
            <Play className="ml-1 h-8 w-8" fill="currentColor" aria-hidden />
          )}
        </button>
        <button
          onClick={() => void send({ action: 'next' })}
          disabled={!hasNext}
          className="grid h-14 w-14 place-items-center rounded-full hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next"
        >
          <SkipForward className="h-7 w-7" fill="currentColor" aria-hidden />
        </button>
      </div>

      <Volume />
    </>
  )
}

function SeekBar({ duration }: { duration: number }) {
  const { send } = useJukebox()
  const position = usePosition()
  // While dragging, show where the thumb is rather than where playback is.
  const [dragging, setDragging] = useState<number | null>(null)
  const latest = useRef<number | null>(null)
  const shown = dragging ?? position
  const max = Math.max(1, Math.round(duration))

  function commit() {
    if (latest.current === null) return
    void send({ action: 'seek', position: latest.current })
    latest.current = null
    setDragging(null)
  }

  return (
    <div className="mt-4">
      <input
        type="range"
        className="slider"
        min={0}
        max={max}
        step={1}
        value={Math.min(max, Math.round(shown))}
        disabled={!duration}
        style={{ '--fill': `${(shown / max) * 100}%` } as React.CSSProperties}
        aria-label="Seek"
        aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
        onChange={(e) => {
          latest.current = Number(e.target.value)
          setDragging(latest.current)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <div className="-mt-1 flex justify-between text-xs text-faint tabular-nums">
        <span>{clock(shown)}</span>
        <span>-{clock(duration - shown)}</span>
      </div>
    </div>
  )
}

function NothingQueued({ hasQueue }: { hasQueue: boolean }) {
  const { send } = useJukebox()
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line px-8 text-center">
      {hasQueue ? (
        <>
          <p className="text-lg font-semibold">Ready</p>
          <p className="text-sm text-muted">Songs are queued but nothing is loaded.</p>
          <button
            onClick={() => void send({ action: 'jump', index: 0 })}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink"
          >
            <Play className="h-4 w-4" fill="currentColor" aria-hidden /> Play from the top
          </button>
        </>
      ) : (
        <>
          <p className="text-lg font-semibold">Nothing queued on Galactus</p>
          <p className="text-sm text-muted">Pick an album or playlist to start the jukebox.</p>
          <div className="flex gap-2">
            <a
              href={href.library()}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink"
            >
              <Library className="h-4 w-4" aria-hidden /> Library
            </a>
            <a
              href={href.playlists()}
              className="inline-flex items-center gap-2 rounded-full bg-raised px-4 py-2.5 text-sm font-medium hover:bg-line"
            >
              <ListMusic className="h-4 w-4" aria-hidden /> Playlists
            </a>
          </div>
        </>
      )}
    </div>
  )
}

function Unreachable({ proxy }: { proxy: boolean }) {
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-8 text-center">
      <WifiOff className="h-8 w-8 text-faint" aria-hidden />
      <p className="text-lg font-semibold">Can’t see the jukebox</p>
      <p className="text-sm text-muted">
        {proxy
          ? 'The juke server isn’t answering. Is Galactus awake and on the tailnet?'
          : 'Navidrome on Galactus isn’t answering. It may be restarting, or Galactus is asleep.'}
      </p>
      <p className="text-sm text-faint">This page reconnects on its own.</p>
    </div>
  )
}
