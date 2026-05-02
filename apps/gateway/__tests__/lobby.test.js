'use strict';

/**
 * Lobby — REST list + WS topic propagation.
 *
 * Covers:
 *  - GET /lobby/:stake returns the live ZSET projected with table meta.
 *  - c2s.lobby_subscribe receives s2c.lobby_state then live deltas published
 *    by the worker (via Redis PUBLISH).
 *  - Two viewers see the same delta within one tick.
 *  - Unknown stake returns 404 over REST and an error frame over WS.
 */

const RedisMock = require('ioredis-mock');
const WebSocket = require('ws');
const http = require('http');

const { Gateway } = require('../src/ws-server');
const { signToken } = require('../src/auth');

const SECRET = 'lobby-test-secret';
const STAKE = '1-2';

async function setupGateway() {
  const command = new RedisMock();
  await command.flushall();
  const subscriberFactory = () => new RedisMock();
  const gateway = new Gateway({
    redis: command,
    subscriberFactory,
    stateStore: { loadTable: async () => ({}) }, // unused for lobby tests
    eventStore: {},
    secret: SECRET,
    heartbeatMs: 60_000,
  });
  const { port } = await gateway.start({ port: 0 });
  return {
    command,
    gateway,
    port,
    async stop() { await gateway.stop(); command.disconnect(); },
  };
}

async function provisionTable(redis, tableId, openSeats = 6, name = 'T') {
  await redis.hset(
    `table:${tableId}:meta`,
    'name', name,
    'maxSeats', '6',
    'smallBlind', '1',
    'bigBlind', '2',
    'lastActivityMs', String(Date.now()),
  );
  await redis.zadd(`lobby:${STAKE}:tables`, openSeats, tableId);
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function openLobbyWS(port, stake) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/lobby`);
  const frames = [];
  const ready = new Promise((resolve) => ws.on('open', resolve));
  ws.on('message', (data) => {
    try { frames.push(JSON.parse(data.toString())); }
    catch (_e) { /* ignore */ }
  });
  ws.on('error', (err) => { frames.push({ t: '__error__', err: err.message }); });
  ws.on('close', (code, r) => { frames.push({ t: '__close__', code, reason: r && r.toString() }); });
  return { ws, frames, ready };
}

async function waitFor(predicate, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout');
}

describe('Lobby (REST + WS)', () => {
  test('GET /lobby/:stake returns live tables from Redis', async () => {
    const { command, port, stop } = await setupGateway();
    try {
      await provisionTable(command, 't-A', 6, 'Aces');
      await provisionTable(command, 't-B', 3, 'Eights');
      const res = await getJson(port, `/lobby/${STAKE}`);
      expect(res.status).toBe(200);
      expect(res.body.stake).toBe(STAKE);
      expect(res.body.tables).toHaveLength(2);
      const ids = res.body.tables.map((t) => t.tableId).sort();
      expect(ids).toEqual(['t-A', 't-B']);
      const a = res.body.tables.find((t) => t.tableId === 't-A');
      expect(a.openSeats).toBe(6);
      expect(a.maxSeats).toBe(6);
      expect(a.name).toBe('Aces');
    } finally { await stop(); }
  });

  test('GET /lobby/:stake on unknown stake → 404', async () => {
    const { port, stop } = await setupGateway();
    try {
      const res = await getJson(port, '/lobby/no-such');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('unknown_stake');
    } finally { await stop(); }
  });

  test('WS lobby_subscribe → state frame, then deltas pushed via PUBLISH', async () => {
    const { command, port, stop } = await setupGateway();
    try {
      await provisionTable(command, 't-C', 6, 'Charlie');
      const { ws, frames, ready } = openLobbyWS(port, STAKE);
      await ready;
      ws.send(JSON.stringify({ t: 'c2s.lobby_subscribe', stake: STAKE }));

      await waitFor(() => frames.some((f) => f.t === 's2c.lobby_state'));
      const state = frames.find((f) => f.t === 's2c.lobby_state');
      expect(state.stake).toBe(STAKE);
      expect(state.tables).toHaveLength(1);

      // Worker-side simulation: publish a seat_filled delta on the
      // pub/sub channel the lobby subscribes to.
      await command.publish(
        `lobby:${STAKE}:events`,
        JSON.stringify({ t: 'seat_filled', tableId: 't-C', seat: 3, openSeats: 5, maxSeats: 6 })
      );

      await waitFor(() => frames.some((f) => f.t === 's2c.lobby_delta' && f.kind === 'seat_filled'));
      const delta = frames.find((f) => f.t === 's2c.lobby_delta');
      expect(delta.tableId).toBe('t-C');
      expect(delta.seat).toBe(3);
      expect(delta.openSeats).toBe(5);
      ws.close();
    } finally { await stop(); }
  });

  test('two lobby subscribers receive the same delta', async () => {
    const { command, port, stop } = await setupGateway();
    try {
      await provisionTable(command, 't-D', 6, 'Delta');

      const a = openLobbyWS(port, STAKE);
      const b = openLobbyWS(port, STAKE);
      await Promise.all([a.ready, b.ready]);
      a.ws.send(JSON.stringify({ t: 'c2s.lobby_subscribe', stake: STAKE }));
      b.ws.send(JSON.stringify({ t: 'c2s.lobby_subscribe', stake: STAKE }));

      await waitFor(() => a.frames.some((f) => f.t === 's2c.lobby_state'));
      await waitFor(() => b.frames.some((f) => f.t === 's2c.lobby_state'));

      await command.publish(
        `lobby:${STAKE}:events`,
        JSON.stringify({ t: 'seat_filled', tableId: 't-D', seat: 1, openSeats: 5, maxSeats: 6 })
      );

      await waitFor(() => a.frames.some((f) => f.t === 's2c.lobby_delta'));
      await waitFor(() => b.frames.some((f) => f.t === 's2c.lobby_delta'));
      a.ws.close();
      b.ws.close();
    } finally { await stop(); }
  });

  test('lobby_subscribe with unknown stake returns error frame', async () => {
    const { port, stop } = await setupGateway();
    try {
      const { ws, frames, ready } = openLobbyWS(port, 'whatever');
      await ready;
      ws.send(JSON.stringify({ t: 'c2s.lobby_subscribe', stake: 'whatever' }));
      await waitFor(() => frames.some((f) => f.t === 's2c.error'));
      const err = frames.find((f) => f.t === 's2c.error');
      expect(err.code).toBe('unknown_stake');
      ws.close();
    } finally { await stop(); }
  });
});
