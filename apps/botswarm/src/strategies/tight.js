'use strict';

/**
 * tight — folds a lot, calls small bets, never raises.
 *
 * Cheapest profile for the gateway (most actions are `fold`/`check`).
 * Useful to verify the engine handles fast turn-cycling without sticking.
 */

const { ACTIONS } = require('@hijack/protocol/messages');

function decide(state, ctx) {
  const toCall = Math.max(0, (state.currentBet || 0) - (state.myBet || 0));
  const stack = state.myStack || 0;
  const bb = state.bigBlind || 2;

  if (toCall === 0) return { action: ACTIONS.CHECK };

  // Call only cheap bets relative to the big blind. Anything else, fold.
  // This keeps tables alive for several streets without escalating the pot.
  const r = ctx.rng();
  if (toCall <= bb && r < 0.85) return { action: ACTIONS.CALL };
  if (toCall <= bb * 3 && r < 0.25 && stack > toCall) return { action: ACTIONS.CALL };
  return { action: ACTIONS.FOLD };
}

module.exports = { decide, name: 'tight' };
