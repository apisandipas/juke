import { ChevronDown, Library, ListMusic, Pause, Play, Radio, SkipForward } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Backdrop } from '@/components/Backdrop'
import { Cover } from '@/components/Cover'
import { PageHeader } from '@/components/PageHeader'
import { AlbumView } from '@/features/library/AlbumView'
import { ArtistView } from '@/features/library/ArtistView'
import { LibraryView } from '@/features/library/LibraryView'
import { PlaylistsView, PlaylistView } from '@/features/playlists/PlaylistsView'
import { QueueList } from '@/features/queue/QueueList'
import { RemoteView } from '@/features/remote/RemoteView'
import { useJukebox, usePosition } from '@/lib/jukebox'
import { goBack, href, usePagePath, useRoute, type Route } from '@/lib/router'

export function App() {
  const route = useRoute()
  const section = sectionOf(route)
  const showMini = section !== 'remote'
  const chrome = useRef<HTMLDivElement>(null)

  // Publish the bottom chrome's height so toasts and page padding clear it.
  useEffect(() => {
    const el = chrome.current
    if (!el) return
    const update = () =>
      document.documentElement.style.setProperty('--chrome-bottom', `${el.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Each page starts at the top; the queue sheet sits over the remote.
  const pagePath = usePagePath()
  useEffect(() => {
    if (pagePath !== '#/queue') window.scrollTo(0, 0)
  }, [pagePath])

  return (
    <>
      <NowPlayingBackdrop dim={section !== 'remote'} />
      <main
        // The queue sheet covers the remote on phones; hide what's under it
        // so the sheet shows the backdrop, not a blurred copy of the page.
        hidden={route.name === 'queue'}
        className="relative z-[1] mx-auto max-w-5xl px-4"
        style={{
          paddingTop: 'max(1rem, env(safe-area-inset-top))',
          paddingBottom: 'calc(var(--chrome-bottom) + 1.5rem)',
        }}
      >
        <Page route={route} />
      </main>

      {route.name === 'queue' && <QueueSheet />}

      <div ref={chrome} className="fixed inset-x-0 bottom-0 z-30">
        {showMini && <MiniPlayer />}
        <TabBar section={section} />
      </div>
    </>
  )
}

/**
 * Reads the jukebox itself, so position updates (about once a second)
 * re-render this backdrop and not the whole app around it.
 */
function NowPlayingBackdrop({ dim }: { dim: boolean }) {
  const { current } = useJukebox()
  return <Backdrop coverId={current?.coverArt} dim={dim} />
}

type Section = 'remote' | 'library' | 'playlists'

function sectionOf(route: Route): Section {
  switch (route.name) {
    case 'library':
    case 'album':
    case 'artist':
      return 'library'
    case 'playlists':
    case 'playlist':
      return 'playlists'
    default:
      return 'remote'
  }
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'remote':
    case 'queue':
      return <RemoteView />
    case 'library':
      return <LibraryView tab={route.tab} urlQuery={route.q} />
    case 'album':
      return <AlbumView id={route.id} />
    case 'artist':
      return <ArtistView id={route.id} />
    case 'playlists':
      return <PlaylistsView />
    case 'playlist':
      return <PlaylistView id={route.id} />
  }
}

function TabBar({ section }: { section: Section }) {
  const tabs: { id: Section; label: string; icon: typeof Radio; to: string }[] = [
    { id: 'remote', label: 'Remote', icon: Radio, to: href.remote() },
    { id: 'library', label: 'Library', icon: Library, to: href.library() },
    { id: 'playlists', label: 'Playlists', icon: ListMusic, to: href.playlists() },
  ]
  return (
    <nav
      className="border-t border-line/60 bg-bg/75 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Sections"
    >
      <ul className="mx-auto flex max-w-md">
        {tabs.map(({ id, label, icon: Icon, to }) => (
          <li key={id} className="flex-1">
            <a
              href={to}
              aria-current={section === id ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${
                section === id ? 'text-accent' : 'text-faint hover:text-text'
              }`}
            >
              <Icon className="h-6 w-6" aria-hidden />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Compact now-playing bar shown above the tabs while browsing. */
function MiniPlayer() {
  const { state, current, send } = useJukebox()
  const position = usePosition()
  if (!state || !current) return null
  const { playing, currentIndex } = state.status
  const hasNext = currentIndex + 1 < state.queue.length
  const progress = current.duration ? (position / current.duration) * 100 : 0

  return (
    <div className="mx-auto max-w-5xl px-2 pb-2">
      <div className="relative overflow-hidden rounded-xl bg-raised shadow-lg shadow-black/40">
        <div className="flex items-center gap-1 p-1.5 pr-1">
          <a
            href={href.remote()}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg"
            aria-label={`Now playing: ${current.title}. Open remote`}
          >
            <Cover id={current.coverArt} size={128} className="h-10 w-10 shrink-0 rounded-md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{current.title}</span>
              <span className="block truncate text-xs text-muted">{current.artist}</span>
            </span>
          </a>
          <button
            onClick={() => void send({ action: playing ? 'pause' : 'play' })}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-line"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause className="h-5 w-5" fill="currentColor" aria-hidden />
            ) : (
              <Play className="h-5 w-5" fill="currentColor" aria-hidden />
            )}
          </button>
          <button
            onClick={() => void send({ action: 'next' })}
            disabled={!hasNext}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-line disabled:opacity-30"
            aria-label="Next"
          >
            <SkipForward className="h-5 w-5" fill="currentColor" aria-hidden />
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line" aria-hidden>
          <div className="h-full bg-text/80" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}

/** The queue as a full-height sheet on phones; wide screens show it beside the remote. */
function QueueSheet() {
  useEffect(() => {
    // Wide screens already show the queue; leave the sheet route.
    const wide = window.matchMedia('(min-width: 1024px)')
    if (wide.matches) window.location.replace(href.remote())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goBack(href.remote())
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [])

  return (
    <Overlay>
      <PageHeader
        title="Queue"
        actions={
          <button
            onClick={() => goBack(href.remote())}
            className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-raised hover:text-text"
            aria-label="Close queue"
          >
            <ChevronDown className="h-6 w-6" aria-hidden />
          </button>
        }
      />
      <QueueList />
    </Overlay>
  )
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Queue"
      className="sheet-in fixed inset-0 z-30 overflow-y-auto px-4"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)',
      }}
    >
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  )
}
