'use strict';

/**
 * engine-runner — pure functional wrapper around @hijack/engine that
 * advances one hand step. Same 16-step state machine as the original
 * serverless processTable but with no MySQL / SQS / event-publisher
 * dependencies. The worker calls this once per tick.
 */

const {
  GAME_HAND,
  PLAYER_STATUS,
  ACTION,
  createDeck,
  shuffle,
  deal,
  findWinners,
  collectBets,
  isBettingRoundComplete,
  processAction,
  calculatePots,
  distributePots,
  getPlayersInHand,
  getActingPlayerCount,
  getNextSeat,
  toMoney,
} = require('@hijack/engine');

/**
 * Advance the table by one engine step. Mutates the supplied
 * `game` and `players` objects (matching the original engine's
 * style) and returns { game, players, awaiting?, error? }.
 */
function advance(game, players, playerAction) {
  switch (game.handStep) {
    case GAME_HAND.GAME_PREP:    return gamePrep(game, players);
    case GAME_HAND.SETUP_DEALER: return setupDealer(game, players);
    case GAME_HAND.SETUP_SMALL_BLIND: return setupSmallBlind(game, players);
    case GAME_HAND.SETUP_BIG_BLIND:   return setupBigBlind(game, players);
    case GAME_HAND.DEAL_CARDS:        return dealCards(game, players);
    case GAME_HAND.PRE_FLOP_BETTING_ROUND: return bettingRound(game, players, 'preflop', playerAction);
    case GAME_HAND.DEAL_FLOP:         return dealFlop(game, players);
    case GAME_HAND.FLOP_BETTING_ROUND: return bettingRound(game, players, 'flop', playerAction);
    case GAME_HAND.DEAL_TURN:         return dealTurn(game, players);
    case GAME_HAND.TURN_BETTING_ROUND: return bettingRound(game, players, 'turn', playerAction);
    case GAME_HAND.DEAL_RIVER:        return dealRiver(game, players);
    case GAME_HAND.RIVER_BETTING_ROUND: return bettingRound(game, players, 'river', playerAction);
    case GAME_HAND.AFTER_RIVER_BETTING_ROUND: return afterRiverBettingRound(game, players);
    case GAME_HAND.FIND_WINNERS:      return findHandWinners(game, players);
    case GAME_HAND.PAY_WINNERS:       return payWinners(game, players);
    case GAME_HAND.RECORD_STATS_AND_NEW_HAND: return recordStatsAndNewHand(game, players);
    default:
      return { game, players, error: `unknown_step:${game.handStep}` };
  }
}

function gamePrep(game, players) {
  for (const p of players) {
    if (p.status !== PLAYER_STATUS.SITTING_OUT && p.status !== PLAYER_STATUS.BUSTED) {
      p.status = PLAYER_STATUS.ACTIVE;
    }
    p.bet = 0;
    p.totalBet = 0;
    p.action = '';
    p.cards = [];
    p.handRank = '';
    p.winnings = 0;
  }
  game.pot = 0;
  game.currentBet = 0;
  game.communityCards = [];
  game.sidePots = [];
  game.deck = shuffle(createDeck());
  game.handStep = GAME_HAND.SETUP_DEALER;
  return { game, players };
}

function setupDealer(game, players) {
  const active = getPlayersInHand(players);
  if (active.length < 2) {
    game.handStep = GAME_HAND.RECORD_STATS_AND_NEW_HAND;
    return { game, players };
  }
  game.dealerSeat = getNextSeat(players, game.dealerSeat, game.maxSeats);
  game.handStep = GAME_HAND.SETUP_SMALL_BLIND;
  return { game, players };
}

function setupSmallBlind(game, players) {
  const active = getPlayersInHand(players);
  const sbSeat = active.length === 2
    ? game.dealerSeat
    : getNextSeat(players, game.dealerSeat, game.maxSeats);
  game.smallBlindSeat = sbSeat;
  const sb = players.find((p) => p.seat === sbSeat);
  if (sb) {
    const amt = Math.min(game.smallBlind, sb.stack);
    sb.stack = toMoney(sb.stack - amt);
    sb.bet = amt;
    sb.totalBet = amt;
    if (sb.stack === 0) sb.status = PLAYER_STATUS.ALL_IN;
  }
  game.handStep = GAME_HAND.SETUP_BIG_BLIND;
  return { game, players };
}

function setupBigBlind(game, players) {
  const bbSeat = getNextSeat(players, game.smallBlindSeat, game.maxSeats);
  game.bigBlindSeat = bbSeat;
  const bb = players.find((p) => p.seat === bbSeat);
  if (bb) {
    const amt = Math.min(game.bigBlind, bb.stack);
    bb.stack = toMoney(bb.stack - amt);
    bb.bet = amt;
    bb.totalBet = amt;
    if (bb.stack === 0) bb.status = PLAYER_STATUS.ALL_IN;
  }
  game.currentBet = game.bigBlind;
  game.handStep = GAME_HAND.DEAL_CARDS;
  return { game, players };
}

function dealCards(game, players) {
  for (const p of getPlayersInHand(players)) {
    p.cards = deal(game.deck, 2);
  }
  game.move = getNextSeat(players, game.bigBlindSeat, game.maxSeats);
  game.handStep = GAME_HAND.PRE_FLOP_BETTING_ROUND;
  return { game, players };
}

