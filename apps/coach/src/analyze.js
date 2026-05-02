'use strict';

/**
 * analyze.js — turn a sequence of hand_events into a structured set
 * of decision findings.
 *
 * For each decision the player made:
 *   1. Determine context: street, position, stack, action history,
 *      hole-card class, board.
 *   2. Compute EV(action_taken).
 *   3. Compute EV(best_action) — the highest-EV alternative we
 *      considered (fold / call / raise).
 *   4. Emit a structured finding with `mistake_size` (in BB) and a
 *      short structured `tag` ("overfold", "thin_call", "missed_value", ...).
 *
 * Preflop: chart lookup. Postflop: Monte Carlo equity vs a coarse
 * opponent range (top-N% by strength).
 *
 * The output is the *only* thing that gets fed to the LLM (see llm.js).
 * Hole cards are sent as their 169-class label, never raw — keeps
 * prompt-injection surface minimal and helps the cache hit rate.
 */

const { GAME_HAND, ACTION } = require('@hijack/engine');
const { classify, strength, allClasses } = require('./hand-class');
const { equityVsRange } = require('./equity');
const chartFile = require('./preflop-chart.json');

const CHART = chartFile.chart;
const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];

// Step → street label. Maps the engine's 16-step machine to the four
// betting streets the coach reasons about.
const STEP_TO_STREET = {
  [GAME_HAND.PRE_FLOP_BETTING_ROUND]: 'preflop',
  [GAME_HAND.FLOP_BETTING_ROUND]: 'flop',
  [GAME_HAND.TURN_BETTING_ROUND]: 'turn',
  [GAME_HAND.RIVER_BETTING_ROUND]: 'river',
};

/**
 * Pick a position label for `seat` given the table layout.
 * 6-max: BTN→SB→BB→UTG→MP→CO. Heads-up: SB(=BTN) and BB.
 *
 * Coarse mapping good enough for the chart lookup. Dealer and BB
 * seats come straight off the engine state.
 */
function positionFor(seat, dealerSeat, bigBlindSeat, playerCount) {
  if (playerCount <= 2) {
    return seat === dealerSeat ? 'SB' : 'BB'; // heads-up SB is BTN
  }
  // Walk back from BB.
  const order = ['BB', 'UTG', 'MP', 'CO', 'BTN', 'SB'];
  // Build an array of seats starting from BB, in playing order.
  // The exact rotation depends on the table size; for 6-max we
  // approximate using seat-distance from BB (engine encodes seats 1..N).
  if (playerCount <= 6) {
    const distance = ((seat - bigBlindSeat + playerCount) % playerCount);
    const labels6 = ['BB', 'UTG', 'MP', 'CO', 'BTN', 'SB'];
    return labels6[Math.min(distance, labels6.length - 1)] || 'CO';
  }
  // Fallback for larger tables.
  return 'MP';
}

/**
 * Extract player-decision points from a durable event stream.
 *
 * Each decision = one engine event whose payload represents a player
 * action (call/check/bet/raise/fold). We rebuild the hero's view of
 * the world at each decision moment.
 *
 * Event payload shape (from `tick.js#makePayload`):
 *   { from, to, pot, currentBet, move, community, winners }
 *
 * That payload doesn't carry the `action` taken or hole cards directly;
 * the coach is fed those via the optional `handContext` argument so
 * tests and production both supply them. (Production assembles it
 * from worker hand-state side-channel; for now we pass it in directly.)
 *
 * @param {object} handContext  full hand state (see analyzeHand below)
 * @returns {Array<object>} decisions
 */
