import { useCallback, useState } from 'react'

export type ViewMode = 'grid' | 'list'

const key = (name: string) => `juke:view:${name}`

function read(name: string, fallback: ViewMode): ViewMode {
  try {
    const value = window.localStorage.getItem(key(name))
    return value === 'grid' || value === 'list' ? value : fallback
  } catch {
    // Private windows and blocked storage: just use the default.
    return fallback
  }
}

/**
 * Grid or list for one part of the app, remembered on this device. A
 * convenience only: if storage is unavailable, the choice lasts until reload.
 */
export function useViewMode(
  name: string,
  fallback: ViewMode,
): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState(() => read(name, fallback))
  const set = useCallback(
    (next: ViewMode) => {
      setMode(next)
      try {
        window.localStorage.setItem(key(name), next)
      } catch {
        // Not saved; the choice still applies until reload.
      }
    },
    [name],
  )
  return [mode, set]
}
