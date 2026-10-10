import { ChevronRight, UserRound } from 'lucide-react'
import type { Album, Artist } from '@shared/types'
import { Cover } from '@/components/Cover'
import { plural } from '@/lib/format'
import { href } from '@/lib/router'

export function AlbumGrid({
  albums,
  showArtist = true,
}: {
  albums: Album[]
  showArtist?: boolean
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {albums.map((album) => (
        <li key={album.id} className="min-w-0">
          <a href={href.album(album.id)} className="group block rounded-lg">
            <Cover
              id={album.coverArt}
              size={512}
              className="rounded-lg transition-transform group-hover:scale-[1.02] group-active:scale-[0.98]"
            />
            <p className="mt-2 truncate text-sm font-medium">{album.name}</p>
            <p className="truncate text-sm text-muted">
              {showArtist ? album.artist : (album.year ?? plural(album.songCount ?? 0, 'song'))}
            </p>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function ArtistRow({ artist }: { artist: Artist }) {
  return (
    <a
      href={href.artist(artist.id)}
      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface"
    >
      {artist.coverArt ? (
        <Cover id={artist.coverArt} size={128} className="h-10 w-10 shrink-0 rounded-full" />
      ) : (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised text-faint">
          <UserRound className="h-5 w-5" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{artist.name}</span>
        {artist.albumCount !== undefined && (
          <span className="block text-sm text-muted">{plural(artist.albumCount, 'album')}</span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
    </a>
  )
}
