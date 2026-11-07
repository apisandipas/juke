import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SetupField, SetupFields, SettingSource } from '@shared/types'

/**
 * juke's settings, from two places: environment variables (set by the
 * compose file, the NixOS module or a .env) and a settings file the setup
 * form writes. The environment always wins, so editing the compose file or
 * the Nix module always takes effect; the file only fills the gaps.
 */

export interface Settings {
  navidromeUrl: string
  navidromeUser: string
  navidromePassword: string
  /** What the UI calls the speakers, e.g. "Living room". */
  name: string
}

/** What the setup form writes. Secrets stay in this file only, mode 0600. */
interface SavedFile {
  navidromeUrl?: string
  navidromeUser?: string
  navidromePassword?: string
  name?: string
  /** scrypt hash of the juke password; see auth.ts. */
  passwordHash?: string
  /** Signs session cookies, so sign-ins survive a restart. */
  sessionSecret?: string
}

export const DEFAULTS = {
  navidromeUrl: 'http://localhost:4533',
  name: 'the jukebox',
} as const

/** The environment variable behind each field, as the form names it. */
export const ENV_NAMES: Record<SetupField, string> = {
  navidromeUrl: 'NAVIDROME_URL',
  navidromeUser: 'NAVIDROME_USER',
  navidromePassword: 'NAVIDROME_PASSWORD',
  name: 'JUKE_NAME',
  jukePassword: 'JUKE_PASSWORD',
}

type Env = Record<string, string | undefined>

/** A value, or the contents of the file named by NAME_FILE, trimmed. */
function fromEnv(env: Env, name: string): string | undefined {
  const file = env[`${name}_FILE`]
  if (file) return readFileSync(file, 'utf8').trim() || undefined
  return env[name]?.trim() || undefined
}

export class ConfigStore {
  readonly path: string
  private readonly env: Partial<Record<SetupField, string>>
  private saved: SavedFile
  private memorySecret: string | undefined

  constructor(env: Env, dataDir: string) {
    this.path = join(dataDir, 'settings.json')
    this.env = {
      navidromeUrl: fromEnv(env, 'NAVIDROME_URL'),
      navidromeUser: fromEnv(env, 'NAVIDROME_USER'),
      navidromePassword: fromEnv(env, 'NAVIDROME_PASSWORD'),
      name: fromEnv(env, 'JUKE_NAME'),
      jukePassword: fromEnv(env, 'JUKE_PASSWORD'),
    }
    this.saved = this.read()
  }

  private read(): SavedFile {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as SavedFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new Error(`juke: can't read ${this.path}: ${(err as Error).message}`, { cause: err })
    }
  }

  private write(next: SavedFile): void {
    mkdirSync(join(this.path, '..'), { recursive: true, mode: 0o700 })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, this.path)
    this.saved = next
  }

  /** True when the environment sets this field, so the form must leave it alone. */
  fromEnv(field: SetupField): boolean {
    return this.env[field] !== undefined
  }

  /** Settings with environment over saved over defaults; null until the required ones exist. */
  settings(): Settings | null {
    const url = this.env.navidromeUrl ?? this.saved.navidromeUrl ?? DEFAULTS.navidromeUrl
    const user = this.env.navidromeUser ?? this.saved.navidromeUser
    const password = this.env.navidromePassword ?? this.saved.navidromePassword
    const name = this.env.name ?? this.saved.name ?? DEFAULTS.name
    if (!user || !password) return null
    return { navidromeUrl: url, navidromeUser: user, navidromePassword: password, name }
  }

  /** The Navidrome password juke already has, if any, so the form can leave it blank. */
  navidromePassword(): string | undefined {
    return this.env.navidromePassword ?? this.saved.navidromePassword
  }

  /** Just the speaker name, which the UI needs before setup is done. */
  name(): string {
    return this.env.name ?? this.saved.name ?? DEFAULTS.name
  }

  /**
   * How the juke password is checked: the plain value from the
   * environment, a saved hash, or not at all (no password, no sign-in).
   */
  jukePassword(): { kind: 'env'; value: string } | { kind: 'hash'; value: string } | null {
    if (this.env.jukePassword) return { kind: 'env', value: this.env.jukePassword }
    if (this.saved.passwordHash) return { kind: 'hash', value: this.saved.passwordHash }
    return null
  }

  /** What the setup form shows: each field's value and where it came from. Never a secret. */
  fields(): SetupFields {
    const source = (field: SetupField, saved: unknown, fallback?: string): SettingSource =>
      this.fromEnv(field)
        ? 'env'
        : saved !== undefined
          ? 'saved'
          : fallback !== undefined
            ? 'default'
            : 'missing'
    const plain = (field: 'navidromeUrl' | 'navidromeUser' | 'name', fallback?: string) => ({
      value: this.env[field] ?? this.saved[field] ?? fallback ?? '',
      source: source(field, this.saved[field], fallback),
      env: ENV_NAMES[field],
    })
    const secret = (field: 'navidromePassword' | 'jukePassword', saved: unknown) => ({
      value: '',
      source: source(field, saved),
      env: ENV_NAMES[field],
    })
    return {
      navidromeUrl: plain('navidromeUrl', DEFAULTS.navidromeUrl),
      navidromeUser: plain('navidromeUser'),
      navidromePassword: secret('navidromePassword', this.saved.navidromePassword),
      name: plain('name', DEFAULTS.name),
      jukePassword: secret('jukePassword', this.saved.passwordHash),
    }
  }

  /** Writes the form's values, skipping any field the environment sets. */
  save(values: Partial<Settings> & { passwordHash?: string }): void {
    const next: SavedFile = { ...this.saved }
    for (const field of ['navidromeUrl', 'navidromeUser', 'navidromePassword', 'name'] as const) {
      const value = values[field]
      if (value !== undefined && !this.fromEnv(field)) next[field] = value
    }
    if (values.passwordHash && !this.fromEnv('jukePassword'))
      next.passwordHash = values.passwordHash
    next.sessionSecret ??= this.memorySecret ?? randomBytes(32).toString('base64url')
    this.write(next)
  }

  /**
   * The key that signs session cookies. Kept in the settings file so a
   * restart doesn't sign everyone out; if the data folder isn't writable,
   * it lives in memory and a restart asks devices to sign in again.
   */
  sessionSecret(): string {
    if (this.saved.sessionSecret) return this.saved.sessionSecret
    if (this.memorySecret) return this.memorySecret
    const secret = randomBytes(32).toString('base64url')
    this.memorySecret = secret
    try {
      this.write({ ...this.saved, sessionSecret: secret })
    } catch (err) {
      console.warn(
        `juke: can't save to ${this.path} (${(err as Error).message}); sign-ins last until restart`,
      )
    }
    return secret
  }
}
