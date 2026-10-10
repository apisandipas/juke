import { Disc3, ListEnd, ListPlus, ListStart, Play, Plus, UserRound } from 'lucide-react'
import type { Song } from '@shared/types'
import { clock } from '@/lib/format'
import { useJukebox } from '@/lib/jukebox'
import { href } from '@/lib/router'
import { useSheet } from '@/components/ActionSheet'
import { Cover } from '@/components/Cover'

/** Animated bars marking the track that is on the jukebox right now. */
export function NowPlayingMark({ paused }: { paused: boolean }) {
  return (
    <span
      className="eq inline-flex h-3.5 w-3.5 items-end justify-between"
      data-paused={paused}
      aria-label={paused ? 'Paused' : 'Now playing'}
      role="img"
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-full w-[3px] rounded-sm bg-accent" />
      ))}
    </span>
  )
}

/**
 * A list of songs from an album, playlist or search. Tapping a row opens its
 * actions rather than playing it, because "play" replaces the whole jukebox
 * queue and that is too easy to do by accident on a shared remote. The +
 * button is the one-tap path: add to the end of the queue.
 */
export function SongList({
  songs,
  numbering = 'track',
  showArt = false,
  albumArtist,
}: {
  songs: Song[]
  /** 'track' shows the track number, 'index' the row position. */
  numbering?: 'track' | 'index' | 'none'
  showArt?: boolean
  /** On an album page: hide each track's artist when it matches this. */
  albumArtist?: string
}) {
  const { send, enqueue, current, state } = useJukebox()
  const openSheet = useSheet()
  const ids = songs.map((s) => s.id)
  const multiDisc = new Set(songs.map((s) => s.discNumber ?? 1)).size > 1

  function openActions(song: Song, index: number) {
    const actions = [
      ...(songs.length > 1
        ? [
            {
              label: 'Play from here',
              icon: Play,
              hint: 'replaces queue',
              onSelect: () => void send({ action: 'playNow', ids, startIndex: index }),
            },
          ]
        : []),
      {
        label: songs.length > 1 ? 'Play only this song' : 'Play now',
        icon: songs.length > 1 ? ListStart : Play,
        hint: 'replaces queue',
        onSelect: () => void send({ action: 'playNow', ids: [song.id] }),
      },
      { label: 'Play next', icon: ListPlus, onSelect: () => void enqueue([song.id], 'next') },
      { label: 'Add to queue', icon: ListEnd, onSelect: () => void enqueue([song.id], 'end') },
      ...(song.albumId
        ? [
            {
              label: 'Go to album',
              icon: Disc3,
              onSelect: () => (location.hash = href.album(song.albumId!)),
            },
          ]
        : []),
      ...(song.artistId
        ? [
            {
              label: 'Go to artist',
              icon: UserRound,
              onSelect: () => (location.hash = href.artist(song.artistId!)),
            },
          ]
        : []),
    ]
    openSheet({
      title: song.title,
      subtitle: [song.artist, song.album].filter(Boolean).join(' · '),
      coverId: song.coverArt,
      actions,
    })
  }

  return (
    <ol>
      {songs.map((song, i) => {
        const disc = song.discNumber ?? 1
        const discHeader = multiDisc && (i === 0 || disc !== (songs[i - 1]?.discNumber ?? 1))
        const isCurrent = current?.id === song.id
        return (
          <li key={`${song.id}-${i}`}>
            {discHeader && (
              <p className="px-2 pt-4 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">
                Disc {disc}
              </p>
            )}
            <div className="group flex items-center rounded-lg hover:bg-surface">
              <button
                onClick={() => openActions(song, i)}
                className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-2 text-left"
              >
                {showArt ? (
                  <Cover id={song.coverArt} size={128} className="h-11 w-11 shrink-0 rounded" />
                ) : (
                  numbering !== 'none' && (
                    <span className="flex w-6 shrink-0 justify-end text-sm text-faint tabular-nums">
                      {isCurrent ? (
                        <NowPlayingMark paused={!state?.status.playing} />
                      ) : numbering === 'track' ? (
                        (song.track ?? '')
                      ) : (
                        i + 1
                      )}
                    </span>
                  )
                )}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${isCurrent ? 'text-accent' : ''}`}>
                    {song.title}
                  </span>
                  {(showArt || song.artist !== albumArtist) && (
                    <span className="block truncate text-sm text-muted">
                      {showArt
                        ? [song.artist, song.album].filter(Boolean).join(' · ')
                        : song.artist}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm text-faint tabular-nums">
                  {clock(song.duration)}
                </span>
              </button>
              <button
                onClick={() => void enqueue([song.id], 'end')}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-text"
                aria-label={`Add ${song.title} to queue`}
              >
                <Plus className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
