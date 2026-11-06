import { ChevronRight, LayoutGrid, List, UserRound } from 'lucide-react'
import type { Album, Artist } from '@shared/types'
import { Cover } from '@/components/Cover'
import { plural } from '@/lib/format'
import { href } from '@/lib/router'
import type { ViewMode } from '@/lib/viewMode'

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

/** Albums as rows: a small cover, the title, and the artist and year. Faster to scan than covers. */
export function AlbumList({ albums }: { albums: Album[] }) {
  return (
    <ul>
      {albums.map((album) => (
        <li key={album.id}>
          <a
            href={href.album(album.id)}
            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface"
          >
            <Cover id={album.coverArt} size={128} className="h-12 w-12 shrink-0 rounded-md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{album.name}</span>
              <span className="block truncate text-sm text-muted">
                {[album.artist, album.year].filter(Boolean).join(' · ')}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  )
}

/** Artists as tiles: a round image (or a placeholder), the name and album count. */
export function ArtistGrid({ artists }: { artists: Artist[] }) {
  return (
    <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {artists.map((artist) => (
        <li key={artist.id} className="min-w-0">
          <a href={href.artist(artist.id)} className="group block rounded-lg text-center">
            {artist.coverArt ? (
              <Cover
                id={artist.coverArt}
                size={256}
                className="rounded-full transition-transform group-hover:scale-[1.02] group-active:scale-[0.98]"
              />
            ) : (
              <span className="grid aspect-square place-items-center rounded-full bg-raised text-faint">
                <UserRound className="h-2/5 w-2/5" strokeWidth={1.25} aria-hidden />
              </span>
            )}
            <p className="mt-2 truncate text-sm font-medium">{artist.name}</p>
            {artist.albumCount !== undefined && (
              <p className="truncate text-xs text-muted">{plural(artist.albumCount, 'album')}</p>
            )}
          </a>
        </li>
      ))}
    </ul>
  )
}

/** The grid/list switch, as two icon buttons. */
export function ViewToggle({
  mode,
  onChange,
  label,
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  /** What is being shown, for screen readers: "albums", "artists". */
  label: string
}) {
  const options = [
    { value: 'grid', icon: LayoutGrid, text: `Show ${label} as a grid` },
    { value: 'list', icon: List, text: `Show ${label} as a list` },
  ] as const
  return (
    <div className="flex shrink-0 rounded-full bg-surface p-0.5" role="group" aria-label="View">
      {options.map(({ value, icon: Icon, text }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
          aria-label={text}
          title={text}
          className={`grid h-8 w-8 place-items-center rounded-full ${
            mode === value ? 'bg-raised text-text' : 'text-faint hover:text-text'
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      ))}
    </div>
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
