'use strict';

/**
 * equity.test.js — Monte Carlo sanity + perf.
 */

const { equityVsRange, equityVsRandom } = require('../src/equity');

function seedRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('equityVsRandom', () => {
  it('AA preflop vs random hand wins ~85%', () => {
    const eq = equityVsRandom({ hole: ['AH', 'AD'], iterations: 1000, rng: seedRng(1) });
    expect(eq).toBeGreaterThan(0.78);
    expect(eq).toBeLessThan(0.92);
  });

  it('72o preflop vs random hand wins < 40%', () => {
    const eq = equityVsRandom({ hole: ['7H', '2D'], iterations: 1000, rng: seedRng(2) });
    expect(eq).toBeLessThan(0.40);
  });

  it('made flush on river beats most random hands', () => {
    // hero has K-high flush on a flush board; equity vs random should be > 80%.
    const eq = equityVsRandom({
      hole: ['KH', '2H'],
      board: ['AH', '7H', '3H', '9D', '4S'],
      iterations: 1000,
      rng: seedRng(3),
    });
    expect(eq).toBeGreaterThan(0.80);
  });
});

describe('equityVsRange', () => {
  it('AA vs tight range still > 70%', () => {
    const range = [['KH', 'KD'], ['QH', 'QD'], ['AH', 'KS'], ['AC', 'KH']];
    const eq = equityVsRange({
      hole: ['AC', 'AS'],
      oppRange: range,
      iterations: 1000,
      rng: seedRng(7),
    });
    expect(eq).toBeGreaterThan(0.70);
  });

  it('falls back to random when range is empty', () => {
    const eq = equityVsRange({
      hole: ['AS', 'KH'],
      oppRange: [],
      iterations: 500,
      rng: seedRng(11),
    });
    expect(eq).toBeGreaterThan(0.4);
    expect(eq).toBeLessThan(0.8);
  });
});

describe('equity perf', () => {
  it('1000-iter call completes in < 200ms (target < 50ms; loose ceiling for CI)', () => {
    const t0 = Date.now();
    equityVsRandom({ hole: ['AS', 'KS'], board: ['QH', 'JD', '10C'], iterations: 1000 });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(200);
  });
});
