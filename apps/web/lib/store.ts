// ─────────────────────────────────────────────────────────────────────────
// store.ts — table-state Zustand store.
//
// Server is source of truth. Client holds an `optimisticShadow` for the
// player's pending action so the action bar reads naturally even before
// the gateway confirms. Every server frame carries a monotonic `seq`;
// if we observe a gap (`incoming.seq > lastSeq + 1`) we mark the store
// as `desynced` and request a fresh snapshot from the socket — the
// gateway will respond by replaying buffered events or sending a full
// `s2c.snapshot`.
// ─────────────────────────────────────────────────────────────────────────

import { create, StateCreator } from 'zustand'
import type {
  ServerMessage,
  S2CSnapshot,
  S2CDelta,
  S2CKicked,
  S2CError,
  ClientMessage,
} from '@hijack/protocol'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'spectator'
  | 'closed'

export interface OptimisticAction {
  id: string
  seat: number
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in'
  amount?: number
}

export interface TableStoreState {
  tableId: string | null
  status: ConnectionStatus
  /** Last applied server `seq`. Snapshot replaces it; deltas advance it. */
  lastSeq: number
  /** Monotonic `seq` we know about but couldn't apply yet — used for gap
   *  detection. Cleared once a snapshot arrives. */
  pendingSeq: number | null
  /** Boolean for UI; true while a snapshot request is in flight. */
  desynced: boolean
  /** Server-side full state blob from `s2c.snapshot`. Opaque to the
   *  store; the table page interprets it. */
  snapshot: unknown | null
  /** History of decoded delta payloads, capped. */
  events: Array<{ seq: number; step: number; payload: unknown }>
  /** Current optimistic action — the seat-bar dispatches one, server
   *  confirms by emitting a delta whose payload type matches; on
   *  confirmation we clear it. */
  optimisticShadow: OptimisticAction | null
  /** Last s2c.error code/message — surfaced as a toast. */
  lastError: { code: string; message: string } | null
  /** Last kicked reason; populated on s2c.kicked. */
  kickedReason: string | null
  /** Hand id of the most recently completed hand, for the coach panel. */
  handCompletedId: string | null
}

export interface TableStoreActions {
  /** Wipe state — used on disconnect/route change. */
  reset(): void
  /** Bind to a table. Doesn't open a socket; the page does that. */
  attachTable(tableId: string): void
  setStatus(status: ConnectionStatus): void
  /** Apply a single server frame. Returns 'snapshot_request' if a gap
   *  was detected (caller should `send(c2s.join, lastSeq)`). */
  applyServerMessage(
    msg: ServerMessage
  ): 'applied' | 'snapshot_request' | 'ignored'
  setOptimistic(action: OptimisticAction | null): void
  clearError(): void
}

export type TableStore = TableStoreState & TableStoreActions

const EVENTS_CAP = 200

const initial: TableStoreState = {
  tableId: null,
  status: 'idle',
  lastSeq: 0,
  pendingSeq: null,
  desynced: false,
  snapshot: null,
  events: [],
  optimisticShadow: null,
  lastError: null,
  kickedReason: null,
  handCompletedId: null,
}

const creator: StateCreator<TableStore> = (set, get) => ({
  ...initial,

  reset: () => set({ ...initial }),

  attachTable: (tableId) => set({ ...initial, tableId, status: 'connecting' }),

  setStatus: (status) => set({ status }),

  setOptimistic: (action) => set({ optimisticShadow: action }),

  clearError: () => set({ lastError: null }),

  applyServerMessage: (msg) => {
    if (!msg || typeof msg !== 'object') return 'ignored'

    switch (msg.t) {
      case 's2c.snapshot': {
        const snap = msg as S2CSnapshot
        // A snapshot RESETS the seq baseline; clear pending + desynced.
        set({
          snapshot: snap.state,
          lastSeq: snap.seq,
          pendingSeq: null,
          desynced: false,
          events: [],
        })
        return 'applied'
      }
      case 's2c.delta': {
        const delta = msg as S2CDelta
        const cur = get().lastSeq
        if (delta.seq <= cur) {
          // Duplicate or out-of-order republish — drop.
          return 'ignored'
        }
        if (delta.seq > cur + 1 && cur > 0) {
          // Gap detected → flag desynced, store the floor we missed,
          // ask the caller to request a snapshot.
          set({ desynced: true, pendingSeq: delta.seq })
          return 'snapshot_request'
        }
        // Contiguous — apply.
        const next = [
          ...get().events,
          { seq: delta.seq, step: delta.step, payload: delta.payload },
        ].slice(-EVENTS_CAP)
        set({
          lastSeq: delta.seq,
          events: next,
        })
        // Hand-completed hint for the coach panel — gateway derives
        // this from the worker's `hand:completed` channel and folds
        // it into a delta with payload.kind = 'hand_completed'.
        const payload = delta.payload as Record<string, unknown> | null
        if (payload && typeof payload === 'object') {
          const kind = payload['kind'] as string | undefined
          if (kind === 'hand_completed' && typeof payload['handId'] === 'string') {
            set({ handCompletedId: payload['handId'] as string })
          }
          // Optimistic confirmation — if the optimistic action matches
          // any payload describing the same seat's action, drop it.
          const shadow = get().optimisticShadow
          if (
            shadow &&
            typeof payload['seat'] === 'number' &&
            payload['seat'] === shadow.seat &&
            typeof payload['action'] === 'string'
          ) {
            set({ optimisticShadow: null })
          }
        }
        return 'applied'
      }
      case 's2c.error': {
        const err = msg as S2CError
        set({ lastError: { code: err.code, message: err.message } })
        return 'applied'
      }
      case 's2c.kicked': {
        const k = msg as S2CKicked
        const reason = String(k.reason)
        // 'handoff' downgrades to spectator (server keeps socket open).
        set({
          kickedReason: reason,
          status: reason === 'handoff' ? 'spectator' : 'closed',
        })
        return 'applied'
      }
      default:
        return 'ignored'
    }
  },
})

export const useTableStore = create<TableStore>(creator)

/** Headless factory for tests — makes a fresh store, never registers a
 *  React subscription. */
export function createTableStore() {
  return create<TableStore>(creator)
}

/** Helper: build the c2s.join frame the page sends after a snapshot
 *  request, using the store's lastSeq. */
export function buildResumeJoin(tableId: string, lastSeq: number): ClientMessage {
  return { t: 'c2s.join', tableId, lastSeq } as ClientMessage
}
