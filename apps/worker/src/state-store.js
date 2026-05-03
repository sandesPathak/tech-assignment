'use strict';

const { encodeTableState, decodeTableState } = require('./codec');

/**
 * StateStore — the hot game-loop persistence layer.
 *
 * Layout in Redis:
 *   table:{id}              HASH    current encoded state
 *   table:{id}:seq          STRING  monotonic event sequence (per game/hand)
 *   table:{id}:snapshot     STRING  JSON of full state at last snapshot point
 *   table:{id}:events       LIST    tail of events since last snapshot (cap N)
 *
 * Hot loop: every advance-the-table call
 *   1. HGETALL `table:{id}` to load current state
 *   2. compute next state via engine
 *   3. pipeline: HMSET new fields + INCR seq + RPUSH event tail + LTRIM
 *      + (every Nth event) SET snapshot JSON
 *   4. async append durable event to the HandEventStore (Neon)
 *
 * Snapshot cadence: every N=16 events (= one full hand at the
 * coarse step granularity we use). Bounded replay length: at most
 * 16 events to reapply on cold start.
 *
 * State encoding: cards as ints (suit*13 + rank). See codec.js.
 * Keeps `table:{id}` hash well under the 50KB-per-table budget.
 */

const SNAPSHOT_EVERY = 16;
const EVENT_TAIL_CAP = 64;

const KEY = (tableId) => `table:${tableId}`;
const KEY_SEQ = (tableId) => `table:${tableId}:seq`;
const KEY_SNAPSHOT = (tableId) => `table:${tableId}:snapshot`;
const KEY_EVENTS = (tableId) => `table:${tableId}:events`;

