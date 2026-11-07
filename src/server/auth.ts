import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

/**
 * juke's own sign-in. One shared password per install (there are no user
 * accounts), and a signed cookie per device so each device signs in once.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT)
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$')
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, N, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  })
  return timingSafeEqual(actual, expected)
}

/** Compares two strings without leaking how much of them matched. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(a), digest(b))
}

export const SESSION_COOKIE = 'juke_session'
/** Browsers cap cookie lifetimes at 400 days; stay under it. */
export const SESSION_DAYS = 180

/**
 * Session tokens are `expiry.signature`. The signature covers a
 * fingerprint of the current password, so changing the password signs
 * every device out without keeping a session list.
 */
export function createSession(secret: string, passwordFingerprint: string, now = Date.now()) {
  const expires = now + SESSION_DAYS * 86_400_000
  return `${expires}.${sign(secret, `${expires}.${passwordFingerprint}`)}`
}

export function verifySession(
  token: string | undefined,
  secret: string,
  passwordFingerprint: string,
  now = Date.now(),
): boolean {
  if (!token) return false
  const [expires, signature] = token.split('.')
  if (!expires || !signature || !(Number(expires) > now)) return false
  return safeEqual(signature, sign(secret, `${expires}.${passwordFingerprint}`))
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** A short, non-secret stand-in for the password, for session signatures. */
export function fingerprint(password: { kind: string; value: string }): string {
  return createHash('sha256').update(`${password.kind}:${password.value}`).digest('base64url')
}

/** Eight characters from an alphabet without look-alikes, e.g. "K7QM-2XPD". */
export function createSetupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const chars = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

/** Setup codes are typed by hand: ignore case, spaces and the dash. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Slows down password and setup-code guessing: after `limit` failures
 * from one address within `windowMs`, that address waits out the window.
 */
export class Throttle {
  private failures = new Map<string, number[]>()

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff)
    if (list.length) this.failures.set(key, list)
    else this.failures.delete(key)
    return list
  }

  blocked(key: string): boolean {
    return this.recent(key).length >= this.limit
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()])
  }

  clear(key: string): void {
    this.failures.delete(key)
  }
}
