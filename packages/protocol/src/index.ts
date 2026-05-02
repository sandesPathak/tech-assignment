// @hijack/protocol — WS / REST message types shared across web, gateway, worker, bot.
//
// Phase 2 finalization. Every WS frame is a JSON object with a `t` (type) tag
// and (for server-originated frames bound to a table) a monotonic `seq` that
// the client uses for resume / gap detection.
//
// Naming: `c2s.*` = client -> server (gateway), `s2c.*` = server (gateway) -> client.
// The on-the-wire `t` value is the dotted form, e.g. `"c2s.join"`.

// ─── Shared building blocks ────────────────────────────────────────────────

export type PokerActionKind =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'all_in'

/** A single hand event broadcast to subscribers. The gateway re-serializes
 *  these into `s2c.delta` frames; the worker writes the same shape into
 *  the durable `hand_events` log. */
export interface HandEventEnvelope {
  handId: string
  seq: number
  step: number
  payload: unknown
}

// ─── Client -> Server (c2s) ────────────────────────────────────────────────

/** Initial hello after WS open. The JWT proves identity (carried in the
 *  query string at upgrade time too — this is just defense in depth).
 *  `lastSeq` is the highest table-seq the client has already applied; if
 *  the gateway still has those events buffered (or in the durable store)
 *  it replays them, otherwise it forces a full snapshot. */
export interface C2SJoin {
  t: 'c2s.join'
  tableId: string
  seat?: number
  lastSeq?: number
  /** Phase 3 — short-lived JWT minted by the seat-claim REST endpoint.
   *  The gateway verifies it before letting the client `bind` to a seat. */
  joinToken?: string
}

/** Player action — fold/check/call/bet/raise/all-in. */
export interface C2SAction {
  t: 'c2s.action'
  tableId: string
  seat: number
  action: PokerActionKind
  amount?: number
}

/** Voluntarily leave the table; gateway closes the socket. */
export interface C2SLeave {
  t: 'c2s.leave'
  tableId: string
}

/** Subscribe to live lobby updates for one stake. */
export interface C2SLobbySubscribe {
  t: 'c2s.lobby_subscribe'
  stake: string
}

/** Stop receiving lobby updates for the previously-subscribed stake. */
export interface C2SLobbyUnsubscribe {
  t: 'c2s.lobby_unsubscribe'
  stake: string
}

export type ClientMessage =
  | C2SJoin
  | C2SAction
  | C2SLeave
  | C2SLobbySubscribe
  | C2SLobbyUnsubscribe

// ─── Server -> Client (s2c) ────────────────────────────────────────────────

/** Full table snapshot — sent on join, after backpressure resync, or when
 *  the requested resume `lastSeq` is out of range. */
export interface S2CSnapshot {
  t: 's2c.snapshot'
  tableId: string
  seq: number
  state: unknown
}

/** Incremental table delta — one engine tick. Carries the same payload the
 *  worker writes to `hand_events`. */
export interface S2CDelta {
  t: 's2c.delta'
  tableId: string
  seq: number
  step: number
  payload: unknown
}

/** Recoverable error — bad action, awaiting a different seat, etc. The
 *  socket stays open. */
export interface S2CError {
  t: 's2c.error'
  tableId?: string
  code: string
  message: string
}

/** Forcible disconnect — auth failure, table closed, replaced by another
 *  session, etc. Gateway sends this then closes. */
export interface S2CKicked {
  t: 's2c.kicked'
  reason: string
}

/** A single table row in the lobby snapshot. */
export interface LobbyTableRow {
  tableId: string
  name: string
  openSeats: number
  maxSeats: number
  smallBlind: number
  bigBlind: number
}

/** Full lobby state for a stake. */
export interface S2CLobbyState {
  t: 's2c.lobby_state'
  stake: string
  tables: LobbyTableRow[]
}

/** Incremental lobby update. `kind` discriminates payload fields. */
export interface S2CLobbyDelta {
  t: 's2c.lobby_delta'
  stake: string
  kind:
    | 'table_added'
    | 'table_removed'
    | 'seat_filled'
    | 'seat_freed'
  tableId: string
  seat?: number
  openSeats?: number
  maxSeats?: number
  name?: string
  smallBlind?: number
  bigBlind?: number
}

export type ServerMessage =
  | S2CSnapshot
  | S2CDelta
  | S2CError
  | S2CKicked
  | S2CLobbyState
  | S2CLobbyDelta

// ─── Convenience type guards (compile to runtime) ─────────────────────────

export function isClientMessage(x: unknown): x is ClientMessage {
  if (!x || typeof x !== 'object') return false
  const t = (x as { t?: unknown }).t
  return (
    t === 'c2s.join' ||
    t === 'c2s.action' ||
    t === 'c2s.leave' ||
    t === 'c2s.lobby_subscribe' ||
    t === 'c2s.lobby_unsubscribe'
  )
}

export function isServerMessage(x: unknown): x is ServerMessage {
  if (!x || typeof x !== 'object') return false
  const t = (x as { t?: unknown }).t
  return (
    t === 's2c.snapshot' ||
    t === 's2c.delta' ||
    t === 's2c.error' ||
    t === 's2c.kicked' ||
    t === 's2c.lobby_state' ||
    t === 's2c.lobby_delta'
  )
}
