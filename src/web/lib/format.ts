/** 3:07, or 1:02:07 past an hour. */
export function clock(totalSeconds: number | undefined): string {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "47 min" or "2 hr 5 min", for album and queue totals. */
export function span(totalSeconds: number | undefined): string {
  const min = Math.round((totalSeconds ?? 0) / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} hr ${min % 60} min` : `${h} hr`
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
