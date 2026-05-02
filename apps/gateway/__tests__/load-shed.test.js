'use strict';

/**
 * load-shed.test.js — when a shard reports mem_pct above the saturation
 * threshold, the gateway must reject `c2s.join` with `s2c.error`
 * `{ code: 'shard_saturated' }` and close the socket.
 */

const WebSocket = require('ws');
const { bootStack, tokenFor, urlFor } = require('./test-helpers');
const { KEY: SHARD_METRICS_KEY } = require('@hijack/observability/shard-metrics');

jest.setTimeout(15000);

function awaitFrames(client, n, predicate) {
  const got = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout awaiting frames')), 4000);
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate && !predicate(msg)) return;
      got.push(msg);
      if (got.length >= n) {
        clearTimeout(timer);
        resolve(got);
      }
    });
  });
}

function waitFor(ws, evt) {
  return new Promise((resolve) => ws.on(evt, resolve));
}

describe('load shedding on saturated shards', () => {
  test('saturated shard (mem_pct=85) rejects c2s.join with shard_saturated error', async () => {
    const stack = await bootStack({ tableId: '101', count: 2 });
    const { gateway, port, command } = stack;

    // Stub the resolver so we know which shard key to populate. Then
    // write `mem_pct=85` to that shard's metrics hash.
    gateway.resolveShardId = () => 'saturated-shard';
    await command.hset(SHARD_METRICS_KEY('saturated-shard'), {
      tables: '512',
      mem_pct: '85.0',
      lag_ms: '120',
      last_tick_ts: String(Date.now()),
    });

    const token = tokenFor({ tableId: '101', userId: 'u1' });
    const client = new WebSocket(urlFor(port, '101', token));
    await waitFor(client, 'open');

    const errorPromise = awaitFrames(client, 1, (m) => m.t === 's2c.error');
    client.send(JSON.stringify({ t: 'c2s.join', tableId: '101' }));
    const [err] = await errorPromise;

    expect(err.t).toBe('s2c.error');
    expect(err.code).toBe('shard_saturated');

    // Server should close the socket with code 1013 ("try again later").
    const closeCode = await new Promise((resolve) => {
      client.on('close', (code) => resolve(code));
    });
    expect(closeCode).toBe(1013);

    await stack.stop();
  });

  test('healthy shard (mem_pct=20) accepts the join normally', async () => {
    const stack = await bootStack({ tableId: '102', count: 2 });
    const { gateway, port, command } = stack;

    gateway.resolveShardId = () => 'healthy-shard';
    await command.hset(SHARD_METRICS_KEY('healthy-shard'), {
      tables: '5',
      mem_pct: '20.0',
      lag_ms: '3',
      last_tick_ts: String(Date.now()),
    });

    const token = tokenFor({ tableId: '102', userId: 'u1' });
    const client = new WebSocket(urlFor(port, '102', token));
    await waitFor(client, 'open');

    const snapshotPromise = awaitFrames(client, 1, (m) => m.t === 's2c.snapshot');
    client.send(JSON.stringify({ t: 'c2s.join', tableId: '102' }));
    const [snap] = await snapshotPromise;
    expect(snap.t).toBe('s2c.snapshot');

    client.close();
    await stack.stop();
  });

  test('missing shard metrics (cold start) does not reject', async () => {
    const stack = await bootStack({ tableId: '103', count: 2 });
    const { gateway, port } = stack;

    gateway.resolveShardId = () => 'unreporting-shard';
    // Note: no hset — the metrics hash is absent.

    const token = tokenFor({ tableId: '103', userId: 'u1' });
    const client = new WebSocket(urlFor(port, '103', token));
    await waitFor(client, 'open');

    const snapshotPromise = awaitFrames(client, 1, (m) => m.t === 's2c.snapshot');
    client.send(JSON.stringify({ t: 'c2s.join', tableId: '103' }));
    const [snap] = await snapshotPromise;
    expect(snap.t).toBe('s2c.snapshot');

    client.close();
    await stack.stop();
  });
});
