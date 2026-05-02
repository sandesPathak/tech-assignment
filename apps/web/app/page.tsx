'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'

export default function LandingPage() {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const autoTriedRef = useRef(false)

  async function doSignIn(name: string) {
    setLoading(true)
    setError(null)
    try {
      await api('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ username: name }),
      })
      router.push('/lobby')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Auto-sign-in when embedded by streaks `/play` (passes ?username=…).
  // Runs once; user can still edit and resubmit if it fails.
  useEffect(() => {
    if (autoTriedRef.current) return
    const hint = searchParams?.get('username')?.trim()
    if (hint) {
      autoTriedRef.current = true
      setUsername(hint)
      doSignIn(hint)
    }
  }, [searchParams])

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim()) return
    await doSignIn(username.trim())
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-4xl font-bold mb-2">Hijack Poker</h1>
        <p className="text-neutral-400 mb-8">Live multiplayer Hold&apos;em.</p>
        <form onSubmit={signIn} className="space-y-4">
          <label className="block">
            <span className="text-sm text-neutral-300">Display name</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-white"
              placeholder="hero"
              required
            />
          </label>
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="w-full rounded-md bg-chip text-black font-semibold py-2 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Continue'}
          </button>
          {error && (
            <p className="text-sm text-red-400" role="alert">{error}</p>
          )}
        </form>
        <div className="mt-8 text-xs text-neutral-500">
          Demo build — no password, just pick a name. Phase 5 will add real auth + avatars.
        </div>
      </div>
    </main>
  )
}
