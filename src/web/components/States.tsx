import { LoaderCircle, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      {label}…
    </div>
  )
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" role="alert">
      <p className="font-medium">Couldn’t load this</p>
      <p className="max-w-sm text-sm text-muted">
        {error instanceof Error ? error.message : String(error)}
      </p>
      {retry && (
        <button
          onClick={retry}
          className="mt-1 inline-flex items-center gap-2 rounded-full bg-raised px-4 py-2 text-sm font-medium hover:bg-line"
        >
          <RotateCw className="h-4 w-4" aria-hidden /> Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  )
}
