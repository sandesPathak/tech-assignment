'use strict';

/**
 * End-to-end lobby integration:
 *  matchmaker spawns a table -> seat-claimer awards 6 seats out of 100
 *  attempts -> lobby pub/sub pushes a `seat_filled` delta to the live
 *  WS subscriber for every claim -> the open-seat count converges to 0.
 *
 * Mirrors the demo path for "two browser tabs see the same lobby update."
 */

const RedisMock = require('ioredis-mock');
const WebSocket = require('ws');

const { Gateway } = require('../src/ws-server');
const { SeatClaimer } = require('../src/seat-claim');
const { Matchmaker } = require('@hijack/worker/src/matchmaker');
const { StateStore } = require('@hijack/worker/src/state-store');
const { MemoryHandEventStore } = require('@hijack/worker/src/hand-event-store');
const { listStakes } = require('@hijack/protocol/stakes');

const SECRET = 'integration-secret';

async function setup() {
  const command = new RedisMock();
  await command.flushall();
  const subscriberFactory = () => new RedisMock();
  const eventStore = new MemoryHandEventStore();
  await eventStore.init();
  const stateStore = new StateStore({ redis: command, eventStore });

  const gateway = new Gateway({
    redis: command,
    subscriberFactory,
    stateStore,
    eventStore,
    secret: SECRET,
    heartbeatMs: 60_000,
  });
  const { port } = await gateway.start({ port: 0 });

  const matchmaker = new Matchmaker({ redis: command, stateStore });
  const claimer = new SeatClaimer({ redis: command, secret: SECRET });
  await claimer.load();

  return {
    command, gateway, port, matchmaker, claimer, stateStore,
    async stop() {
      matchmaker.stop();
      await gateway.stop();
      command.disconnect();
    },
  };
}

async function waitFor(predicate, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timeout');
}

describe('Lobby integration', () => {
  test('two viewers see live deltas as concurrent claims fill a fresh table', async () => {
    const { command, port, matchmaker, claimer, stop } = await setup();
    try {
      await matchmaker.tick();
      const stake = listStakes()[0];
      const tables = await command.zrange(`lobby:${stake.id}:tables`, 0, -1);
      const tableId = tables[0];

      // Two viewers attach; both subscribe to the same stake.
      const wsA = new WebSocket(`ws://127.0.0.1:${port}/lobby`);
      const wsB = new WebSocket(`ws://127.0.0.1:${port}/lobby`);
      const framesA = [];
      const framesB = [];
      wsA.on('message', (d) => { framesA.push(JSON.parse(d.toString())); });
      wsB.on('message', (d) => { framesB.push(JSON.parse(d.toString())); });
      await Promise.all([
        new Promise((r) => wsA.on('open', r)),
        new Promise((r) => wsB.on('open', r)),
      ]);
      wsA.send(JSON.stringify({ t: 'c2s.lobby_subscribe', stake: stake.id }));
      wsB.send(JSON.stringify({ t: 'c2s.lobby_subscribe', stake: stake.id }));

      await waitFor(() => framesA.some((f) => f.t === 's2c.lobby_state'));
      await waitFor(() => framesB.some((f) => f.t === 's2c.lobby_state'));

      // 100 concurrent claim attempts on the freshly-spawned table.
      const attempts = [];
      for (let i = 0; i < 100; i += 1) {
        attempts.push(
          claimer.claim({
            stake: stake.id,
            tableId,
            seat: (i % stake.maxSeats) + 1,
            userId: `u-${i}`,
          })
        );
      }
      const results = await Promise.all(attempts);
      const wins = results.filter((r) => r.ok);
      expect(wins).toHaveLength(stake.maxSeats);

      // Every winning claim publishes one seat_filled delta — both
      // viewers should see the same per-seat updates. We assert at least
      // one each and a converged final open-seat count of zero.
      await waitFor(
        () => framesA.filter((f) => f.t === 's2c.lobby_delta' && f.kind === 'seat_filled').length >= 1
      );
      await waitFor(
        () => framesB.filter((f) => f.t === 's2c.lobby_delta' && f.kind === 'seat_filled').length >= 1
      );

      // Final open-seats reading converges to 0.
      const score = await command.zscore(`lobby:${stake.id}:tables`, tableId);
      expect(Number(score)).toBe(0);

      wsA.close();
      wsB.close();
    } finally { await stop(); }
  });

  test('client presents join token to gateway → ws upgrades and binds the seat', async () => {
    const { command, port, matchmaker, claimer, stop } = await setup();
    try {
      await matchmaker.tick();
      const stake = listStakes()[0];
      const tables = await command.zrange(`lobby:${stake.id}:tables`, 0, -1);
      const tableId = tables[0];

      const claim = await claimer.claim({
        stake: stake.id, tableId, seat: 1, userId: 'u-bind',
      });
      expect(claim.ok).toBe(true);

      // Open a *table* WS — the URL token is the join token.
      const ws = new WebSocket(`ws://127.0.0.1:${port}/table/${tableId}?token=${claim.joinToken}`);
      const frames = [];
      ws.on('message', (d) => { frames.push(JSON.parse(d.toString())); });
      await new Promise((r) => ws.on('open', r));
      ws.send(JSON.stringify({
        t: 'c2s.join',
        tableId,
        seat: 1,
        joinToken: claim.joinToken,
      }));

      // Worker binds via planResume — we should receive a snapshot.
      await waitFor(() => frames.some((f) => f.t === 's2c.snapshot'));
      ws.close();
    } finally { await stop(); }
  });
});
