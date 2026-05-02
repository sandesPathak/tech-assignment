'use client'

// Settings shell. Phase 5 (avatar-builder) will fill in the Profile
// section. We render the structure now so deep links exist + the user
// can toggle the coach panel without waiting on Phase 5.

import { useEffect, useState } from 'react'

interface Settings {
  coach: { enabled: boolean }
  preferences: { reduceMotion: boolean }
}

const STORAGE_KEY = 'hijack:settings'
const DEFAULTS: Settings = {
  coach: { enabled: true },
  preferences: { reduceMotion: false },
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) })
    } catch { /* ignore */ }
    setLoaded(true)
  }, [])

  function persist(next: Settings) {
    setSettings(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch { /* ignore */ }
  }

  if (!loaded) {
    return (
      <main className="min-h-screen p-6 max-w-2xl mx-auto">
        <p className="text-neutral-400">Loading…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Section title="Profile" description="Avatar + display name. Phase 5 will add the picker.">
        <div className="text-sm text-neutral-400 italic">
          Avatar selection coming soon (Phase 5).
        </div>
        <input
          type="text"
          placeholder="Display name (read-only stub)"
          disabled
          className="mt-2 block w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-500"
        />
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
