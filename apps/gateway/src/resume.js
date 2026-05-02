'use strict';

/**
 * resume.js — handle a (re)joining client.
 *
 * The client supplies `lastSeq` in `c2s.join`. Outcomes:
 *
 *   1. `lastSeq` is null/0/undefined  → fresh join, send `s2c.snapshot`.
 *   2. `lastSeq` is recent (gap ≤ MAX_REPLAY_GAP) → fetch missed events
 *      from the durable HandEventStore and replay as `s2c.delta` frames
 *      in order.
 *   3. `lastSeq` is too old → send `s2c.snapshot` to reset.
 *
 * The gap threshold MAX_REPLAY_GAP is intentionally generous (default
 * 500). The expensive part of replay is the DB scan, not the bandwidth,
 * and a 500-event window covers ≈ 25 hands at our coarse tick
 * granularity — enough for a tab that froze briefly to catch up without
 * a snapshot.
 *
 * The snapshot path reads current hot state from `stateStore.loadTable`.
 */

const MAX_REPLAY_GAP = 500;

/**
 * Compute current head-of-stream seq (per table). The state store stores
 * this as `table:{id}:seq`. Cheap, single GET.
 */
async function currentSeq(redis, tableId) {
  const v = await redis.get(`table:${tableId}:seq`);
  return v ? parseInt(v, 10) : 0;
}

/**
 * Decide between replay and snapshot, then produce the frames the caller
 * should send. Returns:
 *   { mode: 'snapshot', frame }
 *   { mode: 'replay', frames }
 *
 * `frame` and `frames` are already in `s2c.*` envelope shape.
 */
async function planResume({
  redis,
  stateStore,
  eventStore,
  tableId,
  handIdHint,
  lastSeq,
  maxReplayGap = MAX_REPLAY_GAP,
}) {
  const head = await currentSeq(redis, tableId);
  const want = Number.isFinite(lastSeq) ? Number(lastSeq) : 0;

  if (want <= 0 || head === 0 || head - want > maxReplayGap) {
    return snapshotPlan(stateStore, tableId, head);
  }

  // lastSeq is in window — try durable replay.
  const handId = handIdHint || (await deriveHandId(stateStore, tableId));
  if (!handId) {
    return snapshotPlan(stateStore, tableId, head);
  }

  // We replay events with seq > lastSeq, up to and including head.
  const events = await eventStore.range(handId, want + 1, head + 1);
  if (events.length === 0 && head > want) {
    // Gap claimed but durable store has no record — fall back.
    return snapshotPlan(stateStore, tableId, head);
  }

  const frames = events.map((ev) => ({
    t: 's2c.delta',
    tableId: String(tableId),
    seq: ev.seq,
    step: ev.step,
    payload: ev.payload,
    handId: ev.handId,
  }));
  return { mode: 'replay', frames };
}

async function snapshotPlan(stateStore, tableId, head) {
  const state = await stateStore.loadTable(tableId);
  const frame = {
    t: 's2c.snapshot',
    tableId: String(tableId),
    seq: head,
    state,
  };
  return { mode: 'snapshot', frame };
}

async function deriveHandId(stateStore, tableId) {
  const state = await stateStore.loadTable(tableId);
  if (!state || !state.game) return null;
  return `${tableId}:${state.game.gameNo}`;
}

module.exports = { planResume, currentSeq, MAX_REPLAY_GAP };
