'use strict';

/**
 * shard-metrics.js — worker writes / gateway reads.
 *
 * Each worker owns one shard. Every 5s it pushes a small snapshot of
 * pressure metrics into Redis hash `metrics:shard:{shardId}`. The
 * gateway reads this hash on every `c2s.join` and rejects the upgrade
 * if `mem_pct` exceeds the saturation threshold.
 *
 * Hash fields:
 *   tables       int    number of live tables hosted
 *   mem_pct      float  process.memoryUsage().heapUsed / heapTotal * 100
 *   lag_ms       float  EMA of tick processing latency
 *   last_tick_ts int    epoch ms of the most recent tick
 *
 * Writes are pipelined so a 5s heartbeat costs one round-trip.
 */

const KEY = (shardId) => `metrics:shard:${shardId}`;

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_SATURATION_PCT = 80;

class ShardMetricsReporter {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} opts.redis
   * @param {string} opts.shardId
   * @param {() => { tables: number, lagMs: number, lastTickTs: number }} opts.sampler
   * @param {number} [opts.intervalMs]
   * @param {(...args: any[]) => void} [opts.log]
   */
  constructor(opts) {
    this.redis = opts.redis;
    this.shardId = String(opts.shardId);
    this.sampler = opts.sampler;
    this.intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
    this.log = opts.log || (() => {});
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log('shard_metrics_tick_failed', { err: err.message }));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const sample = this.sampler ? this.sampler() : {};
    const mem = process.memoryUsage();
    const memPct = mem.heapTotal > 0
      ? (mem.heapUsed / mem.heapTotal) * 100
      : 0;
    const fields = {
      tables: String(sample.tables ?? 0),
      mem_pct: memPct.toFixed(2),
      lag_ms: String(sample.lagMs ?? 0),
      last_tick_ts: String(sample.lastTickTs ?? Date.now()),
      shard_id: this.shardId,
    };
    const pipe = this.redis.pipeline();
    pipe.hset(KEY(this.shardId), fields);
    pipe.expire(KEY(this.shardId), 60); // stale shards drop out
    await pipe.exec();
    return fields;
  }
}

/**
 * Read the latest shard metrics. Returns `null` if the hash is missing
 * (gateway treats absent metrics as "shard up but unreporting" = allow).
 */
async function readShardMetrics(redis, shardId) {
  const h = await redis.hgetall(KEY(String(shardId)));
  if (!h || !Object.keys(h).length) return null;
  return {
    tables: Number(h.tables) || 0,
    memPct: Number(h.mem_pct) || 0,
    lagMs: Number(h.lag_ms) || 0,
    lastTickTs: Number(h.last_tick_ts) || 0,
    shardId: h.shard_id || String(shardId),
  };
}

/**
 * Returns true when the shard is over the saturation threshold.
 * Missing metrics → not saturated (we don't 503 on first boot).
 */
async function isShardSaturated(redis, shardId, threshold = DEFAULT_SATURATION_PCT) {
  const m = await readShardMetrics(redis, shardId);
  if (!m) return false;
  return m.memPct > threshold;
}

module.exports = {
  ShardMetricsReporter,
  readShardMetrics,
  isShardSaturated,
  KEY,
  DEFAULT_INTERVAL_MS,
  DEFAULT_SATURATION_PCT,
};
