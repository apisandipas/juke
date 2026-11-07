import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { Collection } from '@/components/Collection'
import { Cover } from '@/components/Cover'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, Loading } from '@/components/States'
import { PlaylistEditor } from '@/features/playlists/PlaylistEditor'
import { api } from '@/lib/api'
import { plural, span } from '@/lib/format'
import { usePlaylistActions } from '@/lib/playlists'
import { href } from '@/lib/router'

export function PlaylistsView() {
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists })
  const { create } = usePlaylistActions()

  async function newPlaylist() {
    const made = await create()
    if (made) window.location.hash = href.playlist(made.id)
  }

  return (
    <div>
      <PageHeader
        title="Playlists"
        actions={
          <button
            onClick={() => void newPlaylist()}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted hover:bg-raised hover:text-text"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New
          </button>
        }
      />
      {playlists.isPending ? (
        <Loading label="Loading playlists" />
      ) : playlists.isError ? (
        <ErrorState error={playlists.error} retry={() => void playlists.refetch()} />
      ) : playlists.data.length === 0 ? (
        <Empty title="No playlists yet">
          Tap New, add songs from Library, or save the queue as a playlist.
        </Empty>
      ) : (
        <ul className="mt-1">
          {playlists.data.map((p) => (
            <li key={p.id}>
              <a
                href={href.playlist(p.id)}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface"
              >
                <Cover id={p.coverArt} size={128} className="h-14 w-14 shrink-0 rounded" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-sm text-muted">
                    {plural(p.songCount ?? 0, 'song')} · {span(p.duration)}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PlaylistView({ id }: { id: string }) {
  const playlist = useQuery({ queryKey: ['playlist', id], queryFn: () => api.playlist(id) })
  const [editing, setEditing] = useState(false)

  if (editing && playlist.data) {
    return <PlaylistEditor key={id} playlist={playlist.data} onClose={() => setEditing(false)} />
  }

  const p = playlist.data
  return (
    <div>
      <PageHeader
        back={href.playlists()}
        title={p?.name}
        actions={
          p?.editable && (
            <button
              onClick={() => setEditing(true)}
              className="h-9 rounded-full px-3 text-sm font-medium text-muted hover:bg-raised hover:text-text"
            >
              Edit
            </button>
          )
        }
      />
      {playlist.isPending ? (
        <Loading label="Loading playlist" />
      ) : playlist.isError ? (
        <ErrorState error={playlist.error} retry={() => void playlist.refetch()} />
      ) : (
        <Collection
          kind={playlist.data.readonly ? 'Smart playlist' : 'Playlist'}
          title={playlist.data.name}
          coverId={playlist.data.coverArt}
          byline={playlist.data.comment}
          meta={[
            playlist.data.owner && `by ${playlist.data.owner}`,
            plural(playlist.data.entry?.length ?? 0, 'song'),
            span(playlist.data.duration),
          ]
            .filter(Boolean)
            .join(' · ')}
          songs={playlist.data.entry ?? []}
          numbering="index"
        />
      )}
    </div>
  )
}
