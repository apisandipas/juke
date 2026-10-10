import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, Loading } from '@/components/States'
import { api } from '@/lib/api'
import { plural } from '@/lib/format'
import { href } from '@/lib/router'
import { AlbumGrid } from '@/features/library/parts'

export function ArtistView({ id }: { id: string }) {
  const artist = useQuery({ queryKey: ['artist', id], queryFn: () => api.artist(id) })
  // Newest first reads like a discography; undated albums go last.
  const albums = [...(artist.data?.album ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))

  return (
    <div>
      <PageHeader back={href.library('artists')} title={artist.data?.name} />
      {artist.isPending ? (
        <Loading label="Loading artist" />
      ) : artist.isError ? (
        <ErrorState error={artist.error} retry={() => void artist.refetch()} />
      ) : (
        <>
          <div className="pt-2 pb-5">
            <p className="text-xs font-semibold tracking-wide text-faint uppercase">Artist</p>
            <h2 className="mt-1 text-3xl font-bold text-balance">{artist.data.name}</h2>
            <p className="mt-1 text-sm text-faint">{plural(albums.length, 'album')}</p>
          </div>
          {albums.length ? (
            <AlbumGrid albums={albums} showArtist={false} />
          ) : (
            <Empty title="No albums for this artist" />
          )}
        </>
      )}
    </div>
  )
}
