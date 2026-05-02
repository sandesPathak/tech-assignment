'use strict';

/**
 * matchmaker.js — periodic scan that keeps every stake supplied with at
 * least one open-enough table and culls long-idle empty tables.
 *
 * Spawn rule:
 *   For each stake S, sum open seats across `lobby:S:tables`. If the sum
 *   is < `OPEN_SEATS_THRESHOLD`, allocate a new tableId and provision it:
 *     - HSET `table:{id}:meta`        stake, name, maxSeats, blinds, lastActivityMs
 *     - ZADD `lobby:{stake}:tables`   { score: maxSeats, member: tableId }
 *     - StateStore.initTable(...)     fresh poker engine state
 *     - PUBLISH `lobby:{stake}:events`  table_added delta
 *
 * Cleanup rule:
 *   For each table whose seats hash is empty AND `lastActivityMs` is older
 *   than `IDLE_TTL_MS`, drop everything: ZREM, DEL meta+seats+state. Publish
 *   `table_removed`.
 *
 * Determinism: tableIds use `INCR lobby:next-table-id` so allocations
 * are unique under concurrent worker instances.
 */

const crypto = require('crypto');
const { listStakes, getStake } = require('@hijack/protocol/stakes');
const { GAME_HAND, PLAYER_STATUS } = require('@hijack/engine');

const SCAN_INTERVAL_MS_DEFAULT = 5_000;
const OPEN_SEATS_THRESHOLD_DEFAULT = 3;
const IDLE_TTL_MS_DEFAULT = 5 * 60 * 1000; // 5 min
const NEXT_TABLE_ID_KEY = 'lobby:next-table-id';

const seatsKey   = (tableId) => `table:${tableId}:seats`;
const tableKey   = (stake)   => `lobby:${stake}:tables`;
const metaKey    = (tableId) => `table:${tableId}:meta`;
const eventsCh   = (stake)   => `lobby:${stake}:events`;

