'use strict';

/**
 * loose — loose-aggressive (LAG).
 *
 * Calls almost anything, raises often, occasionally shoves all-in.
 * Highest action volume per hand → most useful for stress-testing the
 * gateway's broadcast path and the worker's tick loop.
 */

const { ACTIONS } = require('@hijack/protocol/messages');

function decide(state, ctx) {
  const toCall = Math.max(0, (state.currentBet || 0) - (state.myBet || 0));
  const stack = state.myStack || 0;
  const bb = state.bigBlind || 2;
  const r = ctx.rng();

  if (toCall === 0) {
    // Free street → bet/raise more often than not.
    if (r < 0.55) return { action: ACTIONS.RAISE, amount: Math.min(stack, bb * 3) };
    return { action: ACTIONS.CHECK };
  }

  if (r < 0.05 && stack > 0) return { action: ACTIONS.ALL_IN };
  if (r < 0.30) {
    const raiseTo = Math.min(stack, (state.currentBet || bb) * 2 + bb);
    if (raiseTo > (state.currentBet || 0)) {
      return { action: ACTIONS.RAISE, amount: raiseTo };
    }
  }
  if (r < 0.95 && stack >= toCall) return { action: ACTIONS.CALL };
  return { action: ACTIONS.FOLD };
}

module.exports = { decide, name: 'loose' };
