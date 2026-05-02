'use strict';

/**
 * equity.js — Monte Carlo equity estimator.
 *
 * For postflop spots: estimate hero's win-rate vs an opponent range
 * (or vs random) given a known board. 1000 trials per call, target
 * < 50ms wall time on a stock node:20 process.
 *
 * Implementation notes:
 *  - We use `pokersolver` (via `@hijack/engine/cards.evaluateHand`)
 *    for hand evaluation. That call is the hot path; we minimise
 *    allocation in the simulation loop.
 *  - "Range" = an array of two-card combos (already filtered to be
 *    consistent with the hero hole + board). For preflop coach calls
 *    we typically pass a sampled subset of the position's open range.
 *  - Tie counts as half-win.
 *
 * Public API:
 *   equityVsRange({ hole, board, oppRange, iterations=1000 }) -> number 0..1
 *   equityVsRandom({ hole, board, iterations=1000 }) -> number
 *   sampleHandFromRange(handClassRange) -> [c1, c2]   helper for callers
 */

const { evaluateHand, createDeck } = require('@hijack/engine');

const FULL_DECK = createDeck();

function deckMinus(used) {
  const set = new Set(used);
  const out = [];
  for (const c of FULL_DECK) if (!set.has(c)) out.push(c);
  return out;
}

function pickIndex(rng, max) {
  if (max <= 0) return 0;
  // Clamp to [0, max-1] — guards against pathological rngs that
  // can return exactly 1.0 (some LCG variants do).
  const i = Math.floor(rng() * max);
  return i >= max ? max - 1 : i;
}

/**
 * Fisher-Yates partial shuffle: extract `n` distinct elements from
 * `src` (in place — caller passes a fresh array each call).
 */
function pickN(src, n, rng) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = i + pickIndex(rng, src.length - i);
    const tmp = src[i];
    src[i] = src[j];
    src[j] = tmp;
    out[i] = src[i];
  }
  return out;
}

function rankIntFromHand(cards) {
  // pokersolver.rank is 1..10 (10=Royal Flush). We use it as the
  // primary ordering and break ties by `descr` lexicographic? No —
  // pokersolver provides Hand.winners which handles ties properly.
  // Here we delegate to evaluateHand and compare numerically.
  return evaluateHand(cards).rank;
}

/**
 * Compare two 5-7-card hands. Returns 1 if a wins, -1 if b wins, 0 tie.
 * Falls back on pokersolver when ranks tie (kickers).
 */
function compareHands(a, b) {
  const ra = evaluateHand(a);
  const rb = evaluateHand(b);
  if (ra.rank !== rb.rank) return ra.rank > rb.rank ? 1 : -1;
  // Same hand category — compare the 5-card descriptor strings via
  // pokersolver Hand.winners for accuracy. We re-import to avoid a
  // circular dep on @hijack/engine internals.
  const { Hand } = require('pokersolver');
  const { toPokersolver } = require('@hijack/engine');
  const ha = Hand.solve(a.map(toPokersolver));
  const hb = Hand.solve(b.map(toPokersolver));
  const winners = Hand.winners([ha, hb]);
  if (winners.length === 2) return 0;
  return winners[0] === ha ? 1 : -1;
}

/**
 * Estimate hero equity vs a fixed opponent range on a (possibly
 * partial) board. Returns a number in [0, 1].
 *
 * @param {object} opts
 * @param {string[]} opts.hole       2 hero hole cards (engine format)
 * @param {string[]} [opts.board]    0-5 community cards
 * @param {string[][]} opts.oppRange array of 2-card combos
 * @param {number} [opts.iterations] default 1000
 * @param {() => number} [opts.rng]  default Math.random
 */
function equityVsRange({ hole, board = [], oppRange, iterations = 1000, rng = Math.random }) {
  if (!Array.isArray(hole) || hole.length !== 2) throw new Error('hole must be 2 cards');
  if (!Array.isArray(oppRange) || oppRange.length === 0) {
    return equityVsRandom({ hole, board, iterations, rng });
  }
  const heroUsed = [...hole, ...board];
  const heroSet = new Set(heroUsed);
  // Pre-filter combos that conflict with hero hole + board.
  const validOpp = oppRange.filter(([a, b]) => !heroSet.has(a) && !heroSet.has(b) && a !== b);
  if (validOpp.length === 0) return 0.5;

  let wins = 0;
  let ties = 0;
  for (let i = 0; i < iterations; i++) {
    const opp = validOpp[pickIndex(rng, validOpp.length)];
    const used = [...heroUsed, opp[0], opp[1]];
    const remaining = deckMinus(used);
    const fillN = 5 - board.length;
    const draw = fillN > 0 ? pickN(remaining, fillN, rng) : [];
    const finalBoard = board.concat(draw);
    const cmp = compareHands([...hole, ...finalBoard], [opp[0], opp[1], ...finalBoard]);
    if (cmp > 0) wins += 1;
    else if (cmp === 0) ties += 1;
  }
  return (wins + ties / 2) / iterations;
}

/**
 * Equity vs a uniformly random opposing hand. Cheaper baseline used
 * when no range is available (or as a sanity check).
 */
function equityVsRandom({ hole, board = [], iterations = 1000, rng = Math.random }) {
  const heroUsed = [...hole, ...board];
  let wins = 0;
  let ties = 0;
  for (let i = 0; i < iterations; i++) {
    const remaining = deckMinus(heroUsed);
    // Draw opp 2 + remaining board cards from a single fresh shuffle.
    const fillN = 5 - board.length;
    const drawn = pickN(remaining, 2 + fillN, rng);
    const oppHole = [drawn[0], drawn[1]];
    const draw = drawn.slice(2);
    const finalBoard = board.concat(draw);
    const cmp = compareHands([...hole, ...finalBoard], [...oppHole, ...finalBoard]);
    if (cmp > 0) wins += 1;
    else if (cmp === 0) ties += 1;
  }
  return (wins + ties / 2) / iterations;
}

module.exports = {
  equityVsRange,
  equityVsRandom,
  compareHands,
  rankIntFromHand,
};
