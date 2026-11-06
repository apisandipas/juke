import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { SongList } from '@/components/SongList'
import { Empty, ErrorState, Loading } from '@/components/States'
import { api, type AlbumListType } from '@/lib/api'
import { href } from '@/lib/router'
import { useViewMode, type ViewMode } from '@/lib/viewMode'
import { AlbumGrid, AlbumList, ArtistGrid, ArtistRow, ViewToggle } from '@/features/library/parts'

const SORTS: { type: AlbumListType; label: string }[] = [
  { type: 'newest', label: 'Recently added' },
  { type: 'recent', label: 'Recently played' },
  { type: 'frequent', label: 'Most played' },
  { type: 'alphabeticalByName', label: 'A–Z' },
  { type: 'random', label: 'Random' },
]

const PAGE = 40

export function LibraryView({ tab, urlQuery }: { tab: 'albums' | 'artists'; urlQuery: string }) {
  const [query, setQueryState] = useState(urlQuery)
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery)
  const deferred = useDeferredValue(query.trim())
  // Each tab remembers its own view; the defaults match how they looked before.
  const [albumView, setAlbumView] = useViewMode('albums', 'grid')
  const [artistView, setArtistView] = useViewMode('artists', 'list')

  // The URL changed from outside (the Library tab, back/forward): follow it.
  if (urlQuery !== prevUrlQuery) {
    setPrevUrlQuery(urlQuery)
    setQueryState(urlQuery)
  }

  // Mirror the query into the URL without adding history entries, so
  // returning from a result lands back on the same search. Stored as typed,
  // trailing space included, so a later re-read of the URL matches the input.
  function setQuery(q: string) {
    setQueryState(q)
    window.history.replaceState(null, '', href.library(tab, q))
  }

  return (
    <div>
      <PageHeader title="Library" />
      <div className="relative mt-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Songs, albums, artists"
          aria-label="Search the library"
          enterKeyHint="search"
          className="h-11 w-full rounded-xl bg-surface pr-10 pl-9 text-base placeholder:text-faint focus:bg-raised focus:outline-none focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute top-1/2 right-1 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-text"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {deferred ? (
        <SearchResults query={deferred} />
      ) : (
        <>
          <div className="mt-4 flex items-end gap-2 border-b border-line">
            <nav className="flex gap-1" aria-label="Library sections">
              {(['albums', 'artists'] as const).map((t) => (
                <a
                  key={t}
                  href={href.library(t)}
                  aria-current={tab === t ? 'page' : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
                    tab === t
                      ? 'border-accent text-text'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {t}
                </a>
              ))}
            </nav>
            <div className="mb-1.5 ml-auto">
              {tab === 'albums' ? (
                <ViewToggle mode={albumView} onChange={setAlbumView} label="albums" />
              ) : (
                <ViewToggle mode={artistView} onChange={setArtistView} label="artists" />
              )}
            </div>
          </div>
          {tab === 'albums' ? <Albums view={albumView} /> : <Artists view={artistView} />}
        </>
      )}
    </div>
  )
}

function Albums({ view }: { view: ViewMode }) {
  const [sort, setSort] = useState<AlbumListType>('newest')
  const albums = useInfiniteQuery({
    queryKey: ['albums', sort],
    queryFn: ({ pageParam }) => api.albumList(sort, pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      // Random has no stable order to page through.
      sort === 'random' || last.length < PAGE ? undefined : pages.length * PAGE,
  })

  return (
    <div className="mt-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {SORTS.map((s) => (
          <button
            key={s.type}
            onClick={() => setSort(s.type)}
            aria-pressed={sort === s.type}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
              sort === s.type ? 'bg-text text-bg' : 'bg-surface text-muted hover:text-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {albums.isPending ? (
          <Loading label="Loading albums" />
        ) : albums.isError ? (
          <ErrorState error={albums.error} retry={() => void albums.refetch()} />
        ) : albums.data.pages[0]?.length === 0 ? (
          <Empty title="No albums yet">
            {sort === 'recent' || sort === 'frequent'
              ? 'Nothing has been played through Navidrome yet.'
              : 'Navidrome hasn’t found any music. Check its library scan.'}
          </Empty>
        ) : (
          <>
            {view === 'grid' ? (
              <AlbumGrid albums={albums.data.pages.flat()} />
            ) : (
              <AlbumList albums={albums.data.pages.flat()} />
            )}
            {albums.hasNextPage && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => void albums.fetchNextPage()}
                  disabled={albums.isFetchingNextPage}
                  className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-raised disabled:opacity-60"
                >
                  {albums.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
            {sort === 'random' && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => void albums.refetch()}
                  className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-raised"
                >
                  Shuffle again
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Artists({ view }: { view: ViewMode }) {
  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists })
  if (artists.isPending) return <Loading label="Loading artists" />
  if (artists.isError)
    return <ErrorState error={artists.error} retry={() => void artists.refetch()} />
  if (artists.data.length === 0) return <Empty title="No artists yet" />

  return (
    <div className="mt-2">
      {artists.data.map((group) => (
        <section key={group.letter}>
          <h3
            className="sticky z-10 bg-bg/60 px-2 py-1.5 text-xs font-semibold text-faint backdrop-blur-xl"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 3rem)' }}
          >
            {group.letter}
          </h3>
          {view === 'grid' ? (
            <div className="px-2 pt-2 pb-4">
              <ArtistGrid artists={group.artists} />
            </div>
          ) : (
            <ul>
              {group.artists.map((artist) => (
                <li key={artist.id}>
                  <ArtistRow artist={artist} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function SearchResults({ query }: { query: string }) {
  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    placeholderData: (previous) => previous,
  })

  if (results.isPending) return <Loading label="Searching" />
  if (results.isError)
    return <ErrorState error={results.error} retry={() => void results.refetch()} />
  const { artists, albums, songs } = results.data
  if (!artists.length && !albums.length && !songs.length) {
    return <Empty title={`Nothing matches “${query}”`}>Try fewer words or another spelling.</Empty>
  }

  return (
    <div className={`mt-4 space-y-6 ${results.isPlaceholderData ? 'opacity-60' : ''}`}>
      {songs.length > 0 && (
        <section>
          <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">
            Songs
          </h3>
          <SongList songs={songs} showArt numbering="none" />
        </section>
      )}
      {albums.length > 0 && (
        <section>
          <h3 className="px-2 pb-2 text-xs font-semibold tracking-wide text-faint uppercase">
            Albums
          </h3>
          <AlbumGrid albums={albums} />
        </section>
      )}
      {artists.length > 0 && (
        <section>
          <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">
            Artists
          </h3>
          <ul>
            {artists.map((artist) => (
              <li key={artist.id}>
                <ArtistRow artist={artist} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
