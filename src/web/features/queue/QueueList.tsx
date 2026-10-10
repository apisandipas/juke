import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  ListStart,
  MoreHorizontal,
  Play,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Song } from '@shared/types'
import { useSheet, type SheetAction } from '@/components/ActionSheet'
import { Cover } from '@/components/Cover'
import { NowPlayingMark } from '@/components/SongList'
import { Empty } from '@/components/States'
import { clock, plural, span } from '@/lib/format'
import { useJukebox } from '@/lib/jukebox'

/**
 * The jukebox queue: what's playing, what's next, and (folded away) what has
 * played. Only upcoming tracks can be moved, because Navidrome can't reorder
 * around the playing track without restarting it.
 */
export function QueueList() {
  const { state, send } = useJukebox()
  const openSheet = useSheet()
  const [showHistory, setShowHistory] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (!confirmClear) return
    const id = setTimeout(() => setConfirmClear(false), 3000)
    return () => clearTimeout(id)
  }, [confirmClear])

  if (!state) return null
  const { queue } = state
  const current = state.status.currentIndex
  const first = current + 1
  const upcoming = queue.slice(first)
  const history = current > 0 ? queue.slice(0, current) : []
  const remaining = upcoming.reduce((sum, s) => sum + (s.duration ?? 0), 0)

  if (queue.length === 0) {
    return (
      <Empty title="The queue is empty">
        Songs you add from Library or Playlists line up here.
      </Empty>
    )
  }

  function openActions(song: Song, index: number) {
    const isUpcoming = index >= first
    const actions: SheetAction[] = [
      { label: 'Play now', icon: Play, onSelect: () => void send({ action: 'jump', index }) },
    ]
    if (isUpcoming && index > first) {
      actions.push(
        {
          label: 'Play next',
          icon: ListStart,
          onSelect: () => void send({ action: 'move', from: index, to: first, expectId: song.id }),
        },
        {
          label: 'Move up',
          icon: ArrowUp,
          onSelect: () =>
            void send({ action: 'move', from: index, to: index - 1, expectId: song.id }),
        },
      )
    }
    if (isUpcoming && index < queue.length - 1) {
      actions.push({
        label: 'Move down',
        icon: ArrowDown,
        onSelect: () =>
          void send({ action: 'move', from: index, to: index + 1, expectId: song.id }),
      })
    }
    actions.push({
      label: 'Remove from queue',
      icon: X,
      onSelect: () => void send({ action: 'remove', index }),
    })
    openSheet({
      title: song.title,
      subtitle: [song.artist, song.album].filter(Boolean).join(' · '),
      coverId: song.coverArt,
      actions,
    })
  }

  return (
    <div>
      {current >= 0 && queue[current] && (
        <section>
          <SectionTitle>Now playing</SectionTitle>
          <Row song={queue[current]} current paused={!state.status.playing} />
        </section>
      )}

      <section className="mt-4">
        <div className="flex items-center gap-1 pr-1">
          <SectionTitle>
            Up next
            {upcoming.length > 0 && (
              <span className="ml-2 font-normal text-faint normal-case">
                {plural(upcoming.length, 'song')} · {span(remaining)}
              </span>
            )}
          </SectionTitle>
          <span className="flex-1" />
          {upcoming.length > 1 && (
            <button
              onClick={() => void send({ action: 'shuffleUpcoming' })}
              className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-raised hover:text-text"
              aria-label="Shuffle upcoming"
              title="Shuffle upcoming"
            >
              <Shuffle className="h-4 w-4" aria-hidden />
            </button>
          )}
          {upcoming.length > 0 && (
            <button
              onClick={() => {
                if (confirmClear) {
                  setConfirmClear(false)
                  void send({ action: 'clearUpcoming' })
                } else setConfirmClear(true)
              }}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm ${
                confirmClear ? 'bg-danger text-white' : 'text-muted hover:bg-raised hover:text-text'
              }`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {confirmClear ? 'Tap to clear' : 'Clear'}
            </button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted">
            Nothing after this. Add songs from Library or Playlists.
          </p>
        ) : (
          <UpcomingList songs={upcoming} first={first} onOpen={openActions} />
        )}
      </section>

      {history.length > 0 && (
        <section className="mt-4">
          <button
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-muted hover:bg-surface"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showHistory ? '' : '-rotate-90'}`}
              aria-hidden
            />
            Played · {plural(history.length, 'song')}
          </button>
          {showHistory && (
            <ol className="opacity-70">
              {history.map((song, i) => (
                <li key={`${song.id}-${i}`}>
                  <Row song={song} onOpen={() => openActions(song, i)} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * Upcoming tracks, reorderable by dragging the grip on each row. The grip is
 * the only drag target, so a finger on the rest of the row still scrolls.
 * Keyboard: focus a grip, Space to pick up, arrows to move, Space to drop.
 */
function UpcomingList({
  songs,
  first,
  onOpen,
}: {
  songs: Song[]
  /** Queue index of songs[0]. */
  first: number
  onOpen: (song: Song, index: number) => void
}) {
  const { send } = useJukebox()
  // The dropped order, shown until Navidrome has caught up, so the row
  // doesn't snap back for the second the rewrite takes.
  const [optimistic, setOptimistic] = useState<Song[] | null>(null)
  const inFlight = useRef(0)
  const shown = optimistic ?? songs
  const keys = occurrenceKeys(shown)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    const moved = shown[from]
    if (from < 0 || to < 0 || !moved) return
    setOptimistic(arrayMove(shown, from, to))
    inFlight.current++
    await send({ action: 'move', from: first + from, to: first + to, expectId: moved.id })
    // With several drops queued, keep showing the latest until all land.
    if (--inFlight.current === 0) setOptimistic(null)
  }

  const title = (id: string | number) => shown[keys.indexOf(String(id))]?.title ?? 'song'
  const position = (id: string | number) => keys.indexOf(String(id)) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${title(active.id)}, position ${position(active.id)} of ${keys.length}.`,
    onDragOver: ({ active, over }) =>
      over ? `${title(active.id)} moved to position ${position(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${title(active.id)} dropped at position ${position(over.id)}.`
        : `${title(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${title(active.id)} cancelled.`,
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={(e) => void onDragEnd(e)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To reorder, press Space, then use the arrow keys. Press Space again to drop, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ol>
          {shown.map((song, i) => (
            <SortableRow
              key={keys[i]}
              id={keys[i]!}
              song={song}
              onOpen={() => onOpen(song, first + i)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({ id, song, onOpen }: { id: string; song: Song; onOpen: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative ${isDragging ? 'z-10' : ''}`}
    >
      <div
        className={`flex items-center rounded-lg transition-shadow ${
          isDragging ? 'bg-raised shadow-xl shadow-black/50 ring-1 ring-line' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <Row song={song} onOpen={onOpen} />
        </div>
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${song.title}`}
          className={`grid h-12 w-10 shrink-0 touch-none place-items-center rounded-lg text-faint hover:text-text ${
            isDragging ? 'cursor-grabbing text-text' : 'cursor-grab'
          }`}
        >
          <GripVertical className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </li>
  )
}

/**
 * Stable keys for sortable rows: the song id plus which copy of it this is.
 * Index-based keys would change under the row being dragged; the same song
 * can be queued twice, so the id alone is not unique.
 */
function occurrenceKeys(songs: Song[]): string[] {
  const seen = new Map<string, number>()
  return songs.map((s) => {
    const n = seen.get(s.id) ?? 0
    seen.set(s.id, n + 1)
    return `${s.id}#${n}`
  })
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-2 py-2 text-xs font-semibold tracking-wide text-faint uppercase">
      {children}
    </h3>
  )
}

function Row({
  song,
  current,
  paused,
  onOpen,
}: {
  song: Song
  current?: boolean
  paused?: boolean
  onOpen?: () => void
}) {
  const body = (
    <>
      <Cover id={song.coverArt} size={128} className="h-11 w-11 shrink-0 rounded" />
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-2 ${current ? 'text-accent' : ''}`}>
          {current && <NowPlayingMark paused={paused ?? false} />}
          <span className="truncate">{song.title}</span>
        </span>
        <span className="block truncate text-sm text-muted">{song.artist}</span>
      </span>
      <span className="shrink-0 text-sm text-faint tabular-nums">{clock(song.duration)}</span>
    </>
  )
  if (!onOpen) return <div className="flex items-center gap-3 px-2 py-2">{body}</div>
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface"
      aria-label={`${song.title}, more actions`}
    >
      {body}
      <MoreHorizontal className="h-5 w-5 shrink-0 text-faint" aria-hidden />
    </button>
  )
}
