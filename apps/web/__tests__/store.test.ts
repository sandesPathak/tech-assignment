// store.test.ts — table-state reducer.
//
// Coverage:
//   - applyServerMessage('s2c.snapshot') resets the seq baseline.
//   - applyServerMessage('s2c.delta') applies sequential frames.
//   - A gap (seq > lastSeq + 1) returns 'snapshot_request'.
//   - Optimistic shadow clears when a matching delta arrives.
//   - 's2c.kicked' with reason 'handoff' transitions to spectator status.
//   - 's2c.error' captures the last error.

import { createTableStore, buildResumeJoin } from '../lib/store'
import type {
  S2CSnapshot,
  S2CDelta,
  S2CKicked,
  S2CError,
} from '@hijack/protocol'

describe('TableStore.applyServerMessage', () => {
  test('snapshot resets seq + state', () => {
    const useStore = createTableStore()
    const store = useStore.getState()
    store.attachTable('t1')
    const snap: S2CSnapshot = {
      t: 's2c.snapshot',
      tableId: 't1',
      seq: 12,
      state: { players: [] },
    }
    expect(store.applyServerMessage(snap)).toBe('applied')
    const s = useStore.getState()
    expect(s.lastSeq).toBe(12)
    expect(s.snapshot).toEqual({ players: [] })
    expect(s.desynced).toBe(false)
  })

  test('contiguous delta advances lastSeq', () => {
    const useStore = createTableStore()
    useStore.getState().applyServerMessage({
      t: 's2c.snapshot',
      tableId: 't1',
      seq: 5,
      state: {},
    } as S2CSnapshot)
    const delta: S2CDelta = {
      t: 's2c.delta',
      tableId: 't1',
      seq: 6,
      step: 1,
      payload: { kind: 'fold', seat: 1 },
    }
    expect(useStore.getState().applyServerMessage(delta)).toBe('applied')
    expect(useStore.getState().lastSeq).toBe(6)
    expect(useStore.getState().events.length).toBe(1)
  })

  test('gap → snapshot_request', () => {
    const useStore = createTableStore()
    useStore.getState().applyServerMessage({
      t: 's2c.snapshot',
      tableId: 't1',
      seq: 5,
      state: {},
    } as S2CSnapshot)
    const delta: S2CDelta = {
      t: 's2c.delta',
      tableId: 't1',
      seq: 9, // gap — we expected 6
      step: 1,
      payload: {},
    }
    expect(useStore.getState().applyServerMessage(delta)).toBe('snapshot_request')
    expect(useStore.getState().desynced).toBe(true)
    expect(useStore.getState().pendingSeq).toBe(9)
    // Subsequent snapshot resync clears it.
    useStore.getState().applyServerMessage({
      t: 's2c.snapshot',
      tableId: 't1',
      seq: 10,
      state: { resynced: true },
    } as S2CSnapshot)
    expect(useStore.getState().desynced).toBe(false)
    expect(useStore.getState().pendingSeq).toBe(null)
  })

  test('duplicate seq is ignored', () => {
    const useStore = createTableStore()
    useStore.getState().applyServerMessage({
      t: 's2c.snapshot',
      tableId: 't1',
      seq: 5,
      state: {},
    } as S2CSnapshot)
    const result = useStore.getState().applyServerMessage({
      t: 's2c.delta',
      tableId: 't1',
      seq: 5, // already applied via snapshot
      step: 1,
      payload: {},
    } as S2CDelta)
    expect(result).toBe('ignored')
  })

  test('optimistic shadow clears on matching delta', () => {
    const useStore = createTableStore()
    useStore.getState().applyServerMessage({
      t: 's2c.snapshot',
      tableId: 't1',
      seq: 5,
      state: {},
    } as S2CSnapshot)
    useStore.getState().setOptimistic({
      id: 'opt1',
      seat: 2,
      kind: 'fold',
    })
    expect(useStore.getState().optimisticShadow).not.toBeNull()
    useStore.getState().applyServerMessage({
      t: 's2c.delta',
      tableId: 't1',
      seq: 6,
      step: 1,
      payload: { kind: 'action', seat: 2, action: 'fold' },
    } as S2CDelta)
    expect(useStore.getState().optimisticShadow).toBeNull()
  })

  test('hand_completed kind sets handCompletedId for the coach panel', () => {
    const useStore = createTableStore()
    useStore.getState().applyServerMessage({
      t: 's2c.snapshot',
      tableId: 't1',
      seq: 0,
      state: {},
    } as S2CSnapshot)
    useStore.getState().applyServerMessage({
      t: 's2c.delta',
      tableId: 't1',
      seq: 1,
      step: -1,
      payload: { kind: 'hand_completed', handId: 'h_42' },
    } as S2CDelta)
    expect(useStore.getState().handCompletedId).toBe('h_42')
  })

  test('s2c.kicked handoff → spectator', () => {
    const useStore = createTableStore()
    useStore.getState().attachTable('t1')
    useStore.getState().applyServerMessage({
      t: 's2c.kicked',
      reason: 'handoff',
    } as S2CKicked)
    expect(useStore.getState().status).toBe('spectator')
    expect(useStore.getState().kickedReason).toBe('handoff')
  })

  test('s2c.error captured + clearable', () => {
    const useStore = createTableStore()
    useStore.getState().applyServerMessage({
      t: 's2c.error',
      code: 'shard_saturated',
      message: 'shard at capacity',
    } as S2CError)
    expect(useStore.getState().lastError?.code).toBe('shard_saturated')
    useStore.getState().clearError()
    expect(useStore.getState().lastError).toBeNull()
  })
})

describe('buildResumeJoin', () => {
  test('produces a c2s.join frame with lastSeq', () => {
    const m = buildResumeJoin('t1', 42)
    expect(m).toEqual({ t: 'c2s.join', tableId: 't1', lastSeq: 42 })
  })
})