class Matchmaker {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} opts.redis
   * @param {object} opts.stateStore     @hijack/worker StateStore
   * @param {number} [opts.scanIntervalMs]
   * @param {number} [opts.openSeatsThreshold]
   * @param {number} [opts.idleTtlMs]
   * @param {(...args: any[]) => void} [opts.log]
   * @param {() => number} [opts.now]    test-injection clock
   */
  constructor(opts) {
    if (!opts.redis) throw new Error('Matchmaker: redis required');
    if (!opts.stateStore) throw new Error('Matchmaker: stateStore required');
    this.redis = opts.redis;
    this.stateStore = opts.stateStore;
    this.scanIntervalMs = opts.scanIntervalMs ?? SCAN_INTERVAL_MS_DEFAULT;
    this.threshold = opts.openSeatsThreshold ?? OPEN_SEATS_THRESHOLD_DEFAULT;
    this.idleTtlMs = opts.idleTtlMs ?? IDLE_TTL_MS_DEFAULT;
    this.log = opts.log || (() => {});
    this.now = opts.now || (() => Date.now());
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickSafely(), this.scanIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tickSafely() {
    if (this.running) return; // overlapping ticks would double-spawn
    this.running = true;
    try {
      await this.tick();
    } catch (err) {
      this.log('matchmaker_tick_failed', { err: err.message });
    } finally {
      this.running = false;
    }
  }

  /**
   * One scan pass — exposed for tests so they can drive it deterministically.
   * Returns a summary `{ spawned, removed }` for the caller to assert against.
   */
  async tick() {
    let spawned = 0;
    let removed = 0;
    for (const stake of listStakes()) {
      const summary = await this.scanStake(stake);
      spawned += summary.spawned;
      removed += summary.removed;
    }
    return { spawned, removed };
  }

  async scanStake(stake) {
    const stakeId = stake.id;
    const tablesWithScores = await this.redis.zrange(tableKey(stakeId), 0, -1, 'WITHSCORES');
    const tableIds = [];
    let openSum = 0;
    for (let i = 0; i < tablesWithScores.length; i += 2) {
      tableIds.push(tablesWithScores[i]);
      openSum += Number(tablesWithScores[i + 1]);
    }

    let removed = 0;
    for (const tableId of tableIds) {
      // eslint-disable-next-line no-await-in-loop
      const cleaned = await this._maybeCleanup(stakeId, tableId);
      if (cleaned) removed += 1;
    }

    let spawned = 0;
    // Re-read the open-seat sum after cleanup (cheap call, single ZCARD).
    if (removed > 0) {
      const after = await this.redis.zrange(tableKey(stakeId), 0, -1, 'WITHSCORES');
      openSum = 0;
      for (let i = 1; i < after.length; i += 2) openSum += Number(after[i]);
    }
    while (openSum < this.threshold) {
      // eslint-disable-next-line no-await-in-loop
      const created = await this._spawn(stake);
      if (!created) break;
      spawned += 1;
      openSum += stake.maxSeats;
    }

    return { spawned, removed };
  }

  async _maybeCleanup(stakeId, tableId) {
    const seats = await this.redis.hgetall(seatsKey(tableId));
    const now = this.now();

    // Purge stale (TTL-expired) reservations from the seats hash so the
    // open-seat count stays truthful.
    let liveCount = 0;
    const stalePipeline = this.redis.pipeline();
    let staleCount = 0;
    for (const [seat, value] of Object.entries(seats)) {
      const expiresAt = parseExpiresAt(value);
      if (expiresAt > now) {
        liveCount += 1;
      } else if (value && value !== '') {
        stalePipeline.hdel(seatsKey(tableId), seat);
        staleCount += 1;
      }
    }
    if (staleCount > 0) await stalePipeline.exec();

    const metaRaw = await this.redis.hgetall(metaKey(tableId));
    const maxSeats = Number(metaRaw.maxSeats || 0);
    const lastActivityMs = Number(metaRaw.lastActivityMs || 0);

    if (maxSeats > 0) {
      const openSeats = maxSeats - liveCount;
      await this.redis.zadd(tableKey(stakeId), openSeats, tableId);
    }

    const idleMs = now - lastActivityMs;
    if (liveCount === 0 && idleMs > this.idleTtlMs) {
      // Delete table + publish removal.
      await this.redis.del(seatsKey(tableId), metaKey(tableId), `table:${tableId}`);
      await this.redis.zrem(tableKey(stakeId), tableId);
      await this.redis.publish(
        eventsCh(stakeId),
        JSON.stringify({ t: 'table_removed', tableId })
      );
      this.log('table_removed', { tableId, idleMs });
      return true;
    }
    return false;
  }

  async _spawn(stake) {
    const tableId = await this._allocTableId(stake.id);
    if (!tableId) return null;

    const now = this.now();
    const meta = {
      stake: stake.id,
      name: stake.name + ' #' + tableId,
      maxSeats: String(stake.maxSeats),
      smallBlind: String(stake.smallBlind),
      bigBlind: String(stake.bigBlind),
      minBuyIn: String(stake.minBuyIn),
      maxBuyIn: String(stake.maxBuyIn),
      lastActivityMs: String(now),
      createdAtMs: String(now),
    };

    // Provision lobby + meta atomically. The state-store init below is
    // idempotent and tolerates re-runs, so a partial failure here is safe.
    const pipe = this.redis.pipeline();
    pipe.hset(metaKey(tableId), meta);
    pipe.zadd(tableKey(stake.id), stake.maxSeats, tableId);
    pipe.publish(
      eventsCh(stake.id),
      JSON.stringify({
        t: 'table_added',
        tableId,
        name: meta.name,
        openSeats: stake.maxSeats,
        maxSeats: stake.maxSeats,
        smallBlind: stake.smallBlind,
        bigBlind: stake.bigBlind,
      })
    );
    await pipe.exec();

    // Initialize engine state — same shape used by gateway test helpers.
    const initialState = makeInitialEngineState(tableId, stake);
    await this.stateStore.initTable(tableId, initialState);

    this.log('table_spawned', { stake: stake.id, tableId });
    return tableId;
  }

  async _allocTableId(stakeId) {
    const n = await this.redis.incr(NEXT_TABLE_ID_KEY);
    return `${stakeId}-${n}`;
  }
}

function parseExpiresAt(value) {
  if (!value || typeof value !== 'string') return 0;
  const parts = value.split('|');
  if (parts.length < 3) return 0;
  return Number(parts[2]) || 0;
}

function makeInitialEngineState(tableId, stake) {
  return {
    game: {
      id: crypto.randomBytes(6).toString('hex'),
      tableId,
      gameNo: 1,
      handStep: GAME_HAND.GAME_PREP,
      dealerSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 0,
      communityCards: [],
      pot: 0,
      currentBet: 0,
      sidePots: [],
      move: 0,
      status: 'pending',
      smallBlind: stake.smallBlind,
      bigBlind: stake.bigBlind,
      maxSeats: stake.maxSeats,
      deck: [],
      winners: [],
    },
    players: [],
  };
}

module.exports = {
  Matchmaker,
  SCAN_INTERVAL_MS_DEFAULT,
  OPEN_SEATS_THRESHOLD_DEFAULT,
  IDLE_TTL_MS_DEFAULT,
  NEXT_TABLE_ID_KEY,
  seatsKey,
  tableKey,
  metaKey,
  eventsCh,
  parseExpiresAt,
  makeInitialEngineState,
  PLAYER_STATUS,
};
