'use strict';

/**
 * lobby.js — REST list + WS topic for the per-stake lobby.
 *
 * Two surfaces:
 *
 *   GET /lobby/:stake
 *     One-shot table listing for browser bootstrap. Returns:
 *       { stake, meta, tables: [{ tableId, name, openSeats, maxSeats, ... }] }
 *
 *   WS topic `lobby:{stake}`
 *     Subscribed via `c2s.lobby_subscribe`. Pushes `s2c.lobby_state` once
 *     (the initial snapshot), then `s2c.lobby_delta` frames forwarded from
 *     Redis pub/sub channel `lobby:{stake}:events`.
 *
 * Sources of truth:
 *   - `lobby:{stake}:tables`  ZSET    tableId -> openSeats   (matchmaker writes)
 *   - `table:{id}:meta`       HASH    blinds, name, maxSeats (matchmaker writes)
 *   - `lobby:{stake}:events`  pub/sub deltas published by Lua + matchmaker
 *
 * The lobby store reads are rare (page-load / reconnect); the hot path
 * is pub/sub. We don't cache table meta in-process — let Redis be the
 * cache.
 */

const { listStakes, getStake } = require('@hijack/protocol/stakes');
const {
  S2C,
  lobbyState,
  lobbyDelta,
} = require('@hijack/protocol/messages');

const stakeChannel = (stake) => `lobby:${stake}:events`;
const stakeTablesKey = (stake) => `lobby:${stake}:tables`;
const tableMetaKey = (tableId) => `table:${tableId}:meta`;

class LobbyManager {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} opts.redis
   * @param {() => import('ioredis').Redis} opts.subscriberFactory
   * @param {(...args: any[]) => void} [opts.log]
   */
  constructor(opts) {
    this.redis = opts.redis;
    this.subFactory = opts.subscriberFactory;
    this.log = opts.log || (() => {});
    /** @type {Map<string, Set<(msg: object) => void>>} */
    this.listeners = new Map();
    /** @type {Map<string, Function>} stake -> unsubscribe-from-redis */
    this.redisSubs = new Map();
    /** @type {import('ioredis').Redis|null} */
    this.subscriber = null;
  }

  async start() {
    if (this.subscriber) return;
    this.subscriber = this.subFactory();
    this.subscriber.on('message', (channel, payload) => {
      const stake = channelToStake(channel);
      if (!stake) return;
      let parsed;
      try { parsed = JSON.parse(payload); } catch (_e) { return; }
      const delta = lobbyDelta(stake, parsed.t || 'unknown', parsed);
      const set = this.listeners.get(stake);
      if (!set) return;
      for (const fn of set) {
        try { fn(delta); } catch (_e) { /* swallow — fan-out must not die */ }
      }
    });
  }

  async stop() {
    for (const [, off] of this.redisSubs) off();
    this.redisSubs.clear();
    this.listeners.clear();
    if (this.subscriber) {
      try { this.subscriber.disconnect(); } catch (_e) {}
      this.subscriber = null;
    }
  }

  /**
   * Read the current table list for `stake` from Redis.
   * Returns `{ stake, meta, tables }` or `null` if the stake is unknown.
   */
  async listTables(stake, playerId = null) {
    const meta = getStake(stake);
    if (!meta) return null;
    // ZRANGE with WITHSCORES gives [tableId1, openSeats1, tableId2, ...].
    const raw = await this.redis.zrange(stakeTablesKey(stake), 0, -1, 'WITHSCORES');
    const tables = [];
    const wantedPlayerId = playerId == null ? null : String(playerId);
    for (let i = 0; i < raw.length; i += 2) {
      const tableId = raw[i];
      const openSeats = Number(raw[i + 1]);
      // Pull table meta in a pipelined batch — the result is small.
      // Fall back to stake defaults if the meta hash is missing.
      // eslint-disable-next-line no-await-in-loop
      const m = await this.redis.hgetall(tableMetaKey(tableId));
      let heroSeated = false;
      if (wantedPlayerId) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const playersRaw = await this.redis.hget(`table:${tableId}`, 'players');
          if (playersRaw) {
            const players = JSON.parse(playersRaw);
            heroSeated = Array.isArray(players)
              && players.some((p) => String(p.playerId) === wantedPlayerId);
          }
        } catch (_e) { /* best-effort */ }
      }
      tables.push({
        tableId,
        name: m.name || `Table ${tableId}`,
        openSeats,
        maxSeats: Number(m.maxSeats || meta.maxSeats),
        smallBlind: Number(m.smallBlind || meta.smallBlind),
        bigBlind: Number(m.bigBlind || meta.bigBlind),
        heroSeated,
      });
    }
    return { stake, meta, tables };
  }

  /**
   * REST handler — used by `apps/gateway/src/index.js` to serve
   * `GET /lobby/:stake`. Caller already parsed the URL.
   */
  async handleRestList(stake, res, opts = {}) {
    const data = await this.listTables(stake, opts.playerId || null);
    if (!data) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown_stake' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Subscribe a per-WS callback to lobby deltas for `stake`.
   * The first subscriber for a stake also wires the Redis SUBSCRIBE.
   * Returns an unsubscribe fn.
   */
  subscribe(stake, fn) {
    let set = this.listeners.get(stake);
    if (!set) {
      set = new Set();
      this.listeners.set(stake, set);
      this._subscribeRedis(stake);
    }
    set.add(fn);
    return () => {
      const s = this.listeners.get(stake);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.listeners.delete(stake);
        const off = this.redisSubs.get(stake);
        if (off) { off(); this.redisSubs.delete(stake); }
      }
    };
  }

  _subscribeRedis(stake) {
    if (!this.subscriber) return;
    const channel = stakeChannel(stake);
    this.subscriber.subscribe(channel).catch((err) => {
      this.log('lobby_subscribe_failed', { stake, err: err.message });
    });
    this.redisSubs.set(stake, () => {
      try { this.subscriber.unsubscribe(channel); } catch (_e) {}
    });
  }

  /**
   * Build the initial `s2c.lobby_state` frame for a freshly-subscribed WS.
   */
  async makeStateFrame(stake) {
    const data = await this.listTables(stake);
    if (!data) return null;
    return lobbyState(stake, data.tables);
  }

  /** All known stakes (for `GET /lobby`). */
  allStakes() {
    return listStakes();
  }
}

function channelToStake(channel) {
  const m = channel.match(/^lobby:(.+):events$/);
  return m ? m[1] : null;
}

module.exports = {
  LobbyManager,
  stakeChannel,
  stakeTablesKey,
  tableMetaKey,
  channelToStake,
  S2C,
};
