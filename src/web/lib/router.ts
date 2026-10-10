import { useSyncExternalStore } from 'react'

// Routes live in the hash so the browser back button, reloads and
// home-screen launches all work without server-side routing.

export type Route =
  | { name: 'remote' }
  | { name: 'queue' }
  | { name: 'library'; tab: 'albums' | 'artists'; q: string }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlists' }
  | { name: 'playlist'; id: string }

export function parse(hash: string): Route {
  const [path = '', search = ''] = hash.replace(/^#\/?/, '').split('?')
  const [section, a, b] = path.split('/').map(decodeURIComponent)
  switch (section) {
    case 'queue':
      return { name: 'queue' }
    case 'library':
      if (a === 'album' && b) return { name: 'album', id: b }
      if (a === 'artist' && b) return { name: 'artist', id: b }
      return {
        name: 'library',
        tab: a === 'artists' ? 'artists' : 'albums',
        q: new URLSearchParams(search).get('q') ?? '',
      }
    case 'playlists':
      return a ? { name: 'playlist', id: a } : { name: 'playlists' }
    default:
      return { name: 'remote' }
  }
}

export const href = {
  remote: () => '#/',
  queue: () => '#/queue',
  library: (tab: 'albums' | 'artists' = 'albums', q = '') =>
    `#/library/${tab}${q ? `?${new URLSearchParams({ q })}` : ''}`,
  album: (id: string) => `#/library/album/${encodeURIComponent(id)}`,
  artist: (id: string) => `#/library/artist/${encodeURIComponent(id)}`,
  playlists: () => '#/playlists',
  playlist: (id: string) => `#/playlists/${encodeURIComponent(id)}`,
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parse(hash)
}

/** Back within the app if there is history, otherwise to a sensible parent. */
export function goBack(fallback: string) {
  if (window.history.length > 1) window.history.back()
  else window.location.hash = fallback
}
