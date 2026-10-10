import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches, kept in step as the window resizes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/** Tailwind's lg breakpoint, where the queue sits beside the remote. */
export const WIDE = '(min-width: 1024px)'
