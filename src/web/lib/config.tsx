import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { JukeConfig } from '@shared/types'
import { GATE_EVENT, session } from '@/lib/api'

interface ConfigContextValue {
  config: JukeConfig
  /** Swap in a config the server just returned, e.g. after signing in. */
  setConfig: (config: JukeConfig) => void
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig outside ConfigProvider')
  return ctx
}

/** The speaker name for the middle of a sentence: "Playing on the jukebox". */
export function useSpeaker(): string {
  return useConfig().config.name
}

/** The same name at the start of a sentence or on its own: "The jukebox". */
export function capitalized(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Loads /api/config before anything else renders, and loads it again when
 * any request says setup or sign-in is needed. `children` gets the config
 * and decides what to show.
 */
export function ConfigProvider({
  loading,
  failed,
  children,
}: {
  loading: ReactNode
  failed: (error: unknown, retry: () => void) => ReactNode
  children: ReactNode
}) {
  const [config, setConfig] = useState<JukeConfig | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(() => {
    session.config().then((next) => {
      setError(null)
      setConfig(next)
    }, setError)
  }, [])

  useEffect(() => {
    load()
    window.addEventListener(GATE_EVENT, load)
    return () => window.removeEventListener(GATE_EVENT, load)
  }, [load])

  const retry = () => {
    setError(null)
    load()
  }

  if (!config) return error ? failed(error, retry) : loading
  return <ConfigContext.Provider value={{ config, setConfig }}>{children}</ConfigContext.Provider>
}
