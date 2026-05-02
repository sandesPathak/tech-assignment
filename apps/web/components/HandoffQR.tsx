'use client'

// Handoff QR card. Per docs/plan/PHASE-06-handoff.md follow-ups:
//   - On mount calls POST /handoff/issue with the user's bearer JWT.
//   - Refreshes every ~50s (token TTL is 60s).
//   - Renders a QR encoding `${origin}/resume?token=<token>&table=<id>`.
//   - The page hosting this component already wires up the WS;
//     when the gateway sends `s2c.kicked` reason 'handoff' the store
//     transitions to spectator status, which the parent uses to flip
//     the connection badge.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { PUBLIC } from '@/lib/env'

interface HandoffQRProps {
  tableId: string
  seat: number
  bearer: string
}

interface IssueResponse {
  token: string
  expiresIn: number
}

export function HandoffQR({ tableId, seat, bearer }: HandoffQRProps) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qrSvg, setQrSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function issueOnce() {
      try {
        const url = `${PUBLIC.gatewayHttp}/handoff/issue`
        const data = await api<IssueResponse>(url, {
          method: 'POST',
          body: JSON.stringify({ tableId, seat }),
          bearer,
        })
        if (cancelled) return
        setToken(data.token)
        setError(null)
        // Refresh shortly before the 60s TTL elapses.
        const refreshMs = Math.max(5_000, (data.expiresIn - 10) * 1000)
        timer = setTimeout(issueOnce, refreshMs)
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message)
      }
    }
    issueOnce()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [tableId, seat, bearer])

  // Render QR SVG. We dynamically import `qrcode` so the bundle stays
  // small for users who never open the handoff card.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const QRCode = await import('qrcode')
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const url = `${origin}/resume?token=${encodeURIComponent(
          token
        )}&table=${encodeURIComponent(tableId)}`
        const svg = await QRCode.toString(url, { type: 'svg', margin: 1 })
        if (!cancelled) setQrSvg(svg)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, tableId])

  return (
    <div
      className="absolute top-4 right-4 bg-neutral-950/90 border border-neutral-800 rounded-md p-4 w-64 text-xs"
      role="dialog"
      aria-label="Handoff to phone"
    >
      <div className="font-semibold mb-2 text-sm">Move to phone</div>
      {error && <p className="text-red-400">{error}</p>}
      {!error && !qrSvg && <p className="text-neutral-400">Generating QR…</p>}
      {qrSvg && (
        <div
          className="bg-white p-2 rounded"
          // The QR library returns a complete <svg>… string. It's
          // generated server-side from data we control, so injecting
          // it here is safe.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      )}
      <p className="mt-2 text-neutral-400">
        Scan with your phone. The desktop view will switch to spectator mode
        once the phone takes over.
      </p>
    </div>
  )
}
