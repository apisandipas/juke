import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const show = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++
    // One at a time: a newer message replaces the last instead of stacking.
    setToasts([{ id, text, tone }])
    setTimeout(
      () => setToasts((ts) => ts.filter((t) => t.id !== id)),
      tone === 'error' ? 5000 : 2500,
    )
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
        style={{ bottom: 'calc(var(--chrome-bottom) + 0.75rem)' }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`toast-in max-w-md rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
              t.tone === 'error' ? 'bg-danger text-white' : 'bg-text text-bg'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
