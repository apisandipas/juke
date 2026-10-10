import { createHash, randomBytes } from 'node:crypto'

export class SubsonicError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
    this.name = 'SubsonicError'
  }
}

export type Params = Record<string, string | number | boolean | (string | number)[] | undefined>

/** Calls one Subsonic endpoint and returns the payload inside `subsonic-response`. */
export type SubsonicCall = (endpoint: string, params?: Params) => Promise<Record<string, unknown>>

export interface SubsonicClient {
  call: SubsonicCall
  /** Raw fetch for binary endpoints such as getCoverArt. */
  fetch: (endpoint: string, params?: Params) => Promise<Response>
}

export function createSubsonicClient(opts: {
  baseUrl: string
  user: string
  password: string
  timeoutMs?: number
}): SubsonicClient {
  const timeoutMs = opts.timeoutMs ?? 10_000

  function url(endpoint: string, params: Params = {}): URL {
    const u = new URL(`/rest/${endpoint}`, opts.baseUrl)
    // Token auth: md5(password + salt) with a fresh salt per request, so the
    // password itself never goes over the wire.
    const salt = randomBytes(8).toString('hex')
    u.searchParams.set('u', opts.user)
    u.searchParams.set(
      't',
      createHash('md5')
        .update(opts.password + salt)
        .digest('hex'),
    )
    u.searchParams.set('s', salt)
    u.searchParams.set('v', '1.16.1')
    u.searchParams.set('c', 'juke')
    u.searchParams.set('f', 'json')
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      for (const v of Array.isArray(value) ? value : [value]) u.searchParams.append(key, String(v))
    }
    return u
  }

  async function rawFetch(endpoint: string, params?: Params): Promise<Response> {
    try {
      return await fetch(url(endpoint, params), { signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      // undici reports every network failure as "fetch failed"; the useful
      // part (ECONNREFUSED, ENOTFOUND, a timeout) is in the cause.
      // Dual-stack connects wrap per-address failures in an AggregateError.
      type Cause = { code?: string; errors?: { code?: string }[] }
      const c = (err as { cause?: Cause }).cause
      const cause = c?.code ?? c?.errors?.[0]?.code
      const why =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'timed out'
          : (cause ?? 'network error')
      throw new SubsonicError(`no answer from ${new URL(opts.baseUrl).host} (${why})`, 0)
    }
  }

  async function call(endpoint: string, params?: Params): Promise<Record<string, unknown>> {
    const res = await rawFetch(endpoint, params)
    if (!res.ok) throw new SubsonicError(`Navidrome returned HTTP ${res.status}`, 0)
    const body = (await res.json()) as { 'subsonic-response'?: Record<string, unknown> }
    const payload = body['subsonic-response']
    if (!payload) throw new SubsonicError('Malformed Subsonic response', 0)
    if (payload.status !== 'ok') {
      const err = payload.error as { code?: number; message?: string } | undefined
      throw new SubsonicError(err?.message ?? 'Subsonic request failed', err?.code ?? 0)
    }
    return payload
  }

  return { call, fetch: rawFetch }
}
