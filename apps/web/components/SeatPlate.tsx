'use client'

// SeatPlate — renders avatar + display name + chip stack for one seat.
// Used by the table page; reads its data from the snapshot blob the
// gateway sends (see apps/worker/src/codec.js for shape).

import { Avatar } from './Avatar'

export interface SeatPlayer {
  seat?: number | null
  username?: string
  displayName?: string
  avatarId?: string | null
  stack?: number
  status?: string | number
  bet?: number
  guid?: string
  userId?: string
}

export function SeatPlate({
  player,
  hero,
}: {
  player: SeatPlayer | null | undefined
  hero?: boolean
}) {
  if (!player) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-neutral-700 px-2 py-1.5 text-xs text-neutral-500">
        Empty seat
      </div>
    )
  }
  const name = player.displayName || player.username || 'Player'
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-md border px-2 py-1.5',
        hero ? 'bg-emerald-900/40 border-emerald-700' : 'bg-neutral-900/60 border-neutral-700',
      ].join(' ')}
      data-testid="seat-plate"
    >
      <Avatar avatarId={player.avatarId ?? '1'} size={32} alt={`${name} avatar`} />
      <div className="text-xs">
        <div className="font-semibold text-neutral-100" data-testid="seat-name">{name}</div>
        {typeof player.stack === 'number' && (
          <div className="text-[10px] text-neutral-400">
            Stack {player.stack}
            {typeof player.bet === 'number' && player.bet > 0
              ? ` · Bet ${player.bet}`
              : ''}
          </div>
        )}
      </div>
    </div>
  )
}
