import { useQuery } from '@tanstack/react-query'
import { Collection } from '@/components/Collection'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState, Loading } from '@/components/States'
import { api } from '@/lib/api'
import { plural, span } from '@/lib/format'
import { href } from '@/lib/router'

export function AlbumView({ id }: { id: string }) {
  const album = useQuery({ queryKey: ['album', id], queryFn: () => api.album(id) })

  return (
    <div>
      <PageHeader back={href.library()} title={album.data?.name} />
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
