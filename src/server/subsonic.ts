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

export interface CallOptions {
  /**
   * Send the parameters as a form body instead of in the URL. For writes that
   * carry many song ids, which can overflow a reverse proxy's URL limit.
   * Navidrome accepts this (OpenSubsonic formPost).
   */
  post?: boolean
  /** Extra request headers, such as Range for streams. */
  headers?: Record<string, string>
  /**
   * For long bodies such as audio: the timeout covers only the wait for
   * headers, not reading the body, and `signal` (the listener going away)
   * stops the transfer.
   */
  stream?: boolean
  signal?: AbortSignal
}

/** Calls one Subsonic endpoint and returns the payload inside `subsonic-response`. */
export type SubsonicCall = (
  endpoint: string,
  params?: Params,
  options?: CallOptions,
) => Promise<Record<string, unknown>>

export interface SubsonicClient {
  call: SubsonicCall
  /** Raw fetch for binary endpoints such as getCoverArt and stream. */
  fetch: (endpoint: string, params?: Params, options?: CallOptions) => Promise<Response>
}

export function createSubsonicClient(opts: {
  baseUrl: string
  user: string
  password: string
  timeoutMs?: number
}): SubsonicClient {
  const timeoutMs = opts.timeoutMs ?? 10_000

  function append(target: URLSearchParams, params: Params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      for (const v of Array.isArray(value) ? value : [value]) target.append(key, String(v))
    }
  }

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
    append(u.searchParams, params)
    return u
  }

  async function rawFetch(
    endpoint: string,
    params?: Params,
    options: CallOptions = {},
  ): Promise<Response> {
    // The timeout covers the whole call, except that a stream stops it once
    // headers arrive (see CallOptions.stream).
    const timer = new AbortController()
    const timeout = setTimeout(
      () => timer.abort(new DOMException('timed out', 'TimeoutError')),
      timeoutMs,
    )
    timeout.unref()
    const signal = options.signal ? AbortSignal.any([timer.signal, options.signal]) : timer.signal
    try {
      if (options.post) {
        const body = new URLSearchParams()
        append(body, params ?? {})
        return await fetch(url(endpoint), {
          method: 'POST',
          body,
          signal,
          headers: options.headers,
        })
      }
      return await fetch(url(endpoint, params), { signal, headers: options.headers })
    } catch (err) {
      if (options.signal?.aborted) throw err
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
    } finally {
      if (options.stream) clearTimeout(timeout)
    }
  }

  const call: SubsonicCall = async (endpoint, params, options) => {
    const res = await rawFetch(endpoint, params, options)
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
