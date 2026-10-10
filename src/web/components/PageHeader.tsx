import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { goBack } from '@/lib/router'

/**
 * Sticky header for pages: an optional back control, a title and actions.
 * Clear at rest so the cover tint runs to the top of the page; frosted once
 * content scrolls underneath it.
 */
export function PageHeader({
  back,
  title,
  actions,
}: {
  /** Where back goes when there is no history to return to. */
  back?: string
  title?: ReactNode
  actions?: ReactNode
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    // The sentinel sits right above the header; once it scrolls out of
    // view, the header is pinned over content.
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry!.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinel} className="h-px" aria-hidden />
      <header
        className={`sticky z-20 -mx-4 -mt-px flex h-12 items-center gap-1 px-2 transition-colors duration-200 ${
          stuck ? 'bg-bg/70 backdrop-blur-xl' : 'bg-transparent'
        }`}
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        {back && (
          <button
            onClick={() => goBack(back)}
            className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-raised hover:text-text"
            aria-label="Back"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>
        )}
        <h1 className={`min-w-0 flex-1 truncate font-semibold ${back ? '' : 'px-2 text-xl'}`}>
          {title}
        </h1>
        {actions}
      </header>
    </>
  )
}
