import { useQuery } from '@tanstack/react-query'
import { ListMusic, MoreHorizontal } from 'lucide-react'
import { useSheet } from '@/components/ActionSheet'
import { Collection } from '@/components/Collection'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState, Loading } from '@/components/States'
import { api } from '@/lib/api'
import { usePlaylistActions } from '@/lib/playlists'
import { plural, span } from '@/lib/format'
import { href } from '@/lib/router'

export function AlbumView({ id }: { id: string }) {
  const album = useQuery({ queryKey: ['album', id], queryFn: () => api.album(id) })
  const openSheet = useSheet()
  const { addTo } = usePlaylistActions()
  const songs = album.data?.song ?? []

  const more = album.data && songs.length > 0 && (
    <button
      onClick={() =>
        openSheet({
          title: album.data.name,
          subtitle: album.data.artist,
          coverId: album.data.coverArt,
          actions: [
            {
              label: 'Add album to playlist',
              icon: ListMusic,
              onSelect: () =>
                void addTo(
                  songs.map((s) => s.id),
                  album.data.name,
                ),
            },
          ],
        })
      }
      className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-raised hover:text-text"
      aria-label="More album actions"
    >
      <MoreHorizontal className="h-5 w-5" aria-hidden />
    </button>
  )

  return (
    <div>
      <PageHeader back={href.library()} title={album.data?.name} actions={more} />
      {album.isPending ? (
        <Loading label="Loading album" />
      ) : album.isError ? (
        <ErrorState error={album.error} retry={() => void album.refetch()} />
      ) : (
        <Collection
          kind="Album"
          title={album.data.name}
          coverId={album.data.coverArt}
          byline={
            album.data.artistId ? (
              <a
                href={href.artist(album.data.artistId)}
                className="hover:text-text hover:underline"
              >
                {album.data.artist}
              </a>
            ) : (
              album.data.artist
            )
          }
          meta={[
            album.data.year,
            plural(album.data.song?.length ?? 0, 'song'),
            span(album.data.duration),
          ]
            .filter(Boolean)
            .join(' · ')}
          songs={album.data.song ?? []}
          numbering="track"
          albumArtist={album.data.artist}
        />
      )}
    </div>
  )
}
