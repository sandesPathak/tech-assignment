'use client'

// Side panel that mounts when the gateway emits a hand_completed event.
// Spec from docs/plan/PHASE-07-coach.md (completion notes):
//
//   type CoachPanelProps = {
//     handId: string
//     hero: string             // playerId
//     open: boolean
//     onDismiss: () => void
//   }
//
// Behavior: on mount fetch /api/coach/:handId/:hero. Render the prose
// `summary` then `decisions[]` cards. Auto-dismiss on next hand unless
// pinned. Respects coach.enabled in the user's settings (read from
// localStorage; default true).

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { Avatar } from './Avatar'
import { useTableStore } from '@/lib/store'

interface CoachDecision {
  street: string
  tag: string
  mistake_bb: number
  comment: string
  // Optional fields the gateway may include for "advanced" view.
  equity?: number
  position?: string
  action_history?: string
}

interface CoachAnalysis {
  hand_id: string
  hero: string
  prose?: { summary?: string; decisions?: CoachDecision[] } | null
  findings?: { decisions?: CoachDecision[] } | null
}

export interface CoachPanelProps {
  handId: string | null
  hero: string
  open: boolean
  pinned?: boolean
  onPin?: () => void
  onDismiss: () => void
}

export function CoachPanel({
  handId,
  hero,
  open,
  pinned = false,
  onPin,
  onDismiss,
}: CoachPanelProps) {
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = useMemo(() => isCoachEnabled(), [])

  // Pull the hero's seat metadata out of the current snapshot so the
  // coach panel header can render their avatar + display name.
  const heroMeta = useTableStore((s) => {
    const snap = s.snapshot as
      | { players?: Array<Record<string, unknown>> }
      | null
    if (!snap || !Array.isArray(snap.players)) return null
    const found = snap.players.find(
      (p) =>
        p &&
        (p['userId'] === hero || p['guid'] === hero || p['playerId'] === hero)
    )
    if (!found) return null
    return {
      avatarId: (found['avatarId'] as string) || null,
      displayName:
        (found['displayName'] as string) ||
        (found['username'] as string) ||
        '',
    }
  })

  useEffect(() => {
    if (!open || !handId || !hero || !enabled) return
    let cancelled = false
    setAnalysis(null)
    setLoading(true)
    setError(null)
    const url = `/api/coach/${encodeURIComponent(handId)}/${encodeURIComponent(hero)}`
    api<CoachAnalysis>(url)
      .then((data) => {
        if (cancelled) return
        setAnalysis(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError((err as Error).message)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, handId, hero, enabled])

  if (!open || !enabled) return null

  const summary = analysis?.prose?.summary ?? null
  const decisions =
    analysis?.prose?.decisions ?? analysis?.findings?.decisions ?? []

  return (
    <aside
      className="fixed bottom-0 right-0 w-full sm:w-96 max-h-[60vh] sm:max-h-[80vh] border-t sm:border-l border-neutral-800 bg-neutral-950 overflow-y-auto z-40 shadow-xl"
      role="complementary"
      aria-label="Coach analysis"
    >
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 sticky top-0 bg-neutral-950">
        <div className="flex items-center gap-2">
          {heroMeta && (
            <Avatar avatarId={heroMeta.avatarId} size={28} alt="You" />
          )}
          <h2 className="text-sm font-semibold">
            Coach
            {heroMeta?.displayName && (
              <span className="ml-2 text-xs font-normal text-neutral-400">
                for {heroMeta.displayName}
              </span>
            )}
          </h2>
        </div>
        <div className="flex gap-2">
          {onPin && (
            <button
              type="button"
              onClick={onPin}
              className="text-xs underline text-neutral-300"
              aria-pressed={pinned}
            >
              {pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs underline text-neutral-300"
            aria-label="Dismiss coach"
          >
            Dismiss
          </button>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {loading && (
          <p className="text-xs text-neutral-400">Analyzing the hand…</p>
        )}
        {error && (
          <p className="text-xs text-red-400" role="alert">
            Coach unavailable: {error}
          </p>
        )}
        {summary && (
          <p className="text-sm text-neutral-200 leading-snug">{summary}</p>
        )}
        {decisions.length > 0 ? (
          <ul className="space-y-2">
            {decisions.map((d, idx) => (
              <li
                key={`${d.street}-${idx}`}
                className="rounded border border-neutral-800 bg-neutral-900 p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs uppercase tracking-wide text-neutral-400">
                    {d.street}
                  </span>
                  <span
                    className={[
                      'text-[10px] px-2 py-0.5 rounded',
                      d.mistake_bb > 0
                        ? 'bg-red-800/50 text-red-100'
                        : 'bg-emerald-800/50 text-emerald-100',
                    ].join(' ')}
                  >
                    {d.mistake_bb > 0
                      ? `-${d.mistake_bb.toFixed(2)}bb`
                      : `+${Math.abs(d.mistake_bb).toFixed(2)}bb`}
                  </span>
                </div>
                <div className="text-xs text-neutral-300">
                  <span className="inline-block px-1.5 py-0.5 mr-2 text-[10px] bg-neutral-800 rounded">
                    {d.tag}
                  </span>
                  {d.comment}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          !loading && !error && !summary && (
            <p className="text-xs text-neutral-500">
              No analysis available for this hand.
            </p>
          )
        )}
      </div>
    </aside>
  )
}

function isCoachEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem('hijack:settings')
    if (!raw) return true
    const parsed = JSON.parse(raw) as { coach?: { enabled?: boolean } }
    return parsed?.coach?.enabled !== false
  } catch {
    return true
  }
}
