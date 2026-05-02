'use strict';

/**
 * random — chaotic profile.
 *
 * Picks uniformly from {fold, check/call, raise} weighted slightly toward
 * staying in the hand (otherwise the table empties too quickly to be a
 * useful load test).
 *
 * Always returns a legal action. If the bot has nothing to call (currentBet
 * == its bet) we never emit `fold` — that's an illegal frame on most engines
 * and would just waste a server roundtrip.
 */

const { ACTIONS } = require('@hijack/protocol/messages');

function decide(state, ctx) {
  const r = ctx.rng();
  const toCall = Math.max(0, (state.currentBet || 0) - (state.myBet || 0));
  const canCheck = toCall === 0;

  if (canCheck) {
    if (r < 0.6) return { action: ACTIONS.CHECK };
    return { action: ACTIONS.RAISE, amount: minRaise(state) };
  }
  if (r < 0.30) return { action: ACTIONS.FOLD };
  if (r < 0.85) return { action: ACTIONS.CALL };
  return { action: ACTIONS.RAISE, amount: minRaise(state) };
}

function minRaise(state) {
  const bb = state.bigBlind || 2;
  const cur = state.currentBet || 0;
  return Math.max(cur + bb, bb * 2);
}

module.exports = { decide, name: 'random' };
