import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { SheetProvider } from '@/components/ActionSheet'
import { JukeboxProvider } from '@/lib/jukebox'
import { ToastProvider } from '@/lib/toast'
import '@/styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // The library changes only when Navidrome rescans; don't refetch on every focus.
    queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <JukeboxProvider>
          <SheetProvider>
            <App />
          </SheetProvider>
        </JukeboxProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