class StateStore {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} opts.redis
   * @param {object} opts.eventStore HandEventStore (durable Neon/sqlite)
   * @param {number} [opts.snapshotEvery]
   */
  constructor(opts) {
    this.redis = opts.redis;
    this.eventStore = opts.eventStore;
    this.snapshotEvery = opts.snapshotEvery || SNAPSHOT_EVERY;
    this.eventTailCap = opts.eventTailCap || EVENT_TAIL_CAP;
    // Light bookkeeping for shard-metrics sampler.
    this._tableSet = new Set();
    this._lagEmaMs = 0;
    this._lastTickTs = 0;
  }

  /**
   * Snapshot of shard-level signals for the metrics reporter. Cheap —
   * we maintain three small counters in `applyTick`/`initTable`. Memory
   * percent is sampled separately by the reporter via process.memoryUsage.
   */
  sampleShardMetrics() {
    return {
      tables: this._tableSet.size,
      lagMs: this._lagEmaMs,
      lastTickTs: this._lastTickTs,
    };
  }

  /**
   * Load table state, falling back to snapshot+tail replay if the live
   * hash was lost (cold start / Redis flush).
   */
  async loadTable(tableId) {
    const hash = await this.redis.hgetall(KEY(tableId));
    if (hash && Object.keys(hash).length) {
      return decodeTableState(hash);
    }
    return this._restoreFromSnapshot(tableId);
  }

  /**
   * Initialize Redis state for a table. Used the very first time we
   * see this table, or after `resetTable`.
   */
  async initTable(tableId, state) {
    const encoded = encodeTableState({ ...state, seq: 0 });
    const pipe = this.redis.pipeline();
    pipe.del(KEY(tableId), KEY_SEQ(tableId), KEY_SNAPSHOT(tableId), KEY_EVENTS(tableId));
    pipe.hset(KEY(tableId), encoded);
    pipe.set(KEY_SEQ(tableId), 0);
    pipe.set(KEY_SNAPSHOT(tableId), JSON.stringify({ ...state, seq: 0 }));
    await pipe.exec();
    this._tableSet.add(String(tableId));
  }

  /**
   * Apply a state delta produced by one engine tick.
   *
   * All Redis writes go through a single pipeline so the hot loop
   * makes exactly one round-trip.
   *
   * @param {string|number} tableId
   * @param {object} state full new state ({ game, players })
   * @param {object} event { step, payload }
   * @param {string} handId stable id for this hand (e.g. `${tableId}:${gameNo}`)
   */
  async applyTick(tableId, state, event, handId) {
    const tickStart = Date.now();
    this._tableSet.add(String(tableId));
    const seq = await this.redis.incr(KEY_SEQ(tableId));
    const stateWithSeq = { ...state, seq };
    const encoded = encodeTableState(stateWithSeq);

    const pipe = this.redis.pipeline();
    pipe.hset(KEY(tableId), encoded);
    pipe.rpush(
      KEY_EVENTS(tableId),
      JSON.stringify({ seq, step: event.step, payload: event.payload, handId })
    );
    pipe.ltrim(KEY_EVENTS(tableId), -this.eventTailCap, -1);

    // Keep the lobby ZSET score (= openSeats) honest by deriving it from
    // the actual engine players[]. The seat-claim path decrements the
    // score on reservation, but stale reservations or aborted /sit calls
    // can leave the score out of sync — so we re-sync on every tick.
    // Cheap: 1 zadd. Reads `stake` from the meta hash (sub-millisecond).
    try {
      const meta = await this.redis.hgetall(`table:${tableId}:meta`);
      if (meta && meta.stake) {
        const maxSeats = Number(meta.maxSeats || state.game?.maxSeats || 0);
        const seated = Array.isArray(state.players) ? state.players.length : 0;
        if (maxSeats > 0) {
          const open = Math.max(0, maxSeats - seated);
          pipe.zadd(`lobby:${meta.stake}:tables`, open, String(tableId));
        }
      }
    } catch (_e) { /* best-effort */ }

    if (seq % this.snapshotEvery === 0) {
      pipe.set(KEY_SNAPSHOT(tableId), JSON.stringify(stateWithSeq));
      // Trim the in-Redis tail aggressively after a snapshot — the
      // durable record is in Neon. We keep the last few events around
      // for fast restart without a Neon round-trip.
      pipe.ltrim(KEY_EVENTS(tableId), -this.snapshotEvery, -1);
    }

    await pipe.exec();

    // Durable append. Done outside the hot pipeline so a slow Neon
    // doesn't hold the table loop. Worker awaits before the next tick
    // to preserve event ordering.
    await this.eventStore.appendEvent({
      handId,
      seq,
      step: event.step,
      payload: event.payload,
    });

    // Lag EMA for shard-metrics. alpha=0.2 — recent ticks dominate.
    const lag = Date.now() - tickStart;
    this._lagEmaMs = this._lagEmaMs === 0 ? lag : (this._lagEmaMs * 0.8 + lag * 0.2);
    this._lastTickTs = Date.now();

    return seq;
  }

  /**
   * Force a snapshot now (used at hand boundaries).
   */
  async snapshot(tableId, state) {
    const seq = state.seq != null
      ? state.seq
      : parseInt((await this.redis.get(KEY_SEQ(tableId))) || '0', 10);
    await this.redis.set(KEY_SNAPSHOT(tableId), JSON.stringify({ ...state, seq }));
  }

  /**
   * Replay snapshot + redis-tail to rebuild state in case the hash
   * was lost. Falls through to Neon tail if Redis tail is empty.
   */
  async _restoreFromSnapshot(tableId) {
    const snapStr = await this.redis.get(KEY_SNAPSHOT(tableId));
    if (!snapStr) return null;
    const snap = JSON.parse(snapStr);
    // Rehydrate the hash from snapshot so subsequent loads are fast.
    const encoded = encodeTableState(snap);
    const pipe = this.redis.pipeline();
    pipe.del(KEY(tableId));
    pipe.hset(KEY(tableId), encoded);
    pipe.set(KEY_SEQ(tableId), snap.seq || 0);
    await pipe.exec();
    return snap;
  }

  /**
   * Number of events currently held in Redis (debug/metrics).
   */
  async eventTailLength(tableId) {
    return this.redis.llen(KEY_EVENTS(tableId));
  }

  /**
   * Approximate memory footprint of the table hash, in bytes.
   * Sums encoded field values. Used to verify the < 50KB target.
   */
  async measureFootprint(tableId) {
    const h = await this.redis.hgetall(KEY(tableId));
    let bytes = 0;
    for (const [k, v] of Object.entries(h || {})) {
      bytes += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
    }
    return bytes;
  }
}

module.exports = {
  StateStore,
  SNAPSHOT_EVERY,
  KEY,
  KEY_SEQ,
  KEY_SNAPSHOT,
  KEY_EVENTS,
};
