'use strict';

/**
 * cache.js — situation-keyed coach result cache.
 *
 * Key: a stable hash of the decision context — same situation, same
 * coaching output. Repeated spots (e.g. UTG opens AA again, BB defends
 * QJs again) skip the LLM round-trip entirely.
 *
 * Bucketing fields (chosen for compression without losing signal):
 *  - stack_depth_bucket  ints in BB: 0,5,10,15,20,30,50,100,200+
 *  - position            "UTG"/"MP"/"CO"/"BTN"/"SB"/"BB"
 *  - action_history_canonical  e.g. "f.f.r.f.c"  (preflop limp/raise pattern)
 *  - board               canonical sorted board "AhKsQc" or "" for preflop
 *  - hole_class          169-class label "AA","AKs","T9o" etc.
 *
 * Backed by Redis (TTL 1h by default). Falls back to an in-memory Map
 * for unit tests / dev.
 */

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 60 * 60; // 1h
const KEY_PREFIX = 'coach:hit:';

const STACK_BUCKETS = [0, 5, 10, 15, 20, 30, 50, 100, 200];

function bucketStack(bb) {
  let last = STACK_BUCKETS[0];
  for (const b of STACK_BUCKETS) {
    if (bb >= b) last = b;
  }
  return last;
}

/**
 * Canonicalize the action history for keying. We strip amounts (the
 * coach EV calc captures sizing); the cache only cares about the
 * shape of the sequence.
 *   ["fold","raise","call"] -> "f.r.c"
 */
function canonicalActionHistory(actions = []) {
  const map = { fold: 'f', call: 'c', check: 'k', bet: 'b', raise: 'r', allin: 'a' };
  return actions.map((a) => map[a.action] || '?').join('.');
}

/**
 * Stable board encoding — alphabetical so AhKs == KsAh.
 */
function canonicalBoard(board = []) {
  return [...board].sort().join('');
}

/**
 * Build the situation hash from a decision context.
 *
 * @param {object} ctx
 * @param {number} ctx.stack_bb       hero stack at the moment of the decision
 * @param {string} ctx.position
 * @param {string} ctx.hole_class
 * @param {Array<{action:string}>} ctx.action_history
 * @param {string[]} [ctx.board]
 */
function situationHash(ctx) {
  const parts = [
    bucketStack(ctx.stack_bb || 0),
    ctx.position || '',
    ctx.hole_class || '',
    canonicalActionHistory(ctx.action_history || []),
    canonicalBoard(ctx.board || []),
  ];
  const raw = parts.join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

class CoachCache {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} [opts.redis]   Redis backend (production).
   * @param {number} [opts.ttlSeconds]               default 3600.
   * @param {Map<string, string>} [opts.memoryStore] inject for tests/dev.
   * @param {() => void} [opts.onHit]                metrics hook.
   * @param {() => void} [opts.onMiss]               metrics hook.
   */
  constructor(opts = {}) {
    this.redis = opts.redis || null;
    this.ttlSeconds = opts.ttlSeconds || DEFAULT_TTL_SECONDS;
    this.memoryStore = opts.memoryStore || (this.redis ? null : new Map());
    this.onHit = opts.onHit || (() => {});
    this.onMiss = opts.onMiss || (() => {});
    this.hits = 0;
    this.misses = 0;
  }

  keyFor(ctx) {
    return KEY_PREFIX + situationHash(ctx);
  }

  async get(ctx) {
    const k = this.keyFor(ctx);
    let raw;
    if (this.redis) {
      raw = await this.redis.get(k);
    } else {
      raw = this.memoryStore.get(k) || null;
    }
    if (raw) {
      this.hits += 1;
      this.onHit();
      try { return JSON.parse(raw); } catch { return null; }
    }
    this.misses += 1;
    this.onMiss();
    return null;
  }

  async set(ctx, value) {
    const k = this.keyFor(ctx);
    const raw = JSON.stringify(value);
    if (this.redis) {
      await this.redis.set(k, raw, 'EX', this.ttlSeconds);
    } else {
      this.memoryStore.set(k, raw);
    }
  }

  hitRate() {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }
}

module.exports = {
  CoachCache,
  situationHash,
  bucketStack,
  canonicalActionHistory,
  canonicalBoard,
  STACK_BUCKETS,
  DEFAULT_TTL_SECONDS,
  KEY_PREFIX,
};
