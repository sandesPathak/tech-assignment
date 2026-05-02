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
import { Avatar } from '@/components/Avatar'

interface StakeMeta {
  id: string
  name: string
  smallBlind: number
  bigBlind: number
  maxSeats: number
  minBuyIn: number
  maxBuyIn: number
}

const STAKE_TIER_LABEL: Record<string, string> = {
  micro: 'MICRO',
  low: 'LOW',
  mid: 'MID',
  high: 'HIGH',
}

function tierFromStakeId(id: string): string {
  const k = id.toLowerCase()
  if (k.includes('micro')) return 'micro'
  if (k.includes('high')) return 'high'
  if (k.includes('mid')) return 'mid'
  return 'low'
}

export default function LobbyPage() {
  const [stakes, setStakes] = useState<StakeMeta[]>([])
  const [activeStake, setActiveStake] = useState<string | null>(null)
  const [tables, setTables] = useState<LobbyTableRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading')

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

  const activeStakeMeta = useMemo(
    () => stakes.find((s) => s.id === activeStake) ?? null,
    [stakes, activeStake]
  )

  return (
    <div className="cyber-bg min-h-screen overflow-x-hidden">
      <TopAppBar />
      <div className="flex min-h-screen pt-16">
        <SideNav />
        <main className="flex-1 lg:ml-64 p-4 sm:p-6 overflow-y-auto pb-32 lg:pb-6">
          <div className="max-w-7xl mx-auto space-y-8">
            <HeroBanner />

            {/* Stakes selector + status */}
            <section>
              <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
                <h2 className="text-2xl font-semibold text-white tracking-tight">CASH GAMES</h2>
                <div className="flex flex-wrap gap-1 bg-[#222a3d] p-1 rounded-lg">
                  {stakes.map((s) => {
                    const tier = tierFromStakeId(s.id)
                    const label = STAKE_TIER_LABEL[tier] ?? s.name.toUpperCase()
                    const active = activeStake === s.id
                    return (
                      <button
                        key={s.id}
                        onClick={() => setActiveStake(s.id)}
                        className={[
                          'px-4 py-1.5 rounded text-[12px] font-bold tracking-widest uppercase transition-colors',
                          active
                            ? 'bg-[#060e20] text-cyan-400'
                            : 'text-slate-400 hover:text-white',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <StatusBanner status={status} error={error} />

              {sortedTables.length === 0 && status === 'live' && (
                <p className="text-sm text-slate-400 mt-3">
                  No tables open at this stake yet — sit at any tier to spin one up.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-4">
                {sortedTables.map((t) => (
                  <TableCard
                    key={t.tableId}
                    table={t}
                    tier={activeStakeMeta ? tierFromStakeId(activeStakeMeta.id) : 'low'}
                  />
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  )
}

function TopAppBar() {
  return (
    <header className="flex justify-between items-center w-full px-4 h-16 fixed top-0 left-0 z-50 bg-slate-950/60 backdrop-blur-xl border-b border-white/10 shadow-2xl">
      <div className="flex items-center gap-4 min-w-0">
        <Link
          href="/lobby"
          className="text-xl sm:text-2xl font-black italic text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.4)] truncate"
        >
          HIJACK POKER
        </Link>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="hidden md:flex items-center gap-2 bg-[#222a3d] rounded-full px-3 py-1.5">
          <span className="text-[14px] font-semibold text-white tabular-nums">$10,000.00</span>
          <span className="text-[11px] font-bold tracking-wider text-cyan-300 bg-[#060e20] px-2 py-0.5 rounded-full">
            LVL 1
          </span>
        </div>
        <Link
          href="/settings"
          className="hidden sm:inline-block bg-orange-500 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:bg-orange-400 transition-colors orange-glow uppercase tracking-wide"
        >
          Profile
        </Link>
        <Link
          href="/settings"
          aria-label="Settings"
          className="text-slate-400 hover:text-cyan-400 transition-colors p-2 rounded-full bg-white/5"
        >
          <span className="material-symbols-outlined">settings</span>
        </Link>
      </div>
    </header>
  )
}

function SideNav() {
  return (
    <nav className="hidden lg:flex flex-col w-64 h-[calc(100vh-4rem)] bg-slate-900/40 backdrop-blur-2xl border-r border-white/5 fixed left-0 top-16 z-40">
      <div className="p-6 border-b border-white/5 text-center">
        <div className="w-16 h-16 rounded-full mx-auto mb-2 border-2 border-cyan-500 bg-gradient-to-br from-cyan-500/30 to-orange-500/30 flex items-center justify-center text-2xl font-black text-white">
          H
        </div>
        <h2 className="text-[18px] font-semibold text-white">COMMAND CENTER</h2>
        <p className="text-[12px] font-bold tracking-widest text-cyan-300 mt-1">PLAYER</p>
      </div>
      <div className="flex-1 py-6 overflow-y-auto">
        <ul className="space-y-2 px-2">
          <SideLink icon="casino" label="Lobby" href="/lobby" active />
          <SideLink icon="emoji_events" label="Tournaments" href="#" />
          <SideLink icon="leaderboard" label="Leaderboard" href="#" />
          <SideLink icon="local_mall" label="Store" href="#" />
          <SideLink icon="qr_code_2" label="Handoff" href="/resume" />
        </ul>
      </div>
      <div className="p-6 border-t border-white/5">
        <Link
          href="/lobby"
          className="block w-full bg-white/5 text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/20 text-center font-semibold py-2 rounded-lg transition-all neon-glow"
        >
          Quick Join
        </Link>
      </div>
    </nav>
  )
}

function SideLink({
  icon,
  label,
  href,
  active = false,
}: {
  icon: string
  label: string
  href: string
  active?: boolean
}) {
  const cls = active
    ? 'flex items-center gap-4 px-4 py-2 rounded-lg text-cyan-400 border-r-2 border-cyan-500 bg-cyan-500/10 text-[12px] font-bold tracking-widest uppercase transition-all'
    : 'flex items-center gap-4 px-4 py-2 rounded-lg text-slate-500 hover:bg-white/5 hover:text-cyan-300 text-[12px] font-bold tracking-widest uppercase transition-all'
  return (
    <li>
      <Link href={href} className={cls}>
        <span className="material-symbols-outlined">{icon}</span>
        {label}
      </Link>
    </li>
  )
}

function HeroBanner() {
  return (
    <section
      className="relative rounded-xl overflow-hidden glass-panel min-h-[260px] flex items-end p-6 group"
      style={{
        background:
          'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(11,19,38,0.85) 50%, rgba(249,115,22,0.15) 100%)',
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, rgba(14,165,233,0.4), transparent 50%), radial-gradient(circle at 80% 70%, rgba(249,115,22,0.4), transparent 50%)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/40 to-transparent pointer-events-none" />
      <div className="relative z-10 w-full flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="min-w-0">
          <span className="text-[12px] font-bold tracking-widest text-orange-400 bg-orange-500/10 px-2 py-1 rounded border border-orange-500/40 inline-block mb-3 uppercase">
            Welcome
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-2">
            NEON FELT IS LIVE
          </h1>
          <p className="text-slate-300 max-w-xl">
            Pick a stake, claim a seat, and the matchmaker spins up a table the moment one fills.
          </p>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <Link
            href="#cash-games"
            className="bg-orange-500 text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-orange-400 transition-colors orange-glow w-full md:w-auto text-center uppercase tracking-wide"
          >
            Find Seat
          </Link>
        </div>
      </div>
    </section>
  )
}

function TableCard({ table, tier }: { table: LobbyTableRow; tier: string }) {
  const taken = table.maxSeats - table.openSeats
  const isFull = table.openSeats === 0
  const tierLabel = (STAKE_TIER_LABEL[tier] ?? 'STAKES') + ' STAKES'
  const tierColor =
    tier === 'high'
      ? 'text-orange-400 bg-orange-500/10 border border-orange-500/40'
      : tier === 'mid'
      ? 'text-cyan-300 bg-cyan-500/10 border border-cyan-500/40'
      : 'text-slate-300 bg-white/5 border border-white/10'

  return (
    <div className="glass-panel rounded-xl overflow-hidden hover:border-cyan-500/50 transition-colors relative group flex flex-col">
      <div className="absolute inset-0 bg-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <div className="p-4 bg-[#060e20] border-b border-white/5 flex justify-between items-start gap-3">
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold text-white truncate">{table.name}</h3>
          <p className="text-[14px] text-slate-400">No Limit Hold&rsquo;em</p>
        </div>
        <span
          className={`text-[11px] font-bold tracking-widest px-2 py-1 rounded shrink-0 uppercase ${tierColor}`}
        >
          {tierLabel}
        </span>
      </div>
      <div className="p-6 space-y-4 flex-1 flex flex-col">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-slate-500">payments</span>
            <span className="text-[14px] font-semibold text-white tabular-nums">
              {table.smallBlind} / {table.bigBlind}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-slate-500">group</span>
            <span className="text-[14px] font-semibold text-white tabular-nums">
              {taken} / {table.maxSeats}
            </span>
          </div>
        </div>

        <SeatStrip tableId={table.tableId} taken={taken} max={table.maxSeats} />

        <div className="flex gap-2 pt-3 mt-auto border-t border-white/5 relative z-10">
          {isFull ? (
            <button
              type="button"
              disabled
              className="flex-1 bg-[#2d3449] text-slate-500 font-semibold py-2 rounded cursor-not-allowed uppercase tracking-wide"
            >
              Full
            </button>
          ) : (
            <Link
              href={`/table/${encodeURIComponent(table.tableId)}`}
              prefetch={false}
              className="flex-1 bg-white/5 border border-cyan-500/50 text-cyan-400 font-semibold py-2 rounded hover:bg-cyan-500/10 transition-colors text-center uppercase tracking-wide"
            >
              Play
            </Link>
          )}
          <Link
            href={`/table/${encodeURIComponent(table.tableId)}?spectate=1`}
            prefetch={false}
            aria-label="Spectate"
            className="px-4 text-cyan-500 hover:text-cyan-300 transition-colors flex items-center justify-center"
          >
            <span className="material-symbols-outlined">visibility</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

function SeatStrip({
  tableId,
  taken,
  max,
}: {
  tableId: string
  taken: number
  max: number
}) {
  const seats: { filled: boolean; avatarId: string | null }[] = []
  let h = 0
  for (let i = 0; i < tableId.length; i += 1) h = (h * 31 + tableId.charCodeAt(i)) >>> 0
  for (let i = 0; i < max; i += 1) {
    if (i < taken) {
      const slot = ((h + i * 17) % 24) + 1
      seats.push({ filled: true, avatarId: String(slot) })
    } else {
      seats.push({ filled: false, avatarId: null })
    }
  }
  return (
    <div className="flex gap-1.5 flex-wrap" aria-label={`${taken} of ${max} seated`}>
      {seats.map((s, i) =>
        s.filled ? (
          <div
            key={`${tableId}-${i}`}
            className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500 flex items-center justify-center overflow-hidden"
          >
            {s.avatarId ? (
              <Avatar avatarId={s.avatarId} size={28} className="border-0" />
            ) : (
              <span className="text-[10px] text-cyan-300 font-bold">P{i + 1}</span>
            )}
          </div>
        ) : (
          <div
            key={`${tableId}-${i}`}
            className="w-8 h-8 rounded-full border border-dashed border-slate-600"
          />
        )
      )}
    </div>
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
    return (
      <p className="text-[12px] tracking-widest font-bold uppercase text-slate-400">
        Connecting to lobby&hellip;
      </p>
    )
  }
  if (status === 'offline') {
    return (
      <p
        className="text-[12px] tracking-widest font-bold uppercase text-red-400"
        role="status"
      >
        Lobby offline {error ? `(${error})` : ''} — retry from the stake tabs.
      </p>
    )
  }
  return (
    <p
      className="text-[12px] tracking-widest font-bold uppercase text-emerald-400 inline-flex items-center gap-2"
      role="status"
    >
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      Live
    </p>
  )
}

function BottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-20 pb-safe bg-slate-950/80 backdrop-blur-lg rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
      <BottomLink icon="casino" label="Lobby" href="/lobby" active />
      <BottomLink icon="emoji_events" label="Tourneys" href="#" />
      <BottomLink icon="qr_code_2" label="Handoff" href="/resume" />
      <BottomLink icon="settings" label="Settings" href="/settings" />
    </nav>
  )
}

function BottomLink({
  icon,
  label,
  href,
  active = false,
}: {
  icon: string
  label: string
  href: string
  active?: boolean
}) {
  const cls = active
    ? 'flex flex-col items-center justify-center text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.5)] text-[10px] font-bold uppercase scale-110'
    : 'flex flex-col items-center justify-center text-slate-500 hover:text-white text-[10px] font-bold uppercase'
  return (
    <Link href={href} className={cls}>
      <span className="material-symbols-outlined mb-1">{icon}</span>
      {label}
    </Link>
  )
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
