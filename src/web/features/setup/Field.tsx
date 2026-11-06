import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

/** A labelled text input with help or error text under it. */
export function Field({
  label,
  help,
  error,
  locked,
  ...input
}: {
  label: string
  help?: ReactNode
  error?: string
  /** Set by the environment: shown, but not editable here. */
  locked?: boolean
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const describedBy = `${id}-note`
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        readOnly={locked}
        aria-invalid={error ? true : undefined}
        aria-describedby={help || error ? describedBy : undefined}
        className={`h-11 w-full rounded-xl px-3 text-base placeholder:text-faint focus:outline-none focus-visible:outline-2 ${
          locked
            ? 'cursor-not-allowed bg-transparent text-muted ring-1 ring-line'
            : 'bg-surface focus:bg-raised'
        } ${error ? 'ring-1 ring-danger' : ''}`}
        {...input}
      />
      {(error || help) && (
        <p id={describedBy} className={`mt-1.5 text-sm ${error ? 'text-danger' : 'text-faint'}`}>
          {error ?? help}
        </p>
      )}
    </div>
  )
}

export const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 font-medium text-accent-ink disabled:opacity-50'
export const secondaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-raised px-5 font-medium hover:bg-line disabled:opacity-50'
