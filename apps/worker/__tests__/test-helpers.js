'use strict';

/**
 * Shared helpers for worker unit tests.
 * Builds a StateStore over an ioredis-mock + MemoryHandEventStore so
 * tests have no external dependencies.
 */

const RedisMock = require('ioredis-mock');
const { StateStore } = require('../src/state-store');
const { MemoryHandEventStore } = require('../src/hand-event-store');
const { GAME_HAND, PLAYER_STATUS } = require('@hijack/engine');

function makeStore({ snapshotEvery, eventStore } = {}) {
  const redis = new RedisMock();
  const store = eventStore || new MemoryHandEventStore();
  return {
    redis,
    eventStore: store,
    stateStore: new StateStore({
      redis,
      eventStore: store,
      snapshotEvery: snapshotEvery || 16,
    }),
  };
}

function makeInitialState({ tableId = 1, count = 2, stack = 100 } = {}) {
  const players = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    gameId: 1,
    tableId,
    playerId: i + 1,
    guid: `p${i + 1}-uuid`,
    username: `Player${i + 1}`,
    seat: i + 1,
    stack,
    bet: 0,
    totalBet: 0,
    status: PLAYER_STATUS.ACTIVE,
    action: '',
    cards: [],
    handRank: '',
    winnings: 0,
  }));
  const game = {
    id: 1,
    tableId,
    gameNo: 1,
    handStep: GAME_HAND.GAME_PREP,
    dealerSeat: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 0,
    communityCards: [],
    pot: 0,
    currentBet: 0,
    sidePots: [],
    move: 0,
    status: 'in_progress',
    smallBlind: 1,
    bigBlind: 2,
    maxSeats: count,
    deck: [],
    winners: [],
  };
  return { game, players };
}

module.exports = { makeStore, makeInitialState };
