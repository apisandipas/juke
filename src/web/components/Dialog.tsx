import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface PromptOptions {
  title: string
  label: string
  initial?: string
  confirm: string
  maxLength?: number
}

interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirm: string
  danger?: boolean
}

interface DialogApi {
  /** Ask for one line of text. Resolves to the trimmed text, or null if cancelled. */
  prompt: (options: PromptOptions) => Promise<string | null>
  /** Ask yes or no. Resolves true only when confirmed. */
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

type Open =
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions)
  | ({ kind: 'confirm'; resolve: (value: boolean) => void } & ConfirmOptions)

const DialogContext = createContext<DialogApi | null>(null)

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog outside DialogProvider')
  return ctx
}

/** One small modal for the whole app, for a name to type or a yes/no question. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  const show = useCallback((next: Open) => {
    opener.current = document.activeElement as HTMLElement | null
    setOpen(next)
  }, [])

  const api = useMemo<DialogApi>(
    () => ({
      prompt: (options) => new Promise((resolve) => show({ kind: 'prompt', resolve, ...options })),
      confirm: (options) =>
        new Promise((resolve) => show({ kind: 'confirm', resolve, ...options })),
    }),
    [show],
  )

  const finish = (value: string | null | boolean) => {
    if (!open) return
    if (open.kind === 'prompt') open.resolve(typeof value === 'string' ? value : null)
    else open.resolve(value === true)
    setOpen(null)
    opener.current?.focus()
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {open && <Modal key={open.title} open={open} finish={finish} />}
    </DialogContext.Provider>
  )
}

function Modal({ open, finish }: { open: Open; finish: (value: string | boolean | null) => void }) {
  const [text, setText] = useState(open.kind === 'prompt' ? (open.initial ?? '') : '')
  const panel = useRef<HTMLFormElement>(null)
  const cancel = open.kind === 'prompt' ? null : false
  // The latest finish, for the Escape handler, which is set up once on mount
  // so typing doesn't re-run it (and re-select the text).
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  })

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>('input, button[type=submit]')
    first?.focus()
    if (first instanceof HTMLInputElement) first.select()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishRef.current(cancel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel])

  const trimmed = text.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => finish(cancel)} aria-hidden />
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={(e) => {
          e.preventDefault()
          if (open.kind === 'prompt') {
            if (trimmed) finish(trimmed)
          } else finish(true)
        }}
        className="sheet-in relative w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl"
      >
        <h2 id="dialog-title" className="text-lg font-semibold">
          {open.title}
        </h2>
        {open.kind === 'prompt' ? (
          <label className="mt-4 block">
            <span className="text-sm text-muted">{open.label}</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={open.maxLength}
              autoComplete="off"
              enterKeyHint="done"
              className="mt-1 w-full rounded-lg bg-raised px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        ) : (
          open.body && <div className="mt-2 text-sm text-muted">{open.body}</div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => finish(cancel)}
            className="rounded-xl bg-raised py-2.5 font-medium hover:bg-line"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={open.kind === 'prompt' && !trimmed}
            className={`rounded-xl py-2.5 font-medium disabled:opacity-40 ${
              open.kind === 'confirm' && open.danger
                ? 'bg-danger text-white'
                : 'bg-accent text-accent-ink hover:brightness-110'
            }`}
          >
            {open.confirm}
          </button>
        </div>
      </form>
    </div>
  )
}
