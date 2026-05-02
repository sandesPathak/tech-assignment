'use strict';

/**
 * Shared helpers for gateway tests.
 *
 * `ioredis-mock` quirk: each `new Redis()` from the same package gets a
 * private in-memory backend. To make pub/sub work across the worker
 * (publisher) and gateway (subscriber) we need them to share the SAME
 * mock instance. We do that by exporting a factory bound to a single
 * RedisMock and a thin `createConnection` that just returns the same
 * underlying client. This matches real ioredis behaviour closely enough
 * for fan-out tests — psubscribe/publish wiring works.
 */

const RedisMock = require('ioredis-mock');
const { StateStore } = require('@hijack/worker/src/state-store');
const { MemoryHandEventStore } = require('@hijack/worker/src/hand-event-store');
const { Publisher } = require('@hijack/worker/src/publish');
const { Gateway } = require('../src/ws-server');
const { signToken } = require('../src/auth');
const { GAME_HAND, PLAYER_STATUS } = require('@hijack/engine');

const TEST_SECRET = 'test-secret-do-not-use-in-prod';

/**
 * Build a connected fake-redis cluster: command client + a factory that
 * yields fresh subscriber clients sharing the same in-memory backend.
 */
function makeFakeRedis() {
  // ioredis-mock supports a global pubsub bus when constructed with
  // `data` / `keyPrefix` left default — multiple instances do share
  // pub/sub via a singleton EventEmitter under the hood. Verify in test.
  const command = new RedisMock();
  const subscriberFactory = () => new RedisMock();
  return { command, subscriberFactory };
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

async function bootStack({ tableId = '1', count = 2, backpressureLimit } = {}) {
  const { command, subscriberFactory } = makeFakeRedis();
  const eventStore = new MemoryHandEventStore();
  await eventStore.init();
  const stateStore = new StateStore({ redis: command, eventStore });
  await stateStore.initTable(tableId, makeInitialState({ tableId: Number(tableId), count }));
  const publisher = new Publisher({ redis: command });
  const gateway = new Gateway({
    redis: command,
    subscriberFactory,
    stateStore,
    eventStore,
    secret: TEST_SECRET,
    heartbeatMs: 60_000,
    backpressureLimit,
  });
  const { port } = await gateway.start({ port: 0 });
  return {
    command,
    subscriberFactory,
    eventStore,
    stateStore,
    publisher,
    gateway,
    port,
    async stop() {
      await gateway.stop();
      command.disconnect();
    },
  };
}

function tokenFor({ tableId = '1', userId = 'u1', sessionId = 's1', seat } = {}) {
  return signToken(
    { sub: userId, tableId, sessionId, seat },
    { secret: TEST_SECRET, expiresIn: '5m' }
  );
}

function urlFor(port, tableId, token) {
  return `ws://127.0.0.1:${port}/table/${tableId}?token=${token}`;
}

module.exports = {
  TEST_SECRET,
  bootStack,
  tokenFor,
  urlFor,
  makeInitialState,
};
