'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import { PUBLIC } from '@/lib/env'
import {
  createTableSocket,
  type IGameSocket,
} from '@/lib/game-socket'
import { useTableStore, buildResumeJoin } from '@/lib/store'
import { CoachPanel } from '@/components/CoachPanel'
import { HandoffQR } from '@/components/HandoffQR'
import { SeatPlate, type SeatPlayer } from '@/components/SeatPlate'

interface JwtMint {
  token: string
  userId: string
  sessionId: string
  tableId: string
  seat: number | null
}

export default function TablePage() {
  const params = useParams<{ id: string }>()
  const tableId = decodeURIComponent(params?.id || '')

  const store = useTableStore()
  const socketRef = useRef<IGameSocket | null>(null)
  const [bearer, setBearer] = useState<string | null>(null)
  const [seat, setSeat] = useState<number | null>(null)
  const [showHandoff, setShowHandoff] = useState(false)
  const [coachPinned, setCoachPinned] = useState(false)

  // Mint a gateway JWT, attach socket, send c2s.join.
  useEffect(() => {
    if (!tableId) return
    let cancelled = false
    let socket: IGameSocket | null = null

    async function go() {
      store.attachTable(tableId)
      try {
        const mint = await api<JwtMint>('/api/jwt', {
          method: 'POST',
          body: JSON.stringify({ tableId, seat }),
        })
        if (cancelled) return
        setBearer(mint.token)

        socket = createTableSocket({
          baseWsUrl: PUBLIC.gatewayWs,
          tableId,
          jwt: mint.token,
        })
        socketRef.current = socket

        socket.on('state', (s) => {
          if (s === 'open') store.setStatus('open')
          else if (s === 'connecting') store.setStatus('connecting')
          else if (s === 'closed') store.setStatus('closed')
        })
        socket.on('message', (msg) => {
          const result = store.applyServerMessage(msg)
          if (result === 'snapshot_request') {
            // Reconciliation: send a fresh c2s.join with our last
            // applied seq so the gateway replays from there (or sends
            // a full snapshot when the buffer is gone).
            socket?.send(buildResumeJoin(tableId, store.lastSeq))
          }
        })
        socket.on('close', () => store.setStatus('closed'))
        socket.on('error', () => store.setStatus('closed'))

        await socket.connect()
        socket.send({ t: 'c2s.join', tableId, lastSeq: 0 })
      } catch (err) {
        // Bubble up via store so the UI shows it.
        store.applyServerMessage({
          t: 's2c.error',
          code: 'connect_failed',
          message: (err as Error).message,
        })
      }
    }
    go()
    return () => {
      cancelled = true
      try { socket?.disconnect() } catch { /* swallow */ }
      socketRef.current = null
      store.reset()
    }
    // We intentionally re-run when tableId / seat change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, seat])

  const status = store.status
  const handCompletedId = store.handCompletedId
  const heroUserId = useMemo(() => bearerSubject(bearer), [bearer])

  const coachOpen = Boolean(handCompletedId && heroUserId)

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-neutral-800">
        <div>
          <h1 className="text-lg font-semibold">Table {tableId}</h1>
          <ConnectionBadge status={status} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowHandoff((v) => !v)}
            className="text-xs rounded-md border border-neutral-700 px-3 py-1.5"
          >
            {showHandoff ? 'Hide handoff' : 'Move to phone'}
          </button>
          <SeatPicker seat={seat} setSeat={setSeat} />
        </div>
      </header>

      <section className="felt flex-1 grid place-items-center p-4 relative">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-emerald-200 mb-2">
            Hold&apos;em
          </div>
          <div className="text-sm text-emerald-100">
            seq: {store.lastSeq}
            {store.desynced ? ' (resyncing…)' : ''}
          </div>
          {store.snapshot != null ? (
            <SeatGrid snapshot={store.snapshot} heroUserId={heroUserId} />
          ) : (
            <p className="mt-3 text-sm text-emerald-100/70">Waiting for snapshot…</p>
          )}
        </div>

        {showHandoff && bearer && seat != null && (
          <HandoffQR
            tableId={tableId}
            seat={seat}
            bearer={bearer}
          />
        )}
      </section>

      <ActionBar
        onAction={(kind, amount) => {
          if (seat == null || !socketRef.current) return
          // Optimistic shadow — clears when the server delta arrives.
          store.setOptimistic({
            id: `opt_${Date.now()}`,
            seat,
            kind,
            amount,
          })
          socketRef.current.send({
            t: 'c2s.action',
            tableId,
            seat,
            action: kind,
            amount,
          })
        }}
        disabled={status !== 'open' || seat == null}
        optimistic={store.optimisticShadow?.kind ?? null}
      />

      <HandHistory events={store.events} />

      <CoachPanel
        handId={handCompletedId}
        hero={heroUserId}
        open={coachOpen}
        pinned={coachPinned}
        onPin={() => setCoachPinned((v) => !v)}
        onDismiss={() => {
          // Keep handCompletedId on the store so re-opening works,
          // but mark dismissed by clearing it.
          useTableStore.setState({ handCompletedId: null })
          setCoachPinned(false)
        }}
      />
    </main>
  )
}

