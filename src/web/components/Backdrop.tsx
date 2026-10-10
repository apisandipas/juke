import { useState } from 'react'
import { coverUrl } from '@/lib/api'

/**
 * The current cover, blurred far back behind every page, so the whole app
 * leans toward the colour of what's playing. Browsing pages get a heavier
 * scrim than the remote, since they carry dense lists of text.
 */
export function Backdrop({ coverId, dim }: { coverId: string | undefined; dim: boolean }) {
  // The outgoing cover stays underneath while the new one fades in over it.
  const [layers, setLayers] = useState<string[]>(coverId ? [coverId] : [])
  const [shown, setShown] = useState(coverId)
  if (coverId !== shown) {
    setShown(coverId)
    setLayers((prev) => (coverId ? [...prev.slice(-1), coverId] : []))
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-bg" aria-hidden>
      {layers.map((id) => (
        <img
          key={id}
          src={coverUrl(id, 128)}
          alt=""
          // Missing art just leaves the plain background.
          onError={(e) => (e.currentTarget.style.display = 'none')}
          className="backdrop-in absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-3xl saturate-150"
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/70 to-bg" />
      <div
        className={`absolute inset-0 bg-bg/35 transition-opacity duration-500 ${dim ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}
