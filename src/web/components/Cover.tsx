import { Disc3 } from 'lucide-react'
import { useState } from 'react'
import { coverUrl, type CoverSize } from '@/lib/api'

/** Square cover art with a quiet placeholder for missing or broken art. */
export function Cover({
  id,
  size,
  className = '',
  alt = '',
}: {
  id: string | undefined
  size: CoverSize
  className?: string
  alt?: string
}) {
  const src = coverUrl(id, size)
  const [failed, setFailed] = useState<string | undefined>()
  const broken = !src || failed === src

  return (
    <div className={`relative aspect-square overflow-hidden bg-raised ${className}`}>
      {broken ? (
        <div className="absolute inset-0 grid place-items-center text-faint">
          <Disc3 className="h-2/5 w-2/5" strokeWidth={1.25} aria-hidden />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}
