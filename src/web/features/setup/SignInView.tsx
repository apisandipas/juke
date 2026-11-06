import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Field, primaryButton } from '@/features/setup/Field'
import { Screen } from '@/features/setup/SetupView'
import { session } from '@/lib/api'
import { useConfig } from '@/lib/config'

/** Asked once per device when juke has a password. */
export function SignInView() {
  const { setConfig } = useConfig()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      setConfig(await session.signIn(password))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Screen title="Sign in to juke" intro="This device needs the juke password once.">
      <form onSubmit={submit} className="space-y-6">
        {/* A hidden username lets password managers file this under juke. */}
        <input type="text" name="username" value="juke" autoComplete="username" readOnly hidden />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(undefined)
          }}
          autoComplete="current-password"
          autoFocus
          required
          error={error}
        />
        <button type="submit" disabled={busy || !password} className={`${primaryButton} w-full`}>
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          Sign in
        </button>
      </form>
    </Screen>
  )
}
