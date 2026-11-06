import type { ConnectionCheck } from '@shared/types'
import { SubsonicError, type SubsonicClient } from '@server/subsonic'

/** Subsonic error code for a wrong username or password. */
const WRONG_CREDENTIALS = 40

/**
 * Can juke drive this Navidrome? Three checks in order, each only run when
 * the one before it passed, and each failure says what to change.
 */
export async function checkConnection(
  client: SubsonicClient,
  user: string,
): Promise<ConnectionCheck[]> {
  const checks: ConnectionCheck[] = []
  const fail = (id: ConnectionCheck['id'], label: string, detail: string) => {
    checks.push({ id, label, ok: false, detail })
    return checks
  }

  try {
    await client.call('ping')
    checks.push({ id: 'reach', label: 'Navidrome answers', ok: true })
    checks.push({ id: 'signIn', label: `Signed in as ${user}`, ok: true })
  } catch (err) {
    if (err instanceof SubsonicError && err.code === WRONG_CREDENTIALS) {
      checks.push({ id: 'reach', label: 'Navidrome answers', ok: true })
      return fail('signIn', `Sign in as ${user}`, 'Navidrome rejected the username or password.')
    }
    return fail(
      'reach',
      'Navidrome answers',
      `${message(err)}. Check the address, and that juke can reach it from where it runs.`,
    )
  }

  try {
    await client.call('jukeboxControl', { action: 'get' })
    checks.push({ id: 'jukebox', label: 'Jukebox mode is available', ok: true })
  } catch (err) {
    const admin = await isAdmin(client, user)
    const detail =
      admin === false
        ? `${user} isn't a Navidrome admin. Jukebox control is admin-only unless Navidrome runs with ND_JUKEBOX_ADMINONLY=false.`
        : `Navidrome said: ${message(err)}. Turn jukebox mode on with ND_JUKEBOX_ENABLED=true and restart Navidrome.`
    return fail('jukebox', 'Jukebox mode is available', detail)
  }
  return checks
}

async function isAdmin(client: SubsonicClient, user: string): Promise<boolean | undefined> {
  try {
    const payload = await client.call('getUser', { username: user })
    const role = (payload.user as { adminRole?: boolean } | undefined)?.adminRole
    return typeof role === 'boolean' ? role : undefined
  } catch {
    return undefined
  }
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.charAt(0).toUpperCase() + text.slice(1)
}
