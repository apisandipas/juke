import { useQueryClient } from '@tanstack/react-query'
import { ListMusic, Plus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import type { Playlist } from '@shared/types'
import { useSheet } from '@/components/ActionSheet'
import { useDialog } from '@/components/Dialog'
import { api, playlistApi } from '@/lib/api'
import { plural } from '@/lib/format'
import { useToast } from '@/lib/toast'

const NAME_LIMIT = 200

/**
 * Playlist changes shared by every screen: pick a playlist to add songs to,
 * make a new one, and keep the cached lists in step after each write.
 */
export function usePlaylistActions() {
  const queryClient = useQueryClient()
  const openSheet = useSheet()
  const dialog = useDialog()
  const toast = useToast()

  /** Put a playlist the server just sent into the cache, and refresh the list. */
  const saved = useCallback(
    (playlist: Playlist) => {
      queryClient.setQueryData(['playlist', playlist.id], playlist)
      void queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
    [queryClient],
  )

  /** Drop a deleted playlist from the cache, and refresh the list. */
  const forget = useCallback(
    (id: string) => {
      queryClient.removeQueries({ queryKey: ['playlist', id] })
      void queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
    [queryClient],
  )

  /** Run a write; on failure, show why and resolve to null. */
  const attempt = useCallback(
    async <T>(write: () => Promise<T>): Promise<T | null> => {
      try {
        return await write()
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error')
        return null
      }
    },
    [toast],
  )

  /** Ask for a name and make a playlist holding songIds. Resolves to it, or null. */
  const create = useCallback(
    async (songIds: string[] = [], suggested = '') => {
      const name = await dialog.prompt({
        title: 'New playlist',
        label: 'Name',
        initial: suggested,
        confirm: 'Create',
        maxLength: NAME_LIMIT,
      })
      if (!name) return null
      const playlist = await attempt(() => playlistApi.create(name, songIds))
      if (!playlist) return null
      saved(playlist)
      toast(songIds.length ? `Saved ${plural(songIds.length, 'song')} to ${name}` : `Made ${name}`)
      return playlist
    },
    [dialog, attempt, saved, toast],
  )

  /** Open a sheet of the playlists juke can change, plus "New playlist". */
  const addTo = useCallback(
    async (songIds: string[], what: string) => {
      if (songIds.length === 0) return
      const all = await attempt(() =>
        queryClient.fetchQuery({ queryKey: ['playlists'], queryFn: api.playlists }),
      )
      if (!all) return
      const mine = all.filter((p) => p.editable)
      openSheet({
        title: 'Add to playlist',
        subtitle: what,
        actions: [
          {
            label: 'New playlist',
            icon: Plus,
            onSelect: () => void create(songIds),
          },
          ...mine.map((p) => ({
            label: p.name,
            icon: ListMusic,
            hint: plural(p.songCount ?? 0, 'song'),
            onSelect: () =>
              void (async () => {
                const playlist = await attempt(() => playlistApi.add(p.id, songIds))
                if (!playlist) return
                saved(playlist)
                toast(`Added ${plural(songIds.length, 'song')} to ${p.name}`)
              })(),
          })),
        ],
      })
    },
    [attempt, queryClient, openSheet, create, saved, toast],
  )

  return useMemo(
    () => ({ addTo, create, saved, forget, attempt }),
    [addTo, create, saved, forget, attempt],
  )
}
