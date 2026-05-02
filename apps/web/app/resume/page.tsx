'use client'

// /resume — phone-side landing for the handoff flow.
//
// Per PHASE-06-handoff.md follow-ups:
//   1. Extract `?token=` and `?table=` from the URL.
//   2. POST to `${gateway}/handoff/redeem` to swap it for a JWT.
//   3. Open `${gateway}/table/:id?token=<jwt>` over WS.
//   4. Optional: send `c2s.handoff_redeem` for observability.
//   5. Then `c2s.join`.
// On success, redirect to /table/[id].

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { PUBLIC } from '@/lib/env'
import { createTableSocket } from '@/lib/game-socket'

interface RedeemResponse {
  jwt: string
  userId: string
  tableId: string
  seat: number | null
  sessionId: string
}

export default function ResumePage() {
  return (
    <Suspense fallback={<ResumeFallback />}>
      <ResumeInner />
    </Suspense>
  )
}

function ResumeFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <p className="text-neutral-300">Loading…</p>
    </main>
  )
}

function ResumeInner() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params?.get('token') || ''
  const tableHint = params?.get('table') || ''

  const [stage, setStage] = useState<'redeeming' | 'connecting' | 'done' | 'error'>(
    'redeeming'
  )
  const [error, setError] = useState<string | null>(null)
  const [showInstall, setShowInstall] = useState(false)

  // Listen for the install prompt (PWA hint per the phase doc).
  useEffect(() => {
    function onPrompt(e: Event) {
      e.preventDefault()
      ;(window as unknown as { _deferredPrompt: Event })._deferredPrompt = e
      setShowInstall(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    if (!token) {
      setStage('error')
      setError('Missing handoff token in URL')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const redeem = await api<RedeemResponse>(
          `${PUBLIC.gatewayHttp}/handoff/redeem`,
          {
            method: 'POST',
            body: JSON.stringify({ token }),
          }
        )
        if (cancelled) return
        setStage('connecting')
        const socket = createTableSocket({
          baseWsUrl: PUBLIC.gatewayWs,
          tableId: redeem.tableId,
          jwt: redeem.jwt,
        })
        await socket.connect()
        socket.send({
          t: 'c2s.handoff_redeem',
          tableId: redeem.tableId,
          sessionId: redeem.sessionId,
        })
        socket.send({
          t: 'c2s.join',
          tableId: redeem.tableId,
          seat: redeem.seat ?? undefined,
        })
        // Disconnect this transient socket; the table page will open
        // its own. Browser keeps the cookie session alive so the page
        // can mint a fresh JWT immediately.
        socket.disconnect()
        if (!cancelled) {
          setStage('done')
          router.replace(`/table/${encodeURIComponent(redeem.tableId)}`)
        }
      } catch (err) {
        if (cancelled) return
        setStage('error')
        setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, tableHint, router])

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl font-semibold mb-4">Resuming seat</h1>
        {stage === 'redeeming' && (
          <p className="text-neutral-300">Redeeming handoff token…</p>
        )}
        {stage === 'connecting' && (
          <p className="text-neutral-300">Connecting to table…</p>
        )}
        {stage === 'done' && (
          <p className="text-emerald-300">Connected. Redirecting…</p>
        )}
        {stage === 'error' && (
          <p className="text-red-400" role="alert">
            {error || 'Could not resume seat.'}
          </p>
        )}
        {showInstall && (
          <p className="mt-6 text-xs text-neutral-400">
            Tip: add to home screen for the best mid-hand UX.
          </p>
        )}
      </div>
    </main>
  )
}
