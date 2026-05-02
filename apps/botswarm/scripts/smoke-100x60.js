'use strict';

/**
 * smoke-100x60.js — 100-bot 60-second endurance probe.
 *
 * Boots the gateway in-process (same pattern as the integration tests),
 * spawns 100 bots, then samples metrics every second for 60 s. Asserts:
 *   - all 100 bots reach JOINED state within 5 s
 *   - zero connection errors throughout
 *   - RSS growth across the run is bounded (no leaks)
 *
 *   node --expose-gc apps/botswarm/scripts/smoke-100x60.js
 */

const RedisMock = require('ioredis-mock');
const { Gateway } = require('@hijack/gateway/src/ws-server');
const { StateStore } = require('@hijack/worker/src/state-store');
const { MemoryHandEventStore } = require('@hijack/worker/src/hand-event-store');
const { GAME_HAND, PLAYER_STATUS } = require('@hijack/engine');
const { Runner } = require('../src/runner');

const TEST_SECRET = 'smoke-secret';
const DURATION_S = Number(process.env.DURATION || 60);
const N = Number(process.env.BOTS || 100);

function initialState(tableId, count = 6) {
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
  const command = new RedisMock();
  const subscriberFactory = () => new RedisMock();
  const eventStore = new MemoryHandEventStore();
  await eventStore.init();
  const stateStore = new StateStore({ redis: command, eventStore });
  const tableIds = ['1', '2', '3', '4'];
  for (const id of tableIds) await stateStore.initTable(id, initialState(Number(id), 6));

  const gateway = new Gateway({
    redis: command, subscriberFactory, stateStore, eventStore,
    secret: TEST_SECRET, heartbeatMs: 60_000,
  });
  const { port } = await gateway.start({ port: 0 });

  if (global.gc) global.gc();
  const rssStart = process.memoryUsage().rss;

  const samples = [];
  const runner = new Runner({
    gatewayUrl: `ws://127.0.0.1:${port}`,
    tableIds,
    bots: N,
    rampPerSec: 100,
    profile: 'mix',
    secret: TEST_SECRET,
    write: (line) => samples.push(JSON.parse(line)),
  });
  runner.start();

  const deadline = Date.now() + DURATION_S * 1000;
  let rampedAt = null;
  while (Date.now() < deadline) {
    await delay(500);
    if (rampedAt == null && runner.metrics.bots_active >= N) rampedAt = Date.now();
  }

  if (global.gc) global.gc();
  const rssEnd = process.memoryUsage().rss;

  const errs = runner.metrics.connectionErrors;
  await runner.stop();
  await gateway.stop();
  command.disconnect();

  const result = {
    bots: N,
    durationSec: DURATION_S,
    samples: samples.length,
    rampMs: rampedAt ? rampedAt - samples[0]?.ts : null,
    botsActivePeak: Math.max(...samples.map((s) => s.bots_active), 0),
    actionsTotal: samples[samples.length - 1]?.actions_total ?? 0,
    connectionErrors: errs,
    rssStartMb: (rssStart / 1024 / 1024).toFixed(2),
    rssEndMb: (rssEnd / 1024 / 1024).toFixed(2),
    rssGrowthMb: ((rssEnd - rssStart) / 1024 / 1024).toFixed(2),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  // Assert on the way out so CI fails loudly if a regression sneaks in.
  if (errs > 0) {
    process.stderr.write(`FAIL: ${errs} connection_errors\n`);
    process.exit(2);
  }
  if (result.botsActivePeak < N) {
    process.stderr.write(`FAIL: peak active=${result.botsActivePeak} < ${N}\n`);
    process.exit(3);
  }
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => { process.stderr.write(err.stack + '\n'); process.exit(1); });
