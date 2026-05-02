'use strict';

/**
 * gen-preflop-chart.js — bake `apps/coach/src/preflop-chart.json`.
 *
 * Source / approximation:
 *  - Modeled on published 6-max cash-game open ranges (Upswing Lab "GTO
 *    Preflop Charts", Snowie sim outputs, Pio mini-solver charts).
 *  - We approximate each position's open range by a tightness threshold
 *    on `hand-class.strength()`, plus a small set of always-open hands.
 *  - "openEv" is the chart's EV (in big blinds) for raising vs folding;
 *    "callEv" is similar for cold-call (only meaningful in BB defends).
 *  - This is a SIM, not a solve. Fine for coach-grade feedback. Real
 *    GTO ranges are mixed — the coach's prose layer leans on Claude to
 *    soften absolute statements. See README.
 *
 * Run:
 *   node apps/coach/scripts/gen-preflop-chart.js
 */

const fs = require('fs');
const path = require('path');
const { allClasses, strength } = require('../src/hand-class');

const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];

// Position thresholds — strength >= threshold opens with a raise.
// Tighter UTG, looser BTN/SB. Numbers tuned so range sizes roughly
// match published 6-max charts (UTG ~14%, MP ~17%, CO ~25%, BTN ~45%,
// SB ~35%, BB defends ~50%+).
const RAISE_THRESHOLD = {
  UTG: 0.40,
  MP:  0.36,
  CO:  0.30,
  BTN: 0.20,
  SB:  0.24,
  BB:  0.18,
};

// Hands that always open / defend regardless of threshold — covers the
// well-known "open these even from UTG" cases (any pair, broadway suited).
const ALWAYS_OPEN = new Set([
  '22', '33', '44', '55', '66', '77', '88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA',
  'AKs', 'AQs', 'AJs', 'AKo', 'AQo',
]);

// EV lookup in big blinds. Rough but monotonic with strength.
function evForOpen(s) {
  // Very strong (s ~1.0) ~= +2.0bb open EV; threshold spot ~= 0.0bb.
  return Math.round((s - 0.18) * 4 * 100) / 100;
}

function evForCall(s) {
  // Cold-calling EV is generally lower than raising. BB defend is the
  // primary case and is roughly flat near 0 with a slight tail.
  return Math.round((s - 0.30) * 2.5 * 100) / 100;
}

function buildChart() {
  const chart = {};
  for (const cls of allClasses()) {
    const s = strength(cls);
    const byPos = {};
    for (const pos of POSITIONS) {
      const thr = RAISE_THRESHOLD[pos];
      const shouldOpen = ALWAYS_OPEN.has(cls) || s >= thr;
      const action = shouldOpen ? 'raise' : (pos === 'BB' && s > 0.10 ? 'call' : 'fold');
      byPos[pos] = {
        action,
        openEv: shouldOpen ? evForOpen(s) : -0.05,
        callEv: pos === 'BB' && s > 0.10 ? evForCall(s) : -0.10,
        foldEv: 0,
      };
    }
    chart[cls] = {
      strength: Math.round(s * 1000) / 1000,
      byPos,
    };
  }
  return chart;
}

function rangeSize(chart, pos) {
  let n = 0;
  for (const cls of Object.keys(chart)) {
    if (chart[cls].byPos[pos].action === 'raise') n += 1;
  }
  return n;
}

function main() {
  const chart = buildChart();
  const meta = {
    source: 'Hijack Poker simplified 6-max GTO chart. Approximation level: ' +
      'tightness threshold per position + always-open whitelist. Modeled on ' +
      'Upswing/Snowie published charts; see scripts/gen-preflop-chart.js.',
    generated_at: new Date().toISOString(),
    positions: POSITIONS,
    range_sizes: Object.fromEntries(POSITIONS.map((p) => [p, rangeSize(chart, p)])),
    classes: 169,
  };
  const out = { meta, chart };
  const outPath = path.join(__dirname, '..', 'src', 'preflop-chart.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} (${Object.keys(chart).length} classes)`);
  // eslint-disable-next-line no-console
  console.log('range sizes:', meta.range_sizes);
}

if (require.main === module) main();

module.exports = { buildChart, POSITIONS };
