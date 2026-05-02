'use strict';

/**
 * measure-memory.js — boot N bots against an in-process gateway and
 * report RSS / heap usage. Use with --expose-gc for a clean baseline.
 *
 *   node --expose-gc apps/botswarm/scripts/measure-memory.js 100
 *
 * Prints two snapshots (baseline, after-N-bots-active) plus the per-bot
 * delta. Cheap sanity check for the < 2 MB/bot budget.
 */

const RedisMock = require('ioredis-mock');
const { Gateway } = require('@hijack/gateway/src/ws-server');
const { StateStore } = require('@hijack/worker/src/state-store');
const { MemoryHandEventStore } = require('@hijack/worker/src/hand-event-store');
const { GAME_HAND, PLAYER_STATUS } = require('@hijack/engine');
const { Runner } = require('../src/runner');

const TEST_SECRET = 'mem-probe-secret';

function initialState(tableId, count = 4) {
  return {
    game: {
      id: 1, tableId, gameNo: 1, handStep: GAME_HAND.GAME_PREP,
      dealerSeat: 0, smallBlindSeat: 0, bigBlindSeat: 0,
      communityCards: [], pot: 0, currentBet: 0, sidePots: [], move: 0,
      status: 'in_progress', smallBlind: 1, bigBlind: 2, maxSeats: count,
      deck: [], winners: [],
    },
    players: Array.from({ length: count }, (_, i) => ({
      id: i + 1, gameId: 1, tableId, playerId: i + 1, guid: `seat-${i + 1}`,
      username: `Player${i + 1}`, seat: i + 1, stack: 100, bet: 0, totalBet: 0,
      status: PLAYER_STATUS.ACTIVE, action: '', cards: [], handRank: '', winnings: 0,
    })),
  };
}

async function main() {
  const N = Number(process.argv[2] || 100);
  const command = new RedisMock();
  const subscriberFactory = () => new RedisMock();
  const eventStore = new MemoryHandEventStore();
  await eventStore.init();
  const stateStore = new StateStore({ redis: command, eventStore });
  const tableIds = ['1', '2', '3'];
  for (const id of tableIds) await stateStore.initTable(id, initialState(Number(id), 4));

  const gateway = new Gateway({
    redis: command, subscriberFactory, stateStore, eventStore,
    secret: TEST_SECRET, heartbeatMs: 60_000,
  });
  const { port } = await gateway.start({ port: 0 });

  if (global.gc) global.gc();
  await delay(200);
  const before = process.memoryUsage();

  const runner = new Runner({
    gatewayUrl: `ws://127.0.0.1:${port}`,
    tableIds,
    bots: N,
    rampPerSec: 100,
    profile: 'mix',
    secret: TEST_SECRET,
    write: () => {},
  });
  runner.start();

  // Wait for ramp to complete + everyone joined.
  await waitFor(() => runner.metrics.bots_active >= N, 30_000);
  if (global.gc) global.gc();
  await delay(200);
  if (global.gc) global.gc();
  const after = process.memoryUsage();

  const dRss = after.rss - before.rss;
  const dHeap = after.heapUsed - before.heapUsed;
  const fmt = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
  process.stdout.write(JSON.stringify({
    bots: N,
    rssBefore: fmt(before.rss),
    rssAfter: fmt(after.rss),
    rssDelta: fmt(dRss),
    rssPerBot: `${(dRss / N / 1024).toFixed(1)} KB`,
    heapBefore: fmt(before.heapUsed),
    heapAfter: fmt(after.heapUsed),
    heapDelta: fmt(dHeap),
    heapPerBot: `${(dHeap / N / 1024).toFixed(1)} KB`,
  }, null, 2) + '\n');

  await runner.stop();
  await gateway.stop();
  command.disconnect();
}

function waitFor(fn, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 100);
    };
    tick();
  });
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => { process.stderr.write(err.stack + '\n'); process.exit(1); });
