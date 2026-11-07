import { ListEnd, ListMusic, LoaderCircle, Play, Shuffle, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AskResult } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { SongList } from '@/components/SongList'
import { askForMusic } from '@/lib/api'
import { plural } from '@/lib/format'
import { useJukebox } from '@/lib/jukebox'
import { usePlaylistActions } from '@/lib/playlists'

const MAX_PROMPT = 500
const EXAMPLES = [
  'Rainy Sunday, nothing with vocals',
  'An hour of upbeat stuff for cooking',
  'More like what’s playing, but heavier',
  'Late-night jazz from the 50s and 60s',
]

/** The last answer, kept while the app is open so leaving the tab doesn't lose it. */
let last: { prompt: string; result: AskResult } | null = null

/**
 * Ask: describe what you want to hear and get songs from your own library,
 * each with why it was picked. Shown only when the person running juke has
 * set an Anthropic API key.
 */
export function AskView() {
  const { current, send, enqueue } = useJukebox()
  const { create } = usePlaylistActions()
  const [prompt, setPrompt] = useState(last?.prompt ?? '')
  const [result, setResult] = useState<AskResult | null>(last?.result ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const answer = await askForMusic({ prompt: text, nowPlaying: current })
      last = { prompt: text, result: answer }
      setResult(answer)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const songs = result?.picks.map((p) => p.song) ?? []

  return (
    <div className="pb-6">
      <PageHeader title="Ask" />

      <form onSubmit={(e) => void submit(e)} className="mt-1">
        <label htmlFor="ask-prompt" className="sr-only">
          What would you like to hear?
        </label>
        <textarea
          id="ask-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            // Enter asks; Shift+Enter is a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          maxLength={MAX_PROMPT}
          rows={3}
          placeholder="What would you like to hear?"
          enterKeyHint="send"
          className="w-full resize-none rounded-xl bg-surface px-4 py-3 outline-none placeholder:text-faint focus:ring-2 focus:ring-accent"
        />
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 text-xs text-faint">Picks come only from your library.</p>
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink hover:brightness-110 disabled:opacity-40"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {busy ? 'Picking…' : 'Ask'}
          </button>
        </div>
      </form>

      {!result && !busy && !error && (
        <div className="mt-6">
          <p className="px-1 text-xs font-semibold tracking-wide text-faint uppercase">Try</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  onClick={() => setPrompt(example)}
                  className="rounded-full bg-surface px-3 py-1.5 text-sm text-muted hover:bg-raised hover:text-text"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {busy && (
        <p className="mt-10 text-center text-sm text-muted" role="status">
          Looking through your library. This can take half a minute.
        </p>
      )}

      {error && !busy && (
        <p className="mt-6 rounded-xl bg-surface px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {result && !busy && (
        <section className="mt-8" aria-label="Picks">
          <h2 className="px-1 text-xl font-semibold text-balance">{result.title}</h2>
          {songs.length === 0 ? (
            <p className="mt-2 px-1 text-sm text-muted">
              Nothing in the library fits that. Try asking another way.
            </p>
          ) : (
            <>
              <p className="mt-0.5 px-1 text-sm text-faint">{plural(songs.length, 'song')}</p>
              <div className="mt-4 grid grid-cols-4 gap-2 sm:max-w-md">
                <Action
                  icon={Play}
                  label="Play"
                  primary
                  onClick={() => void send({ action: 'playNow', songs })}
                />
                <Action
                  icon={Shuffle}
                  label="Shuffle"
                  onClick={() => void send({ action: 'playNow', songs: shuffled(songs) })}
                />
                <Action
                  icon={ListEnd}
                  label="Add to end"
                  onClick={() => void enqueue(songs, 'end')}
                />
                <Action
                  icon={ListMusic}
                  label="Save"
                  onClick={() =>
                    void create(
                      songs.map((s) => s.id),
                      result.title,
                    )
                  }
                />
              </div>
              <div className="mt-4">
                <SongList
                  songs={songs}
                  numbering="none"
                  showArt
                  notes={result.picks.map((p) => p.reason)}
                />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function Action({
  icon: Icon,
  label,
  onClick,
  primary,
}: {
  icon: typeof Play
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-xs font-medium ${
        primary ? 'bg-accent text-accent-ink hover:brightness-110' : 'bg-surface hover:bg-raised'
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden fill={primary ? 'currentColor' : 'none'} />
      {label}
    </button>
  )
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
