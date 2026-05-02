'use strict';

const { PLAYER_STATUS, ACTION } = require('./constants');
const { toMoney } = require('./money');

/**
 * Process a player action (call, check, bet, raise, fold, allin).
 * Mutates the player and game state. Returns updated state.
 */
function processAction(game, player, action, amount = 0) {
  switch (action) {
    case ACTION.FOLD:
      player.status = PLAYER_STATUS.FOLDED;
      player.action = ACTION.FOLD;
      break;

    case ACTION.CHECK:
      player.action = ACTION.CHECK;
      break;

    case ACTION.CALL: {
      const callAmount = Math.min(game.currentBet - player.bet, player.stack);
      player.stack = toMoney(player.stack - callAmount);
      player.bet = toMoney(player.bet + callAmount);
      player.totalBet = toMoney(player.totalBet + callAmount);
      player.action = ACTION.CALL;
      if (player.stack === 0) {
        player.status = PLAYER_STATUS.ALL_IN;
        player.action = ACTION.ALLIN;
      }
      break;
    }

    case ACTION.BET: {
      const betAmount = Math.min(amount, player.stack);
      player.stack = toMoney(player.stack - betAmount);
      player.bet = toMoney(player.bet + betAmount);
      player.totalBet = toMoney(player.totalBet + betAmount);
      player.action = ACTION.BET;
      game.currentBet = player.bet;
      if (player.stack === 0) {
        player.status = PLAYER_STATUS.ALL_IN;
        player.action = ACTION.ALLIN;
      }
      break;
    }

    case ACTION.RAISE: {
      const raiseAmount = Math.min(amount, player.stack);
      player.stack = toMoney(player.stack - raiseAmount);
      player.bet = toMoney(player.bet + raiseAmount);
      player.totalBet = toMoney(player.totalBet + raiseAmount);
      player.action = ACTION.RAISE;
      game.currentBet = player.bet;
      if (player.stack === 0) {
        player.status = PLAYER_STATUS.ALL_IN;
        player.action = ACTION.ALLIN;
      }
      break;
    }

    case ACTION.ALLIN: {
      const allInAmount = player.stack;
      player.bet = toMoney(player.bet + allInAmount);
      player.totalBet = toMoney(player.totalBet + allInAmount);
      player.stack = 0;
      player.status = PLAYER_STATUS.ALL_IN;
      player.action = ACTION.ALLIN;
      if (player.bet > game.currentBet) {
        game.currentBet = player.bet;
      }
      break;
    }
  }

  return { game, player };
}

/**
 * Check if a betting round is complete.
 * A round is complete when all active (non-folded, non-allin) players have acted
 * and all bets are equal to the current bet.
 */
function isBettingRoundComplete(players, currentBet) {
  const activePlayers = players.filter(
    (p) => p.status === PLAYER_STATUS.ACTIVE
  );

  if (activePlayers.length === 0) return true;

  return activePlayers.every(
    (p) => p.action !== '' && p.bet === currentBet
  );
}

/**
 * Collect bets into the pot and reset for next round.
 */
function collectBets(game, players) {
  let collected = 0;
  for (const player of players) {
    collected = toMoney(collected + player.bet);
    player.bet = 0;
    player.action = '';
  }
  game.pot = toMoney(game.pot + collected);
  game.currentBet = 0;
  return { game, players, collected };
}

/**
 * Get the minimum raise amount (2x the current bet, or big blind if no bet).
 */
function getMinRaise(currentBet, bigBlind) {
  return currentBet > 0 ? currentBet * 2 : bigBlind;
}

/**
 * Get valid actions for a player given the current game state.
 */
function getValidActions(player, currentBet, bigBlind) {
  const actions = [ACTION.FOLD];

  if (player.bet === currentBet) {
    actions.push(ACTION.CHECK);
  }

  if (currentBet > player.bet && player.stack > 0) {
    actions.push(ACTION.CALL);
  }

  if (currentBet === 0 && player.stack > 0) {
    actions.push(ACTION.BET);
  }

  if (currentBet > 0 && player.stack > (currentBet - player.bet)) {
    actions.push(ACTION.RAISE);
  }

  if (player.stack > 0) {
    actions.push(ACTION.ALLIN);
  }

  return actions;
}

module.exports = {
  processAction,
  isBettingRoundComplete,
  collectBets,
  getMinRaise,
  getValidActions,
};