function bettingRound(game, players, round, playerAction) {
  const inHand = getPlayersInHand(players);
  if (inHand.length <= 1) {
    game.handStep = GAME_HAND.FIND_WINNERS;
    return { game, players };
  }

  if (getActingPlayerCount(players) <= 1) {
    const collected = collectBets(game, players);
    Object.assign(game, collected.game);
    advanceToNextStreet(game, round);
    return { game, players };
  }

  if (!playerAction) {
    return { game, players, awaiting: true };
  }

  const actingSeat = game.move;
  const actingPlayer = players.find(
    (p) => p.seat === actingSeat && p.status === PLAYER_STATUS.ACTIVE
  );
  if (!actingPlayer) {
    const collected = collectBets(game, players);
    Object.assign(game, collected.game);
    advanceToNextStreet(game, round);
    return { game, players };
  }

  if (playerAction.seat !== actingSeat) {
    return { game, players, error: `awaiting seat ${actingSeat}, got ${playerAction.seat}` };
  }

  const action = playerAction.action;
  const amount = playerAction.amount || 0;
  if (action === ACTION.RAISE || action === ACTION.BET) {
    const inc = amount - game.currentBet;
    game.lastRaiseSize = inc > 0 ? inc : game.bigBlind;
  }
  processAction(game, actingPlayer, action, amount);

  const remaining = getPlayersInHand(players);
  if (remaining.length <= 1) {
    const collected = collectBets(game, players);
    Object.assign(game, collected.game);
    game.handStep = GAME_HAND.FIND_WINNERS;
    return { game, players };
  }

  if (isBettingRoundComplete(players, game.currentBet)) {
    const collected = collectBets(game, players);
    Object.assign(game, collected.game);
    advanceToNextStreet(game, round);
    return { game, players };
  }

  game.move = getNextSeat(players, actingSeat, game.maxSeats);
  return { game, players };
}

function dealFlop(game, players) {
  const flop = deal(game.deck, 3);
  game.communityCards = [...game.communityCards, ...flop];
  game.move = getNextSeat(players, game.dealerSeat, game.maxSeats);
  game.handStep = GAME_HAND.FLOP_BETTING_ROUND;
  return { game, players };
}

function dealTurn(game, players) {
  game.communityCards = [...game.communityCards, ...deal(game.deck, 1)];
  game.move = getNextSeat(players, game.dealerSeat, game.maxSeats);
  game.handStep = GAME_HAND.TURN_BETTING_ROUND;
  return { game, players };
}

function dealRiver(game, players) {
  game.communityCards = [...game.communityCards, ...deal(game.deck, 1)];
  game.move = getNextSeat(players, game.dealerSeat, game.maxSeats);
  game.handStep = GAME_HAND.RIVER_BETTING_ROUND;
  return { game, players };
}

function afterRiverBettingRound(game, players) {
  game.handStep = GAME_HAND.FIND_WINNERS;
  return { game, players };
}

function findHandWinners(game, players) {
  const inHand = getPlayersInHand(players);
  if (inHand.length === 1) {
    inHand[0].handRank = 'Last player standing';
    game.winners = [{ seat: inHand[0].seat, playerId: inHand[0].playerId }];
    game.handStep = GAME_HAND.PAY_WINNERS;
    return { game, players };
  }
  const hands = inHand.map((p) => ({
    playerId: p.playerId,
    seat: p.seat,
    cards: [...p.cards, ...game.communityCards],
  }));
  const winners = findWinners(hands);
  for (const w of winners) {
    const player = players.find((p) => p.seat === w.seat);
    if (player) player.handRank = w.descr;
  }
  game.winners = winners.map((w) => ({ seat: w.seat, playerId: w.playerId }));
  game.handStep = GAME_HAND.PAY_WINNERS;
  return { game, players };
}

function payWinners(game, players) {
  const winnerSeats = (game.winners || []).map((w) => w.seat);
  const pots = calculatePots(players);

  if (pots.length === 0) {
    const share = toMoney(game.pot / Math.max(winnerSeats.length, 1));
    for (const seat of winnerSeats) {
      const p = players.find((x) => x.seat === seat);
      if (p) {
        p.stack = toMoney(p.stack + share);
        p.winnings = share;
      }
    }
  } else {
    const payouts = distributePots(pots, winnerSeats);
    for (const [seatStr, amt] of Object.entries(payouts)) {
      const p = players.find((x) => x.seat === parseInt(seatStr, 10));
      if (p) {
        p.stack = toMoney(p.stack + amt);
        p.winnings = amt;
      }
    }
  }

  game.pot = 0;
  game.handStep = GAME_HAND.RECORD_STATS_AND_NEW_HAND;
  return { game, players };
}

function recordStatsAndNewHand(game, players) {
  game.status = 'completed';
  return { game, players };
}

function advanceToNextStreet(game, currentRound) {
  const next = {
    preflop: GAME_HAND.DEAL_FLOP,
    flop: GAME_HAND.DEAL_TURN,
    turn: GAME_HAND.DEAL_RIVER,
    river: GAME_HAND.AFTER_RIVER_BETTING_ROUND,
  };
  game.handStep = next[currentRound] || GAME_HAND.FIND_WINNERS;
}

function getStepName(step) {
  const found = Object.entries(GAME_HAND).find(([, v]) => v === step);
  return found ? found[0] : `UNKNOWN(${step})`;
}

module.exports = { advance, getStepName };
