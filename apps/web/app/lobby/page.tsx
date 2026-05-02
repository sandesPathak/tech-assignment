'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { PUBLIC } from '@/lib/env'
import {
  createLobbySocket,
  type IGameSocket,
} from '@/lib/game-socket'
import type { LobbyTableRow, S2CLobbyState, S2CLobbyDelta } from '@hijack/protocol'

interface StakeMeta {
  id: string
  name: string
  smallBlind: number
  bigBlind: number
  maxSeats: number
  minBuyIn: number
  maxBuyIn: number
}

export default function LobbyPage() {
  const [stakes, setStakes] = useState<StakeMeta[]>([])
  const [activeStake, setActiveStake] = useState<string | null>(null)
  const [tables, setTables] = useState<LobbyTableRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading')

  // Pull the stake list from the gateway once on mount.
  useEffect(() => {
    let cancelled = false
    async function loadStakes() {
      try {
        const url = `${PUBLIC.gatewayHttp}/lobby`
        const data = await api<{ stakes: StakeMeta[] }>(url)
        if (cancelled) return
        setStakes(data.stakes || [])
        if (data.stakes?.length) {
          setActiveStake((cur) => cur ?? data.stakes[0].id)
        }
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message)
        setStatus('offline')
      }
    }
    loadStakes()
    return () => {
      cancelled = true
    }
  }, [])

  // Open a lobby WS subscription for the active stake. The gateway
  // sends `s2c.lobby_state` first, then `s2c.lobby_delta` rows.
  useEffect(() => {
    const stake = activeStake
    if (!stake) return
    let socket: IGameSocket | null = null
    let stopped = false

    async function start(stakeId: string) {
      try {
        socket = createLobbySocket({ baseWsUrl: PUBLIC.gatewayWs })
        socket.on('message', (msg) => {
          if (msg.t === 's2c.lobby_state') {
            const ls = msg as S2CLobbyState
            if (ls.stake !== stakeId) return
            setTables(ls.tables)
            setStatus('live')
          } else if (msg.t === 's2c.lobby_delta') {
            const ld = msg as S2CLobbyDelta
            if (ld.stake !== stakeId) return
            setTables((prev) => applyLobbyDelta(prev, ld))
          }
        })
        socket.on('close', () => {
          if (!stopped) setStatus('offline')
        })
        socket.on('error', () => setStatus('offline'))
        await socket.connect()
        socket.send({ t: 'c2s.lobby_subscribe', stake: stakeId })
      } catch (err) {
        setError((err as Error).message)
        setStatus('offline')
      }
    }
    start(stake)
    return () => {
      stopped = true
      socket?.disconnect()
    }
  }, [activeStake])

  const sortedTables = useMemo(
    () =>
      [...tables].sort((a, b) => b.openSeats - a.openSeats || a.name.localeCompare(b.name)),
    [tables]
  )

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Lobby</h1>
          <p className="text-xs text-neutral-500">Pick a stake, then a table.</p>
        </div>
        <Link
          href="/settings"
          className="text-sm underline text-neutral-300"
        >
          Settings
        </Link>
      </header>

      <nav aria-label="Stakes" className="flex gap-2 mb-6 flex-wrap">
        {stakes.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveStake(s.id)}
            className={[
              'rounded-md px-4 py-2 text-sm border',
              activeStake === s.id
                ? 'bg-chip text-black border-chip'
                : 'bg-neutral-900 border-neutral-700 text-neutral-200',
            ].join(' ')}
          >
            {s.name}
          </button>
        ))}
      </nav>

      <StatusBanner status={status} error={error} />

      {sortedTables.length === 0 && status === 'live' && (
        <p className="text-sm text-neutral-400">No tables open at this stake yet.</p>
      )}

      <ul className="grid gap-3 mt-2">
        {sortedTables.map((t) => (
          <li
            key={t.tableId}
            className="rounded-md bg-neutral-900 border border-neutral-800 p-4 flex items-center justify-between"
          >
            <div>
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-neutral-400">
                Seats {t.maxSeats - t.openSeats}/{t.maxSeats} · {t.smallBlind}/{t.bigBlind}
              </div>
            </div>
            <Link
              href={`/table/${encodeURIComponent(t.tableId)}`}
              className="rounded-md bg-chip text-black font-semibold px-3 py-1.5 text-sm"
              prefetch={false}
            >
              Sit
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

function StatusBanner({
  status,
  error,
}: {
  status: 'loading' | 'live' | 'offline'
  error: string | null
}) {
  if (status === 'loading') {
    return <p className="text-xs text-neutral-500">Connecting to lobby…</p>
  }
  if (status === 'offline') {
    return (
      <p className="text-xs text-red-400" role="status">
        Lobby offline {error ? `(${error})` : ''} — retry from the stake tabs.
      </p>
    )
  }
  return <p className="text-xs text-emerald-400" role="status">Live</p>
}

function applyLobbyDelta(
  prev: LobbyTableRow[],
  d: S2CLobbyDelta
): LobbyTableRow[] {
  switch (d.kind) {
    case 'table_added': {
      if (d.openSeats == null || d.maxSeats == null || !d.name) return prev
      if (prev.find((t) => t.tableId === d.tableId)) return prev
      return [
        ...prev,
        {
          tableId: d.tableId,
          name: d.name,
          openSeats: d.openSeats,
          maxSeats: d.maxSeats,
          smallBlind: d.smallBlind ?? 0,
          bigBlind: d.bigBlind ?? 0,
        },
      ]
    }
    case 'table_removed':
      return prev.filter((t) => t.tableId !== d.tableId)
    case 'seat_filled':
      return prev.map((t) =>
        t.tableId === d.tableId
          ? { ...t, openSeats: Math.max(0, (d.openSeats ?? t.openSeats - 1)) }
          : t
      )
    case 'seat_freed':
      return prev.map((t) =>
        t.tableId === d.tableId
          ? { ...t, openSeats: d.openSeats ?? t.openSeats + 1 }
          : t
      )
    default:
      return prev
  }
}