function extractDecisions(handContext) {
  const decisions = [];
  const { players = [], events = [], hero, dealerSeat, bigBlindSeat } = handContext;
  const heroPlayer = players.find((p) => p.playerId === hero || p.guid === hero);
  if (!heroPlayer) return decisions;

  const heroSeat = heroPlayer.seat;
  const playerCount = players.length;
  const position = positionFor(heroSeat, dealerSeat, bigBlindSeat, playerCount);
  const holeClass = classify(heroPlayer.cards || heroContextCardsFromEvents(events, heroSeat));

  let currentStreet = 'preflop';
  let board = [];
  const actionHistory = [];

  for (const ev of events) {
    const street = STEP_TO_STREET[ev.step];
    if (street) currentStreet = street;
    if (Array.isArray(ev.payload?.community) && ev.payload.community.length) {
      board = ev.payload.community.slice();
    }
    if (ev.payload?.move != null && ev.actionTaken) {
      actionHistory.push({
        seat: ev.actorSeat || ev.payload.move,
        action: ev.actionTaken,
        amount: ev.actionAmount || 0,
        street: currentStreet,
      });
      // Only record the hero's decisions as "decision" findings.
      if ((ev.actorSeat || ev.payload.move) === heroSeat) {
        decisions.push({
          street: currentStreet,
          position,
          hole_class: holeClass,
          action_taken: ev.actionTaken,
          amount_taken: ev.actionAmount || 0,
          pot_before: ev.payload.pot - (ev.actionAmount || 0),
          to_call: Math.max(0, (ev.payload.currentBet || 0) - (heroPlayer.bet || 0)),
          stack_bb: Math.round((heroPlayer.stack || 0) / Math.max(1, handContext.bigBlind || 2)),
          board: street === 'preflop' ? [] : board.slice(),
          action_history: actionHistory.slice(0, -1),
        });
      }
    }
  }

  return decisions;
}

function heroContextCardsFromEvents() {
  return [];
}

/**
 * Approximate opponent range as the union of all combos within a
 * strength band. For preflop we shrink by position; for postflop we
 * widen to "top 40%" by default. Returns an array of [c1, c2] combos.
 *
 * Cheap and good enough for Monte Carlo. Real ranges are mixed; the
 * MC noise (1k iters → ~3% stderr) dominates this approximation
 * anyway.
 */
function opponentRange({ pct = 0.4 } = {}) {
  const classes = allClasses().filter((c) => strength(c) >= 1.0 - pct);
  // Expand each class into its representative combo. We don't need
  // every combo — sampling with replacement during MC is fine.
  const out = [];
  for (const cls of classes) {
    const combo = comboForClass(cls);
    if (combo) out.push(combo);
  }
  return out;
}

