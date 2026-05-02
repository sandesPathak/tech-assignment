'use strict';

/**
 * Matchmaker — auto-spawn + idle cleanup.
 *
 * Drives `matchmaker.tick()` deterministically (no setInterval) so the
 * test owns the clock for idle TTL assertions.
 */

const RedisMock = require('ioredis-mock');
const {
  Matchmaker,
  OPEN_SEATS_THRESHOLD_DEFAULT,
  IDLE_TTL_MS_DEFAULT,
} = require('../src/matchmaker');
const { listStakes } = require('@hijack/protocol/stakes');
const { StateStore } = require('../src/state-store');
const { MemoryHandEventStore } = require('../src/hand-event-store');

async function bootStore() {
  const redis = new RedisMock();
  await redis.flushall();
  const eventStore = new MemoryHandEventStore();
  await eventStore.init();
  const stateStore = new StateStore({ redis, eventStore });
  return { redis, stateStore };
}

describe('Matchmaker', () => {
  test('spawns a fresh table per stake on first tick when none exist', async () => {
    const { redis, stateStore } = await bootStore();
    const mm = new Matchmaker({ redis, stateStore });

    const summary = await mm.tick();
    expect(summary.spawned).toBe(listStakes().length);
    expect(summary.removed).toBe(0);

    for (const stake of listStakes()) {
      const z = await redis.zrange(`lobby:${stake.id}:tables`, 0, -1, 'WITHSCORES');
      expect(z.length).toBe(2); // [tableId, openSeats]
      expect(Number(z[1])).toBe(stake.maxSeats);
      const meta = await redis.hgetall(`table:${z[0]}:meta`);
      expect(meta.stake).toBe(stake.id);
      expect(Number(meta.maxSeats)).toBe(stake.maxSeats);
      expect(Number(meta.smallBlind)).toBe(stake.smallBlind);
    }
  });

  test('does not spawn when open-seat threshold is already met', async () => {
    const { redis, stateStore } = await bootStore();
    const mm = new Matchmaker({ redis, stateStore });

    await mm.tick(); // initial spawn
    const before = await Promise.all(
      listStakes().map((s) => redis.zrange(`lobby:${s.id}:tables`, 0, -1))
    );
    const summary = await mm.tick();
    expect(summary.spawned).toBe(0);
    const after = await Promise.all(
      listStakes().map((s) => redis.zrange(`lobby:${s.id}:tables`, 0, -1))
    );
    expect(after).toEqual(before);
  });

  test('respawns when total open seats drops below threshold', async () => {
    const { redis, stateStore } = await bootStore();
    const mm = new Matchmaker({ redis, stateStore, openSeatsThreshold: 2 });
    await mm.tick();
    // Manually shrink one stake's tables to 1 open seat.
    const stake = listStakes()[0];
    const tables = await redis.zrange(`lobby:${stake.id}:tables`, 0, -1);
    await redis.zadd(`lobby:${stake.id}:tables`, 1, tables[0]);

    const summary = await mm.tick();
    expect(summary.spawned).toBeGreaterThanOrEqual(1);
  });

  test('cleans up empty idle tables after IDLE_TTL_MS', async () => {
    const { redis, stateStore } = await bootStore();
    let now = 1_000_000_000_000;
    const mm = new Matchmaker({
      redis,
      stateStore,
      now: () => now,
      idleTtlMs: 5 * 60 * 1000,
    });
    await mm.tick();

    const stake = listStakes()[0];
    const tables = await redis.zrange(`lobby:${stake.id}:tables`, 0, -1);
    const tableId = tables[0];

    // Force lastActivity into the past beyond the TTL.
    await redis.hset(`table:${tableId}:meta`, 'lastActivityMs', String(now - 6 * 60 * 1000));

    const summary = await mm.tick();
    expect(summary.removed).toBeGreaterThanOrEqual(1);
    const stillThere = await redis.exists(`table:${tableId}:meta`);
    expect(stillThere).toBe(0);
  });

  test('purges expired seat reservations during cleanup', async () => {
    const { redis, stateStore } = await bootStore();
    let now = 1_000_000_000_000;
    const mm = new Matchmaker({ redis, stateStore, now: () => now });
    await mm.tick();
    const stake = listStakes()[0];
    const tables = await redis.zrange(`lobby:${stake.id}:tables`, 0, -1);
    const tableId = tables[0];

    // Plant an expired reservation in the seats hash.
    await redis.hset(
      `table:${tableId}:seats`,
      '1',
      `someUser|tok-x|${now - 1}` // already expired
    );
    await mm.tick();
    const seats = await redis.hgetall(`table:${tableId}:seats`);
    expect(seats['1']).toBeUndefined();
    // Open seat count should still equal maxSeats since the expired
    // reservation was reclaimed.
    const score = await redis.zscore(`lobby:${stake.id}:tables`, tableId);
    expect(Number(score)).toBe(stake.maxSeats);
  });
});
