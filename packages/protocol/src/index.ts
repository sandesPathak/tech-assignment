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

/** Optional WS-side hello when the client is already proving identity via
 *  a JWT minted from `POST /handoff/redeem`. The actual token swap is
 *  done over REST (so the token never travels in WS frames a third party
 *  could observe via `wscat` etc.) — this frame just lets the gateway
 *  treat the connection as a handoff continuation rather than a fresh
 *  join, which matters when reporting kick reasons in observability.
 *
 *  The gateway will accept a normal `c2s.join` even if the client skips
 *  this — the JWT alone is sufficient. Provided here so the protocol
 *  package is the canonical source for every wire shape Phase 6 uses. */
export interface C2SHandoffRedeem {
  t: 'c2s.handoff_redeem'
  tableId: string
  /** Echo of the sessionId returned from `POST /handoff/redeem`. */
  sessionId: string
}

export type ClientMessage =
  | C2SJoin
  | C2SAction
  | C2SLeave
  | C2SLobbySubscribe
  | C2SLobbyUnsubscribe
  | C2SHandoffRedeem

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

/** Forcible disconnect or seat eviction. The gateway sends this then
 *  either closes the socket (auth failure, table closed) or — in the
 *  handoff case — leaves the socket open in spectator mode so the old
 *  device can continue rendering the public table state.
 *
 *  Reasons in use:
 *    - `'handoff'`               another device redeemed a handoff token.
 *    - `'replaced_by_other_session'`  same user reconnected on the same
 *                                   device pre-handoff.
 *    - `'backpressure_resync'`   slow consumer; reconnect to catch up.
 *    - `'auth'` / `'table_closed'` etc.
 */
export interface S2CKicked {
  t: 's2c.kicked'
  reason:
    | 'handoff'
    | 'replaced_by_other_session'
    | 'backpressure_resync'
    | 'auth'
    | 'table_closed'
    | string
  /** Optional metadata — e.g. the new sessionId on a handoff so the
   *  client can correlate with its own redeem call. */
  replacedBy?: string
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
    t === 'c2s.lobby_unsubscribe' ||
    t === 'c2s.handoff_redeem'
  )
}

// ─── REST shapes for /handoff/issue + /handoff/redeem ─────────────────

/** Response of `POST /handoff/issue` — a short-lived single-use token
 *  that authorises a different device to claim the same seat. The token
 *  is opaque (256-bit, base64url) and lives in Redis under
 *  `handoff:{token}` with a 60s TTL. */
export interface HandoffToken {
  token: string
  /** Seconds until the token expires server-side. */
  expiresIn: number
}

/** Response of `POST /handoff/redeem`. The new device uses `jwt` in the
 *  existing `?token=` WS upgrade flow. */
export interface HandoffRedemption {
  jwt: string
  userId: string
  tableId: string
  seat: number | null
  sessionId: string
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
