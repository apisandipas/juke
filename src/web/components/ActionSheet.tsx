import type { LucideIcon } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Cover } from '@/components/Cover'

export interface SheetAction {
  label: string
  icon: LucideIcon
  onSelect: () => void
  hint?: string
}

export interface SheetContent {
  title: string
  subtitle?: string
  coverId?: string
  actions: SheetAction[]
}

const SheetContext = createContext<(content: SheetContent) => void>(() => {})

export function useSheet() {
  return useContext(SheetContext)
}

/**
 * One action sheet for the whole app: slides up from the bottom on a phone,
 * sits centred on a wide screen.
 */
export function SheetProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<SheetContent | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  const open = useCallback((next: SheetContent) => {
    opener.current = document.activeElement as HTMLElement | null
    setContent(next)
  }, [])

  const close = useCallback(() => {
    setContent(null)
    opener.current?.focus()
  }, [])

  useEffect(() => {
    if (!content) return
    panel.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [content, close])

  return (
    <SheetContext.Provider value={open}>
      {children}
      {content && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60" onClick={close} aria-hidden />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={content.title}
            className="sheet-in relative w-full max-w-md rounded-t-2xl bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-3"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              {content.coverId !== undefined && (
                <Cover id={content.coverId} size={128} className="h-12 w-12 shrink-0 rounded" />
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{content.title}</p>
                {content.subtitle && (
                  <p className="truncate text-sm text-muted">{content.subtitle}</p>
                )}
              </div>
            </div>
            <ul className="py-1">
              {content.actions.map(({ label, icon: Icon, onSelect, hint }) => (
                <li key={label}>
                  <button
                    onClick={() => {
                      close()
                      onSelect()
                    }}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-raised focus-visible:bg-raised"
                  >
                    <Icon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {hint && <span className="text-sm text-faint">{hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-4 pt-1">
              <button
                onClick={close}
                className="w-full rounded-xl bg-raised py-3 font-medium hover:bg-line"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </SheetContext.Provider>
  )
}
