'use strict';

/**
 * seat-claim.js — Gateway-side wrapper around the atomic Redis Lua script.
 *
 * The Lua source (`infra/redis/seat-claim.lua`) is loaded once at gateway
 * boot via `SCRIPT LOAD`. Every claim then runs through `EVALSHA` so we
 * pay a one-time wire cost for the script body and a few hundred bytes
 * per claim thereafter.
 *
 * On success we mint a short-lived JWT — the *join token* — that the
 * client presents to the worker via `c2s.join`. The token carries the
 * same reservationToken used in the Redis HASH so the worker can match
 * the seat claim 1:1; the Lua reservation is what actually guarantees
 * uniqueness.
 *
 * Idempotency: a (userId, reservationToken) pair re-running the Lua
 * script for the same seat is a no-op — the Lua refreshes the TTL and
 * still returns success. This handles client retries on flaky networks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { getStake } = require('@hijack/protocol/stakes');

const DEFAULT_RESERVATION_TTL_MS = 30_000; // 30 s — client must complete c2s.join inside this window
const DEFAULT_JOIN_TOKEN_TTL_S = 60;        // 60 s — JWT lifetime
const LUA_PATH = path.resolve(__dirname, '../../../infra/redis/seat-claim.lua');

const seatsKey   = (tableId) => `table:${tableId}:seats`;
const tableKey   = (stake)    => `lobby:${stake}:tables`;
const metaKey    = (tableId) => `table:${tableId}:meta`;
const eventsCh   = (stake)    => `lobby:${stake}:events`;

class SeatClaimError extends Error {
  constructor(reason) {
    super(reason);
    this.code = reason;
  }
}

class SeatClaimer {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} opts.redis  command client (not pub/sub)
   * @param {string} opts.secret                  JWT secret for the join token (== gateway secret)
   * @param {number} [opts.reservationTtlMs]
   * @param {number} [opts.joinTokenTtlSec]
   * @param {string} [opts.luaSource]             override the on-disk script (tests)
   */
  constructor(opts) {
    if (!opts.redis) throw new Error('SeatClaimer: redis required');
    if (!opts.secret) throw new Error('SeatClaimer: secret required');
    this.redis = opts.redis;
    this.secret = opts.secret;
    this.reservationTtlMs = opts.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
    this.joinTokenTtlSec = opts.joinTokenTtlSec ?? DEFAULT_JOIN_TOKEN_TTL_S;
    this.luaSource = opts.luaSource || fs.readFileSync(LUA_PATH, 'utf8');
    this.sha = null;
    this.evalshaUnsupported = false;
  }

  /**
   * Load the Lua script into Redis. Safe to call repeatedly — Redis
   * dedupes on the SHA. Tests can also call this through `EVALSHA`'s
   * "NOSCRIPT" fallback below.
   *
   * `ioredis-mock` doesn't implement SCRIPT/EVALSHA — we tolerate that
   * by falling back to plain `EVAL` on every call. Real Redis still
   * benefits from EVALSHA.
   */
  async load() {
    try {
      this.sha = await this.redis.script('LOAD', this.luaSource);
      this.evalshaUnsupported = false;
    } catch (err) {
      // Mock or older Redis without SCRIPT — use EVAL on every call.
      this.evalshaUnsupported = true;
      this.sha = null;
    }
    return this.sha;
  }

  /**
   * Attempt to claim `seat` on `tableId` for `userId` in `stake`.
   *
   * On success returns `{ ok: true, joinToken, reservationToken, expiresAt, openSeats }`.
   * On failure returns `{ ok: false, reason }` where reason is one of
   *   'taken' | 'no_table' | 'bad_seat' | 'unknown_stake'.
   */
  async claim({ stake, tableId, seat, userId, reservationToken }) {
    if (!getStake(stake)) {
      return { ok: false, reason: 'unknown_stake' };
    }
    const token = reservationToken || crypto.randomBytes(12).toString('hex');
    const now = Date.now();

    const args = [
      String(tableId),
      String(seat),
      String(userId),
      token,
      String(this.reservationTtlMs),
      String(now),
    ];
    const keys = [
      seatsKey(tableId),
      tableKey(stake),
      metaKey(tableId),
      eventsCh(stake),
    ];

    if (this.sha === null && !this.evalshaUnsupported) await this.load();

    let result;
    try {
      if (this.evalshaUnsupported || !this.sha) {
        result = await this.redis.eval(this.luaSource, keys.length, ...keys, ...args);
      } else {
        result = await this.redis.evalsha(this.sha, keys.length, ...keys, ...args);
      }
    } catch (err) {
      const m = String(err.message || '');
      if (m.includes('NOSCRIPT')) {
        await this.load();
        result = await this.redis.eval(this.luaSource, keys.length, ...keys, ...args);
      } else if (m.includes('Unsupported command')) {
        this.evalshaUnsupported = true;
        result = await this.redis.eval(this.luaSource, keys.length, ...keys, ...args);
      } else {
        throw err;
      }
    }

    if (!Array.isArray(result) || result.length < 2) {
      return { ok: false, reason: 'protocol_error' };
    }

    const ok = Number(result[0]) === 1;
    if (!ok) {
      return { ok: false, reason: String(result[1]) };
    }

    const expiresAt = Number(result[1]);
    const openSeats = Number(result[2]);

    const joinToken = jwt.sign(
      {
        sub: String(userId),
        tableId: String(tableId),
        seat: Number(seat),
        stake,
        reservationToken: token,
        sessionId: token, // reuse — one ws per claim
      },
      this.secret,
      { algorithm: 'HS256', expiresIn: this.joinTokenTtlSec }
    );

    return {
      ok: true,
      joinToken,
      reservationToken: token,
      expiresAt,
      openSeats,
    };
  }

  /**
   * Verify a join token sent by a client to the worker. Symmetric to
   * `claim` — returns the parsed claims or throws SeatClaimError.
   * Stateless: the source of truth is still the Redis HASH, but the
   * worker can use this for cheap pre-validation.
   */
  verifyJoinToken(joinToken) {
    try {
      return jwt.verify(joinToken, this.secret, { algorithms: ['HS256'] });
    } catch (err) {
      throw new SeatClaimError(`bad_join_token:${err.message}`);
    }
  }
}

module.exports = {
  SeatClaimer,
  SeatClaimError,
  DEFAULT_RESERVATION_TTL_MS,
  DEFAULT_JOIN_TOKEN_TTL_S,
  seatsKey,
  tableKey,
  metaKey,
  eventsCh,
};
