'use strict';

const RedisMock = require('ioredis-mock');
const {
  ShardMetricsReporter,
  readShardMetrics,
  isShardSaturated,
  KEY,
} = require('../src/shard-metrics');

describe('shard-metrics', () => {
  let redis;
  beforeEach(() => { redis = new RedisMock(); });
  afterEach(() => { redis.disconnect(); });

  test('reporter writes the expected fields with pipeline', async () => {
    const reporter = new ShardMetricsReporter({
      redis,
      shardId: 'shard-7',
      sampler: () => ({ tables: 12, lagMs: 4.2, lastTickTs: 1000 }),
    });
    const fields = await reporter.tick();
    expect(fields.tables).toBe('12');
    expect(Number(fields.mem_pct)).toBeGreaterThan(0);
    expect(fields.lag_ms).toBe('4.2');
    expect(fields.last_tick_ts).toBe('1000');
    const metrics = await readShardMetrics(redis, 'shard-7');
    expect(metrics.tables).toBe(12);
    expect(metrics.shardId).toBe('shard-7');
  });

  test('isShardSaturated returns true when mem_pct exceeds threshold', async () => {
    await redis.hset(KEY('shard-9'), { mem_pct: '85.0', tables: '10' });
    expect(await isShardSaturated(redis, 'shard-9', 80)).toBe(true);
    expect(await isShardSaturated(redis, 'shard-9', 90)).toBe(false);
  });

  test('isShardSaturated returns false when metrics missing (fresh shard)', async () => {
    expect(await isShardSaturated(redis, 'unknown-shard', 80)).toBe(false);
  });
});
