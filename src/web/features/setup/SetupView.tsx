import { useQuery } from '@tanstack/react-query'
import { Check, LoaderCircle, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { ConnectionCheck, SetupField, SetupFields, SetupRequest } from '@shared/types'
import { ErrorState, Loading } from '@/components/States'
import { Field, primaryButton, secondaryButton } from '@/features/setup/Field'
import { ApiError, session } from '@/lib/api'
import { useConfig } from '@/lib/config'

type Form = Required<SetupRequest>

/** First-run setup: point juke at a Navidrome and pick a juke password. */
export function SetupView() {
  const fields = useQuery({ queryKey: ['setup'], queryFn: session.setupFields, staleTime: 0 })
  return (
    <Screen
      title="Set up juke"
      intro="Point juke at your Navidrome server. These settings are saved on the machine juke runs on."
    >
      {fields.isPending ? (
        <Loading label="Loading settings" />
      ) : fields.isError ? (
        <ErrorState error={fields.error} retry={() => void fields.refetch()} />
      ) : (
        <SetupForm fields={fields.data.fields} minPassword={fields.data.minPassword} />
      )}
    </Screen>
  )
}

function SetupForm({ fields, minPassword }: { fields: SetupFields; minPassword: number }) {
  const { setConfig } = useConfig()
  const [form, setForm] = useState<Form>({
    code: '',
    navidromeUrl: fields.navidromeUrl.value,
    navidromeUser: fields.navidromeUser.value,
    navidromePassword: '',
    name: fields.name.value,
    jukePassword: '',
  })
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [checks, setChecks] = useState<ConnectionCheck[] | null>(null)
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)

  const locked = (field: SetupField) => fields[field].source === 'env'
  const set = (key: keyof Form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setChecks(null)
    setError(null)
  }
  const fieldError = (field: string) => (error?.field === field ? error.text : undefined)
  const envNote = (field: SetupField) => `Set by ${fields[field].env}`

  // Only send what the form may change; the server ignores the rest anyway.
  const payload = (): SetupRequest => {
    const out: SetupRequest = { code: form.code }
    for (const key of ['navidromeUrl', 'navidromeUser', 'navidromePassword', 'name'] as const) {
      if (!locked(key) && form[key]) out[key] = form[key]
    }
    if (!locked('jukePassword')) out.jukePassword = form.jukePassword
    return out
  }

  const fail = (err: unknown) => {
    if (err instanceof ApiError) {
      setError({
        text: err.message,
        field: typeof err.body.field === 'string' ? err.body.field : undefined,
      })
      if (Array.isArray(err.body.checks)) setChecks(err.body.checks as ConnectionCheck[])
    } else {
      setError({ text: err instanceof Error ? err.message : String(err) })
    }
  }

  const test = async () => {
    setBusy('test')
    setError(null)
    try {
      setChecks((await session.testSetup(payload())).checks)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      setConfig(await session.saveSetup(payload()))
    } catch (err) {
      fail(err)
      setBusy(null)
    }
  }

  const passwordHelp = (field: 'navidromePassword' | 'jukePassword', fallback: string) =>
    locked(field)
      ? envNote(field)
      : fields[field].source === 'saved'
        ? 'Leave blank to keep the saved password.'
        : fallback

  return (
    <form onSubmit={save} className="space-y-8" noValidate>
      <Section title="Setup code">
        <Field
          label="Code"
          value={form.code}
          onChange={set('code')}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          required
          help="juke prints this in its log when it starts, so only someone with access to the server can set it up."
          error={fieldError('code')}
        />
      </Section>

      <Section title="Navidrome">
        <Field
          label="Address"
          type="url"
          inputMode="url"
          value={form.navidromeUrl}
          onChange={set('navidromeUrl')}
          locked={locked('navidromeUrl')}
          placeholder="http://localhost:4533"
          autoCapitalize="none"
          spellCheck={false}
          help={
            locked('navidromeUrl')
              ? envNote('navidromeUrl')
              : 'As juke sees it from where it runs. In Docker, often http://navidrome:4533.'
          }
        />
        <Field
          label="Username"
          value={form.navidromeUser}
          onChange={set('navidromeUser')}
          locked={locked('navidromeUser')}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          help={
            locked('navidromeUser')
              ? envNote('navidromeUser')
              : 'Usually an admin: jukebox control is admin-only by default.'
          }
        />
        <Field
          label="Password"
          type="password"
          value={locked('navidromePassword') ? '' : form.navidromePassword}
          onChange={set('navidromePassword')}
          locked={locked('navidromePassword')}
          placeholder={locked('navidromePassword') ? '••••••••' : undefined}
          autoComplete="current-password"
          help={passwordHelp(
            'navidromePassword',
            'Stored on the juke server, readable only by juke.',
          )}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void test()}
            disabled={busy !== null}
            className={secondaryButton}
          >
            {busy === 'test' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            Test connection
          </button>
        </div>
        {checks && <Checks checks={checks} />}
      </Section>

      <Section title="juke">
        <Field
          label="Speaker name"
          value={form.name}
          onChange={set('name')}
          locked={locked('name')}
          maxLength={40}
          help={
            locked('name')
              ? envNote('name')
              : `What juke calls the speakers: “Playing on ${form.name.trim() || 'the jukebox'}”.`
          }
        />
        {locked('jukePassword') ? (
          <Field
            label="juke password"
            type="password"
            value=""
            placeholder="••••••••"
            locked
            help={envNote('jukePassword')}
          />
        ) : (
          <Field
            label="juke password"
            type="password"
            value={form.jukePassword}
            onChange={set('jukePassword')}
            autoComplete="new-password"
            minLength={minPassword}
            required
            help={`At least ${minPassword} characters. Each phone or browser asks for it once.`}
            error={fieldError('jukePassword')}
          />
        )}
      </Section>

      {error && !error.field && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy !== null}
        className={`${primaryButton} w-full sm:w-auto`}
      >
        {busy === 'save' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
        Save and start
      </button>
    </form>
  )
}

function Checks({ checks }: { checks: ConnectionCheck[] }) {
  return (
    <ul
      className="space-y-2 rounded-xl bg-surface p-4 text-sm"
      aria-label="Connection checks"
      aria-live="polite"
    >
      {checks.map((check) => (
        <li key={check.id} className="flex gap-2.5">
          {check.ok ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-label="Passed" />
          ) : (
            <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="Failed" />
          )}
          <span>
            <span className="block">{check.label}</span>
            {check.detail && <span className="mt-0.5 block text-muted">{check.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-4 text-xs font-semibold tracking-wide text-faint uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

/** Page frame for the screens shown before the app: setup and sign-in. */
export function Screen({
  title,
  intro,
  children,
}: {
  title: string
  intro?: string
  children: ReactNode
}) {
  return (
    <main
      className="mx-auto max-w-md px-4"
      style={{
        paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <h1 className="text-2xl font-semibold">{title}</h1>
      {intro && <p className="mt-2 mb-8 text-muted">{intro}</p>}
      {children}
    </main>
  )
}
