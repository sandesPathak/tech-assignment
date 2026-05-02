'use strict';

const { CoachCache, situationHash, bucketStack, canonicalActionHistory, canonicalBoard } = require('../src/cache');

describe('situationHash', () => {
  it('is stable for identical inputs', () => {
    const ctx = { stack_bb: 100, position: 'BTN', hole_class: 'AKs', action_history: [], board: [] };
    expect(situationHash(ctx)).toBe(situationHash(ctx));
  });

  it('differs when key fields differ', () => {
    const a = { stack_bb: 100, position: 'BTN', hole_class: 'AKs', action_history: [], board: [] };
    const b = { ...a, hole_class: 'AKo' };
    expect(situationHash(a)).not.toBe(situationHash(b));
  });

  it('collapses across buckets — 21BB and 25BB hash equal', () => {
    const a = { stack_bb: 21, position: 'BTN', hole_class: 'AA', action_history: [], board: [] };
    const b = { ...a, stack_bb: 25 };
    expect(situationHash(a)).toBe(situationHash(b));
  });

  it('canonicalizes board ordering', () => {
    expect(canonicalBoard(['AH', 'KS', 'QC'])).toBe(canonicalBoard(['KS', 'QC', 'AH']));
  });

  it('action-history canonicalization strips amounts', () => {
    expect(canonicalActionHistory([{ action: 'raise', amount: 6 }, { action: 'fold' }]))
      .toBe('r.f');
  });
});

describe('bucketStack', () => {
  it.each([
    [0, 0], [3, 0], [10, 10], [14, 10], [25, 20], [49, 30], [99, 50], [180, 100], [500, 200],
  ])('%d → %d', (in_, out) => expect(bucketStack(in_)).toBe(out));
});

describe('CoachCache', () => {
  it('hits >50% on a workload of repeated spots', async () => {
    const cache = new CoachCache(); // memory-backed by default
    const spots = [
      { stack_bb: 100, position: 'BTN', hole_class: 'AA', action_history: [], board: [] },
      { stack_bb: 100, position: 'CO', hole_class: 'KK', action_history: [], board: [] },
      { stack_bb: 100, position: 'BTN', hole_class: 'AKs', action_history: [], board: [] },
    ];

    // 30 calls — 27 of which are repeats of the first 3 distinct spots.
    for (let i = 0; i < 30; i++) {
      const spot = spots[i % spots.length];
      const hit = await cache.get(spot);
      if (!hit) {
        await cache.set(spot, { summary: 'computed', decisions: [] });
      }
    }
    const rate = cache.hitRate();
    expect(rate).toBeGreaterThan(0.5);
    // 30 calls: first 3 misses, 27 hits → 90%.
    expect(rate).toBeCloseTo(27 / 30, 2);
  });

  it('stores values with TTL when redis is provided (smoke)', async () => {
    // ioredis-mock honors EX; we just check round-trip works.
    const RedisMock = require('ioredis-mock');
    const redis = new RedisMock();
    const cache = new CoachCache({ redis, ttlSeconds: 60 });
    const spot = { stack_bb: 100, position: 'BTN', hole_class: 'AA', action_history: [], board: [] };
    expect(await cache.get(spot)).toBeNull();
    await cache.set(spot, { summary: 'x', decisions: [] });
    const v = await cache.get(spot);
    expect(v).toEqual({ summary: 'x', decisions: [] });
  });
});
