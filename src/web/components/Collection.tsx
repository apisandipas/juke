import { ListEnd, ListPlus, Play, Shuffle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Song } from '@shared/types'
import { useJukebox } from '@/lib/jukebox'
import { Cover } from '@/components/Cover'
import { SongList } from '@/components/SongList'

/** Album or playlist page: art, title, the four ways to send it to the jukebox, tracks. */
export function Collection({
  kind,
  title,
  byline,
  meta,
  coverId,
  songs,
  numbering,
  albumArtist,
}: {
  kind: string
  title: string
  byline?: ReactNode
  meta: string
  coverId?: string
  songs: Song[]
  numbering: 'track' | 'index'
  albumArtist?: string
}) {
  const { send, enqueue } = useJukebox()
  const ids = songs.map((s) => s.id)
  const empty = ids.length === 0

  return (
    <div className="pb-6">
      <div className="flex flex-col items-center gap-5 pt-2 text-center sm:flex-row sm:items-end sm:text-left">
        <Cover id={coverId} size={512} className="w-56 shrink-0 rounded-lg shadow-xl sm:w-48" />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-faint uppercase">{kind}</p>
          <h2 className="mt-1 text-2xl leading-tight font-bold text-balance">{title}</h2>
          {byline && <div className="mt-1 text-muted">{byline}</div>}
          <p className="mt-1 text-sm text-faint">{meta}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-2 sm:max-w-md">
        <ActionButton
          icon={Play}
          label="Play"
          primary
          disabled={empty}
          onClick={() => void send({ action: 'playNow', ids })}
        />
        <ActionButton
          icon={Shuffle}
          label="Shuffle"
          disabled={empty}
          onClick={() => void send({ action: 'playNow', ids: shuffled(ids) })}
        />
        <ActionButton
          icon={ListPlus}
          label="Play next"
          disabled={empty}
          onClick={() => void enqueue(ids, 'next')}
        />
        <ActionButton
          icon={ListEnd}
          label="Add to end"
          disabled={empty}
          onClick={() => void enqueue(ids, 'end')}
        />
      </div>

      <div className="mt-4">
        {empty ? (
          <p className="py-10 text-center text-sm text-muted">
            No songs in this {kind.toLowerCase()}.
          </p>
        ) : (
          <SongList songs={songs} numbering={numbering} albumArtist={albumArtist} />
        )}
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  primary,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-xs font-medium disabled:opacity-40 ${
        primary ? 'bg-accent text-accent-ink hover:brightness-110' : 'bg-surface hover:bg-raised'
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden fill={primary ? 'currentColor' : 'none'} />
      {label}
    </button>
  )
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
