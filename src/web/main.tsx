import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { SheetProvider } from '@/components/ActionSheet'
import { DialogProvider } from '@/components/Dialog'
import { ErrorState, Loading } from '@/components/States'
import { SetupView } from '@/features/setup/SetupView'
import { SignInView } from '@/features/setup/SignInView'
import { ConfigProvider, useConfig } from '@/lib/config'
import { JukeboxProvider } from '@/lib/jukebox'
import { ToastProvider } from '@/lib/toast'
import '@/styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // The library changes only when Navidrome rescans; don't refetch on every focus.
    queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
})

/** Setup, then sign-in, then the remote. The jukebox connects only once both are done. */
function Gate({ children }: { children: ReactNode }) {
  const { config } = useConfig()
  if (config.needsSetup) return <SetupView />
  if (config.auth.enabled && !config.auth.signedIn) return <SignInView />
  return children
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfigProvider
          loading={<Loading label="Connecting to juke" />}
          failed={(error, retry) => <ErrorState error={error} retry={retry} />}
        >
          <Gate>
            <JukeboxProvider>
              <DialogProvider>
                <SheetProvider>
                  <App />
                </SheetProvider>
              </DialogProvider>
            </JukeboxProvider>
          </Gate>
        </ConfigProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
