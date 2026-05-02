// @hijack/protocol — WS / REST message types shared across web, gateway, worker, bot.
//
// Phase 0 scaffold: stub shapes only. Phases 1-4 will fill in the fields and
// add discriminated-union envelopes, seq numbers, and broadcast payloads.

export interface JoinTable {
  type: 'join_table'
  tableId: string
  seat?: number
  sessionToken: string
}

export interface LeaveTable {
  type: 'leave_table'
  tableId: string
}

export type PokerActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in'

export interface PlayerAction {
  type: 'player_action'
  tableId: string
  seat: number
  action: PokerActionKind
  amount?: number
  seq: number
}

export interface TableSnapshot {
  type: 'table_snapshot'
  tableId: string
  seq: number
  // TODO(phase-1): nested game/players/pots state from @hijack/engine
  state: unknown
}

export interface TableDelta {
  type: 'table_delta'
  tableId: string
  seq: number
  // TODO(phase-1): JSON-patch-style ops or domain-specific events
  ops: unknown[]
}

export interface LobbyUpdate {
  type: 'lobby_update'
  tables: Array<{ tableId: string; seatsTaken: number; seatsTotal: number }>
}

export interface PlayerUpdated {
  type: 'player_updated'
  playerId: string
  // TODO(phase-3): profile fields (displayName, avatarUrl, streak, etc.)
  fields: Record<string, unknown>
}

export interface HandoffToken {
  type: 'handoff_token'
  token: string
  expiresAt: number
}

export type ServerMessage =
  | TableSnapshot
  | TableDelta
  | LobbyUpdate
  | PlayerUpdated
  | HandoffToken

export type ClientMessage =
  | JoinTable
  | LeaveTable
  | PlayerAction
