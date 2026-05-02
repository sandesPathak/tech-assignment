'use strict';

/**
 * hand-class — collapse 1326 hole-card combos into 169 canonical
 * starting-hand classes used by the preflop chart.
 *
 *   "AA"   pocket aces
 *   "AKs"  ace-king suited
 *   "AKo"  ace-king offsuit
 *
 * Card format matches `@hijack/engine` cards.js: `${rank}${suit}` where
 * rank is one of "2".."9","10","J","Q","K","A" and suit one of "HDCS".
 */

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_INDEX = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i]));

function rankOf(card) {
  return card.slice(0, -1);
}
function suitOf(card) {
  return card.slice(-1);
}

/**
 * Canonical class for two hole cards (engine card format).
 * Pocket pair → "AA". Same suit → "AKs". Different suit → "AKo".
 * Higher card always first.
 */
function classify(holeCards) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) {
    return null;
  }
  const [a, b] = holeCards;
  const rA = rankOf(a);
  const rB = rankOf(b);
  if (rA === rB) {
    return rA + rA;
  }
  const high = RANK_INDEX[rA] >= RANK_INDEX[rB] ? rA : rB;
  const low = high === rA ? rB : rA;
  const suited = suitOf(a) === suitOf(b);
  return `${high}${low}${suited ? 's' : 'o'}`;
}

/**
 * Enumerate all 169 canonical classes in a stable order — used to
 * generate the preflop chart deterministically.
 */
function allClasses() {
  const out = [];
  for (let i = RANK_ORDER.length - 1; i >= 0; i--) {
    for (let j = RANK_ORDER.length - 1; j >= 0; j--) {
      const a = RANK_ORDER[i];
      const b = RANK_ORDER[j];
      if (i === j) {
        out.push(a + a);
      } else if (i > j) {
        out.push(`${a}${b}s`);
      } else {
        out.push(`${b}${a}o`);
      }
    }
  }
  return out;
}

/**
 * Strength score 0..1 — used by the chart generator to rank hands and
 * by the analyzer to bucket "similar" spots for the cache key.
 *
 * Heuristic: pair value dominates, then high-card sum, then suitedness
 * and connectedness. Tuned so the ordering roughly matches Sklansky
 * groups / Chen formula buckets — close enough for a sim.
 */
function strength(handClass) {
  if (!handClass) return 0;
  const isPair = handClass.length === 2;
  if (isPair) {
    const r = RANK_INDEX[handClass[0]];
    // Pairs: 22=0.55..AA=1.0
    return 0.55 + (r / 12) * 0.45;
  }
  const high = handClass[0];
  const low = handClass.slice(1, -1);
  const suited = handClass.endsWith('s');
  const hi = RANK_INDEX[high];
  const lo = RANK_INDEX[low];
  const gap = hi - lo;
  let score = (hi + lo) / 24; // 0..1 base from rank sum
  if (suited) score += 0.04;
  if (gap === 1) score += 0.03;
  if (gap === 2) score += 0.015;
  if (high === 'A') score += 0.05;
  // squash to (0, 0.6) so pairs stay above offsuit/suited combos
  return Math.min(0.6, Math.max(0, score));
}

module.exports = {
  RANK_ORDER,
  RANK_INDEX,
  classify,
  allClasses,
  strength,
};
