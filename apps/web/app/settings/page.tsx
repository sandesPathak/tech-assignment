'use client'

// Settings — Profile (avatar + display name), Preferences, Account.
//
// Phase 5 fills in the Profile section. The avatar grid pulls from the
// bundled set in `public/avatars/`; the display name field hits
// `/api/profile` PATCH which validates + writes + publishes.

import { useEffect, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { avatarIds } from '@/lib/profile/avatars'
import { PROFILE_LIMITS } from '@/lib/profile/validation'

interface Settings {
  coach: { enabled: boolean }
  preferences: { reduceMotion: boolean }
}

interface ProfileShape {
  userId: string
  displayName: string
  avatarId: string
  displayNameChangedAt: string | null
}

const STORAGE_KEY = 'hijack:settings'
const DEFAULTS: Settings = {
  coach: { enabled: true },
  preferences: { reduceMotion: false },
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [profile, setProfile] = useState<ProfileShape | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftAvatar, setDraftAvatar] = useState('1')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) })
    } catch { /* ignore */ }
    setLoaded(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/profile', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data?.profile) return
        const p = data.profile as ProfileShape
        setProfile(p)
        setDraftName(p.displayName)
        setDraftAvatar(p.avatarId || '1')
      } catch { /* ignore */ }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function persist(next: Settings) {
    setSettings(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch { /* ignore */ }
  }

  async function saveProfile() {
    setSaving(true)
    setSaveError(null)
    setSaveOk(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: draftName, avatarId: draftAvatar }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(data?.message || data?.error || 'Save failed.')
        return
      }
      setProfile(data.profile)
      setDraftName(data.profile.displayName)
      setDraftAvatar(data.profile.avatarId)
      setSaveOk('Profile updated.')
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return (
      <main className="min-h-screen p-6 max-w-2xl mx-auto">
        <p className="text-neutral-400">Loading…</p>
      </main>
    )
  }

  const dirty =
    profile != null &&
    (draftName.trim() !== profile.displayName || draftAvatar !== profile.avatarId)

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Section title="Profile" description="Pick an avatar and a display name. You can change your name once every 7 days.">
        <div className="flex items-center gap-3">
          <Avatar avatarId={draftAvatar} size={64} alt="Selected avatar" />
          <div className="flex-1">
            <label htmlFor="display-name" className="block text-xs text-neutral-400 mb-1">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              minLength={PROFILE_LIMITS.NAME_MIN}
              maxLength={PROFILE_LIMITS.NAME_MAX}
              placeholder="3-16 chars, letters/numbers/_"
              className="block w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100"
              aria-describedby="display-name-help"
            />
            <p id="display-name-help" className="text-[11px] text-neutral-500 mt-1">
              {PROFILE_LIMITS.NAME_MIN}–{PROFILE_LIMITS.NAME_MAX} characters. Letters, numbers, underscores.
            </p>
          </div>
        </div>

        <fieldset className="mt-3">
          <legend className="text-xs text-neutral-400 mb-2">Avatar</legend>
          <ul
            role="radiogroup"
            aria-label="Avatar"
            className="grid grid-cols-6 gap-2"
          >
            {avatarIds().map((id) => {
              const selected = draftAvatar === id
              return (
                <li key={id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDraftAvatar(id)}
                    className={[
                      'rounded-md p-1 transition-colors',
                      selected
                        ? 'ring-2 ring-chip bg-neutral-800'
                        : 'ring-1 ring-neutral-800 hover:bg-neutral-900',
                    ].join(' ')}
                  >
                    <Avatar avatarId={id} size={48} alt={`Avatar ${id}`} />
                  </button>
                </li>
              )
            })}
          </ul>
        </fieldset>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={saveProfile}
            disabled={!dirty || saving || draftName.trim().length < PROFILE_LIMITS.NAME_MIN}
            className="rounded bg-chip text-black font-semibold px-4 py-1.5 text-sm disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          {saveOk && <span className="text-xs text-emerald-400" role="status">{saveOk}</span>}
          {saveError && <span className="text-xs text-red-400" role="alert">{saveError}</span>}
        </div>
      </Section>

      <Section title="Preferences" description="Tune the table UX.">
        <Toggle
          label="Show coach panel after each hand"
          description="Disable to hide the post-hand AI coach analysis."
          checked={settings.coach.enabled}
          onChange={(v) =>
            persist({ ...settings, coach: { ...settings.coach, enabled: v } })
          }
        />
        <Toggle
          label="Reduce motion"
          description="Skip table animations and flips."
          checked={settings.preferences.reduceMotion}
          onChange={(v) =>
            persist({
              ...settings,
              preferences: { ...settings.preferences, reduceMotion: v },
            })
          }
        />
      </Section>

      <Section title="Account" description="Sign out of this browser.">
        <button
          type="button"
          className="rounded bg-red-700/40 text-red-100 px-3 py-1.5 text-sm"
          onClick={async () => {
            await fetch('/api/auth', { method: 'DELETE' })
            window.location.href = '/'
          }}
        >
          Sign out
        </button>
      </Section>
    </main>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-neutral-800 p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && (
        <p className="text-xs text-neutral-500 mb-3">{description}</p>
      )}
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm">{label}</span>
        {description && (
          <span className="block text-xs text-neutral-500">{description}</span>
        )}
      </span>
    </label>
  )
}
