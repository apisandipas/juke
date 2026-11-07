import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
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
import { GripVertical, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Playlist, Song } from '@shared/types'
import { Cover } from '@/components/Cover'
import { useDialog } from '@/components/Dialog'
import { PageHeader } from '@/components/PageHeader'
import { occurrenceKeys } from '@/features/queue/QueueList'
import { playlistApi } from '@/lib/api'
import { clock, plural } from '@/lib/format'
import { usePlaylistActions } from '@/lib/playlists'
import { href } from '@/lib/router'
import { useToast } from '@/lib/toast'

/**
 * Edit mode for one playlist: rename it, remove songs, drag to reorder, or
 * delete it. Changes stay on this screen until Done, then go to Navidrome in
 * one write, which is refused if someone changed the playlist meanwhile.
 */
export function PlaylistEditor({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const original = playlist.entry ?? []
  const [name, setName] = useState(playlist.name)
  const [songs, setSongs] = useState<Song[]>(original)
  const [saving, setSaving] = useState(false)
  const { saved, forget, attempt } = usePlaylistActions()
  const dialog = useDialog()
  const toast = useToast()

  const keys = occurrenceKeys(songs)
  const trimmed = name.trim()
  const renamed = trimmed !== playlist.name
  const reordered =
    songs.length !== original.length || songs.some((s, i) => s.id !== original[i]?.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from >= 0 && to >= 0) setSongs(arrayMove(songs, from, to))
  }

  async function save() {
    if (!trimmed) {
      toast('Give the playlist a name', 'error')
      return
    }
    if (!renamed && !reordered) return onClose()
    setSaving(true)
    let latest: Playlist | null = playlist
    if (renamed) {
      latest = await attempt(() => playlistApi.rename(playlist.id, trimmed))
      // Keep the new name even if the song change below is refused.
      if (latest) saved(latest)
    }
    if (latest && reordered) {
      latest = await attempt(() =>
        playlistApi.setSongs(
          playlist.id,
          songs.map((s) => s.id),
          original.map((s) => s.id),
        ),
      )
    }
    setSaving(false)
    if (!latest) return
    saved(latest)
    toast('Playlist saved')
    onClose()
  }

  async function remove() {
    const sure = await dialog.confirm({
      title: `Delete ${playlist.name}?`,
      body: 'It is removed from Navidrome for every app. The songs stay in your library.',
      confirm: 'Delete',
      danger: true,
    })
    if (!sure) return
    const done = await attempt(() => playlistApi.remove(playlist.id).then(() => true))
    if (!done) return
    forget(playlist.id)
    toast(`Deleted ${playlist.name}`)
    window.location.replace(href.playlists())
  }

  return (
    <div className="pb-6">
      <PageHeader
        title="Edit playlist"
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="h-9 rounded-full px-3 text-sm text-muted hover:bg-raised hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink hover:brightness-110 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        }
      />

      <label className="mt-2 block px-2">
        <span className="text-sm text-muted">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          autoComplete="off"
          className="mt-1 w-full rounded-lg bg-surface px-3 py-2.5 font-medium outline-none focus:ring-2 focus:ring-accent"
        />
      </label>

      <p className="mt-5 px-2 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">
        {plural(songs.length, 'song')}
      </p>
      {songs.length === 0 ? (
        <p className="px-2 py-6 text-sm text-muted">No songs left. Done saves it empty.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                'To reorder, press Space, then use the arrow keys. Press Space again to drop, or Escape to cancel.',
            },
          }}
        >
          <SortableContext items={keys} strategy={verticalListSortingStrategy}>
            <ol>
              {songs.map((song, i) => (
                <EditRow
                  key={keys[i]}
                  id={keys[i]!}
                  song={song}
                  onRemove={() => setSongs(songs.filter((_, j) => j !== i))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <button
        onClick={() => void remove()}
        disabled={saving}
        className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-danger hover:bg-surface"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        Delete playlist
      </button>
    </div>
  )
}

function EditRow({ id, song, onRemove }: { id: string; song: Song; onRemove: () => void }) {
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
        className={`flex items-center gap-1 rounded-lg ${
          isDragging ? 'bg-raised shadow-xl shadow-black/50 ring-1 ring-line' : ''
        }`}
      >
        <button
          onClick={onRemove}
          aria-label={`Remove ${song.title}`}
          className="grid h-11 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-danger"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <Cover id={song.coverArt} size={128} className="h-11 w-11 shrink-0 rounded" />
        <span className="ml-2 min-w-0 flex-1">
          <span className="block truncate">{song.title}</span>
          <span className="block truncate text-sm text-muted">{song.artist}</span>
        </span>
        <span className="shrink-0 text-sm text-faint tabular-nums">{clock(song.duration)}</span>
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
