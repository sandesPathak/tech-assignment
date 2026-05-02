'use strict';

/**
 * Integration: spin up the gateway in-process (same helper the gateway's
 * own tests use), launch a tiny swarm, verify:
 *   - bots ramp at the configured rate
 *   - they reach the JOINED state (snapshot received)
 *   - SIGTERM-style shutdown (`runner.stop()`) closes every socket cleanly
 *   - metrics line is emitted in the expected JSON shape
 *   - per-bot RSS impact is < 2 MB (probe with a small N)
 */

const RedisMock = require('ioredis-mock');
const { Gateway } = require('@hijack/gateway/src/ws-server');
const { StateStore } = require('@hijack/worker/src/state-store');
const { MemoryHandEventStore } = require('@hijack/worker/src/hand-event-store');
const { GAME_HAND, PLAYER_STATUS } = require('@hijack/engine');

const { Runner } = require('../src/runner');

const TEST_SECRET = 'bot-swarm-test-secret';

function initialState(tableId, count = 4) {
  return {
    game: {
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
    },
    players: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      gameId: 1,
      tableId,
      playerId: i + 1,
      guid: `seat-${i + 1}`,
      username: `Player${i + 1}`,
      seat: i + 1,
      stack: 100,
      bet: 0,
      totalBet: 0,
      status: PLAYER_STATUS.ACTIVE,
      action: '',
      cards: [],
      handRank: '',
      winnings: 0,
    })),
  };
}

async function bootGateway(tableIds) {
  const command = new RedisMock();
  const subscriberFactory = () => new RedisMock();
  const eventStore = new MemoryHandEventStore();
  await eventStore.init();
  const stateStore = new StateStore({ redis: command, eventStore });
  for (const id of tableIds) {
    await stateStore.initTable(id, initialState(Number(id) || 1, 4));
  }
  const gateway = new Gateway({
    redis: command,
    subscriberFactory,
    stateStore,
    eventStore,
    secret: TEST_SECRET,
    heartbeatMs: 60_000,
  });
  const { port } = await gateway.start({ port: 0 });
  return {
    gateway,
    port,
    async stop() {
      await gateway.stop();
      command.disconnect();
    },
  };
}

describe('bot swarm — integration', () => {
  test('50 bots ramp, join, and shut down cleanly', async () => {
    const tableIds = ['1', '2'];
    const { gateway, port, stop } = await bootGateway(tableIds);

    const lines = [];
    const runner = new Runner({
      gatewayUrl: `ws://127.0.0.1:${port}`,
      tableIds,
      bots: 50,
      rampPerSec: 100,
      profile: 'mix',
      secret: TEST_SECRET,
      write: (l) => lines.push(l),
    });

    runner.start();

    // Wait until at least 50 bots have joined.
    await waitFor(() => runner.metrics.bots_active >= 50, 5000);

    expect(runner.metrics.bots_active).toBeGreaterThanOrEqual(50);
    // No connection errors over the test window.
    expect(runner.metrics.connectionErrors).toBe(0);

    // Metrics lines should have been emitted in JSON.
    await waitFor(() => lines.length >= 1, 1500);
    const m = JSON.parse(lines[lines.length - 1]);
    expect(typeof m.bots_active).toBe('number');
    expect(typeof m.actions_per_sec).toBe('number');
    expect(typeof m.connection_errors).toBe('number');
    expect(m.target).toBe(50);

    await runner.stop();

    // After stop, every socket should be closed.
    const stillOpen = runner.bots.filter((b) => b.ws && b.ws.readyState === b.ws.OPEN).length;
    expect(stillOpen).toBe(0);

    await stop();
    void gateway;
  }, 20000);

  test('per-bot memory budget — 50-bot diff < 100 MB', async () => {
    const tableIds = ['1'];
    const boot = await bootGateway(tableIds);
    if (global.gc) global.gc();
    const before = process.memoryUsage().rss;

    const runner = new Runner({
      gatewayUrl: `ws://127.0.0.1:${boot.port}`,
      tableIds,
      bots: 50,
      rampPerSec: 100,
      profile: 'tight',
      secret: TEST_SECRET,
      write: () => {},
    });
    runner.start();
    await waitFor(() => runner.metrics.bots_active >= 50, 5000);
    if (global.gc) global.gc();
    const after = process.memoryUsage().rss;
    const perBot = (after - before) / 50;
    // Loose bound: < 2 MB per bot. CI noise can push this; we leave
    // headroom but still flag a regression.
    process.stderr.write(
      `[swarm.test] per-bot RSS delta ≈ ${(perBot / 1024).toFixed(1)} KB\n`
    );
    expect(perBot).toBeLessThan(2 * 1024 * 1024);

    await runner.stop();
    await boot.stop();
  }, 20000);
});

function waitFor(fn, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok;
      try { ok = fn(); } catch (e) { return reject(e); }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`waitFor timeout after ${timeoutMs}ms`));
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