function comboForClass(cls) {
  const RANK_MAP = { '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
  if (!cls) return null;
  if (cls.length === 2) {
    const r = RANK_MAP[cls[0]];
    return [`${r}H`, `${r}D`];
  }
  const r1 = RANK_MAP[cls[0]];
  const r2 = RANK_MAP[cls[1]];
  if (cls.endsWith('s')) return [`${r1}H`, `${r2}H`];
  return [`${r1}H`, `${r2}D`];
}

function pickComboNotOnBoard(cls, board) {
  const RANK_MAP = { '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
  if (!cls) return null;
  const used = new Set(board || []);
  const SUITS = ['H', 'D', 'C', 'S'];
  if (cls.length === 2) {
    const r = RANK_MAP[cls[0]];
    for (const s1 of SUITS) for (const s2 of SUITS) {
      if (s1 === s2) continue;
      const a = `${r}${s1}`, b = `${r}${s2}`;
      if (!used.has(a) && !used.has(b)) return [a, b];
    }
    return null;
  }
  const r1 = RANK_MAP[cls[0]];
  const r2 = RANK_MAP[cls[1]];
  if (cls.endsWith('s')) {
    for (const s of SUITS) {
      const a = `${r1}${s}`, b = `${r2}${s}`;
      if (!used.has(a) && !used.has(b)) return [a, b];
    }
    return null;
  }
  for (const s1 of SUITS) for (const s2 of SUITS) {
    if (s1 === s2) continue;
    const a = `${r1}${s1}`, b = `${r2}${s2}`;
    if (!used.has(a) && !used.has(b)) return [a, b];
  }
  return null;
}

/**
 * Compute EV for the hero's decision and the best alternative.
 *
 * Preflop: chart lookup. The chart's openEv/callEv/foldEv numbers
 * carry the EV directly.
 *
 * Postflop: equity * pot_won  -  call_cost * (1 - equity_or_fold).
 * Coarse, but the directional signal (call profitable? raise too thin?)
 * is what the coach prose layer needs.
 */
function evaluateDecision(decision) {
  if (decision.street === 'preflop') return evaluatePreflop(decision);
  return evaluatePostflop(decision);
}

function evaluatePreflop(d) {
  const entry = CHART[d.hole_class];
  if (!entry) return makeNeutralFinding(d, 'unknown_class');
  const evRow = entry.byPos[d.position] || entry.byPos.BTN;
  const ev = {
    raise: evRow.openEv,
    call: evRow.callEv,
    fold: evRow.foldEv,
    check: 0,
  };
  const taken = d.action_taken;
  const evTaken = ev[taken] != null ? ev[taken] : 0;
  const best = bestAction(ev);
  const mistake = best.ev - evTaken;
  return {
    street: 'preflop',
    position: d.position,
    hole_class: d.hole_class,
    action_taken: taken,
    action_taken_ev: round2(evTaken),
    best_action: best.action,
    best_action_ev: round2(best.ev),
    mistake_bb: round2(mistake),
    tag: tagFor(taken, best.action, mistake),
    chart_strength: entry.strength,
  };
}

function evaluatePostflop(d) {
  // Pick a representative hero combo for the hand class, swapping suits
  // if the default conflicts with the board. The combo is for sim
  // purposes only — the LLM never sees raw cards (see llm.js).
  const combo = pickComboNotOnBoard(d.hole_class, d.board || []) || ['AH', 'KD'];
  // Filter the opp range too — combos whose cards collide with hero
  // hole or the board would otherwise blow up pokersolver.
  const heroSet = new Set([...combo, ...(d.board || [])]);
  const range = opponentRange({ pct: 0.4 }).filter(([a, b]) =>
    !heroSet.has(a) && !heroSet.has(b) && a !== b
  );
  const equity = equityVsRange({
    hole: combo,
    board: d.board,
    oppRange: range,
    iterations: 1000,
  });

  const pot = d.pot_before || 0;
  const toCall = d.to_call || 0;
  // EV(call) = equity * (pot + 2*toCall) - toCall  (one bet, no future streets)
  const evCall = equity * (pot + 2 * toCall) - toCall;
  const evFold = 0;
  // EV(raise) approximated as a 3x potsize raise with naive fold equity.
  const raiseSize = Math.max(toCall * 3, pot * 0.66);
  const foldEquity = 0.35;
  const evRaise = foldEquity * pot + (1 - foldEquity) * (equity * (pot + 2 * raiseSize) - raiseSize);
  const evCheck = equity * pot;

  const ev = { call: evCall, fold: evFold, raise: evRaise, check: evCheck, bet: evRaise };
  const taken = d.action_taken;
  const evTaken = ev[taken] != null ? ev[taken] : 0;
  const best = bestAction(ev);
  const mistake = best.ev - evTaken;
  return {
    street: d.street,
    position: d.position,
    hole_class: d.hole_class,
    action_taken: taken,
    action_taken_ev: round2(evTaken),
    best_action: best.action,
    best_action_ev: round2(best.ev),
    mistake_bb: round2(mistake / Math.max(1, d.bigBlind || 2)),
    tag: tagFor(taken, best.action, mistake),
    equity: round2(equity),
    pot: round2(pot),
    to_call: round2(toCall),
    board: d.board,
  };
}

function bestAction(evMap) {
  let bestKey = null;
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(evMap)) {
    if (v > bestVal) { bestVal = v; bestKey = k; }
  }
  return { action: bestKey, ev: bestVal };
}

function tagFor(taken, best, mistakeBb) {
  if (Math.abs(mistakeBb) < 0.1) return 'on_chart';
  if (taken === 'fold' && (best === 'call' || best === 'check')) return 'overfold';
  if (taken === 'call' && best === 'fold') return 'thin_call';
  if (taken === 'check' && best === 'raise') return 'missed_value';
  if (taken === 'call' && best === 'raise') return 'underbet';
  if (taken === 'raise' && best === 'fold') return 'spew';
  if (taken === 'raise' && best === 'call') return 'over_aggressive';
  return 'minor_deviation';
}

function makeNeutralFinding(d, reason) {
  return {
    street: d.street,
    position: d.position,
    hole_class: d.hole_class,
    action_taken: d.action_taken,
    action_taken_ev: 0,
    best_action: d.action_taken,
    best_action_ev: 0,
    mistake_bb: 0,
    tag: reason,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Top-level entry. Given a hand context (hero id, players, durable
 * events, dealer/BB seats, big blind size) — return findings array.
 *
 * @param {object} handContext
 * @returns {{ handId: string, hero: any, findings: object[] }}
 */
function analyzeHand(handContext) {
  const decisions = extractDecisions(handContext);
  const findings = decisions.map(evaluateDecision);
  return {
    handId: handContext.handId,
    hero: handContext.hero,
    findings,
  };
}

module.exports = {
  analyzeHand,
  evaluateDecision,
  extractDecisions,
  positionFor,
  opponentRange,
  comboForClass,
  POSITIONS,
};
