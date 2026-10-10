import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Collection } from '@/components/Collection'
import { Cover } from '@/components/Cover'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, Loading } from '@/components/States'
import { api } from '@/lib/api'
import { plural, span } from '@/lib/format'
import { href } from '@/lib/router'

export function PlaylistsView() {
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists })

  return (
    <div>
      <PageHeader title="Playlists" />
      {playlists.isPending ? (
        <Loading label="Loading playlists" />
      ) : playlists.isError ? (
        <ErrorState error={playlists.error} retry={() => void playlists.refetch()} />
      ) : playlists.data.length === 0 ? (
        <Empty title="No playlists yet">
          Make one in Navidrome’s web UI or any Subsonic app and it shows up here.
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

  return (
    <div>
      <PageHeader back={href.playlists()} title={playlist.data?.name} />
      {playlist.isPending ? (
        <Loading label="Loading playlist" />
      ) : playlist.isError ? (
        <ErrorState error={playlist.error} retry={() => void playlist.refetch()} />
      ) : (
        <Collection
          kind="Playlist"
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