// ─── small components in same file (page-only) ────────────────────────

function ConnectionBadge({ status }: { status: string }) {
  const cls =
    status === 'open'
      ? 'bg-emerald-700/40 text-emerald-100'
      : status === 'spectator'
      ? 'bg-amber-700/40 text-amber-100'
      : status === 'closed'
      ? 'bg-red-700/40 text-red-100'
      : 'bg-neutral-700/40 text-neutral-100'
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded ${cls}`}>
      {status}
    </span>
  )
}

function SeatPicker({
  seat,
  setSeat,
}: {
  seat: number | null
  setSeat: (s: number | null) => void
}) {
  return (
    <select
      className="bg-neutral-900 border border-neutral-700 text-sm rounded-md px-2 py-1.5"
      value={seat ?? ''}
      onChange={(e) => setSeat(e.target.value ? Number(e.target.value) : null)}
      aria-label="Seat"
    >
      <option value="">Spectator</option>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <option key={n} value={n}>Seat {n}</option>
      ))}
    </select>
  )
}

function ActionBar({
  onAction,
  disabled,
  optimistic,
}: {
  onAction: (kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) => void
  disabled: boolean
  optimistic: string | null
}) {
  const [betSize, setBetSize] = useState(10)
  return (
    <div className="border-t border-neutral-800 p-3 flex items-center gap-2 bg-neutral-950">
      <button
        type="button"
        onClick={() => onAction('fold')}
        disabled={disabled}
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Fold
      </button>
      <button
        type="button"
        onClick={() => onAction('check')}
        disabled={disabled}
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Check
      </button>
      <button
        type="button"
        onClick={() => onAction('call')}
        disabled={disabled}
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Call
      </button>
      <input
        type="number"
        value={betSize}
        onChange={(e) => setBetSize(Number(e.target.value))}
        min={1}
        className="w-20 bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm rounded"
        aria-label="Bet size"
      />
      <button
        type="button"
        onClick={() => onAction('bet', betSize)}
        disabled={disabled}
        className="rounded bg-chip text-black font-semibold px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Bet {betSize}
      </button>
      <button
        type="button"
        onClick={() => onAction('raise', betSize)}
        disabled={disabled}
        className="rounded bg-chip text-black font-semibold px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Raise to {betSize}
      </button>
      {optimistic && (
        <span className="ml-auto text-xs text-amber-300" role="status">
          pending {optimistic}…
        </span>
      )}
    </div>
  )
}

function HandHistory({
  events,
}: {
  events: Array<{ seq: number; step: number; payload: unknown }>
}) {
  if (events.length === 0) return null
  return (
    <aside
      className="border-t border-neutral-800 p-3 max-h-32 overflow-auto text-xs font-mono bg-neutral-950"
      aria-label="Hand history"
    >
      {events.slice(-20).map((e) => (
        <div key={e.seq} className="text-neutral-300">
          [{e.seq}] step {e.step}{' '}
          <span className="text-neutral-500">
            {summarise(e.payload)}
          </span>
        </div>
      ))}
    </aside>
  )
}

function summarise(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>
  const t = p['type'] || p['kind']
  return typeof t === 'string' ? t : JSON.stringify(p).slice(0, 80)
}

function SeatGrid({
  snapshot,
  heroUserId,
}: {
  snapshot: unknown
  heroUserId: string
}) {
  const players: SeatPlayer[] = Array.isArray(
    (snapshot as { players?: unknown })?.players
  )
    ? ((snapshot as { players: SeatPlayer[] }).players)
    : []
  if (players.length === 0) {
    return (
      <p className="mt-3 text-sm text-emerald-100/70">No players seated yet.</p>
    )
  }
  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-xl mx-auto">
      {players.map((p) => {
        const isHero =
          !!heroUserId &&
          (p.userId === heroUserId || p.guid === heroUserId)
        return (
          <SeatPlate
            key={`seat-${p.seat ?? p.guid ?? Math.random()}`}
            player={p}
            hero={isHero}
          />
        )
      })}
    </div>
  )
}

function bearerSubject(token: string | null): string {
  if (!token) return ''
  const parts = token.split('.')
  if (parts.length < 2) return ''
  try {
    const json = JSON.parse(
      Buffer.from(parts[1], 'base64').toString('utf8')
    ) as { sub?: string }
    return json.sub || ''
  } catch {
    return ''
  }
}
