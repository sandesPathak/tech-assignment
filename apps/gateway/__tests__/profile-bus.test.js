'use strict';

/**
 * profile-bus.test.js — Phase 5.
 *
 * Verifies the `profile:updated` Redis pub/sub round-trip. We open a
 * WS bound to a table where userId 'u1' is seated (the test helper's
 * default state populates seats 1+2 with players p1-uuid / p2-uuid).
 * Then we publish a `profile:updated` event for one of those seated
 * users and assert the gateway re-broadcasts an `s2c.delta` with
 * `payload.kind = 'player_updated'`.
 *
 * The test also covers the negative case — an event for a userId that
 * isn't seated anywhere is silently dropped (no broadcast).
 */

const { bootStack, tokenFor, urlFor } = require('./test-helpers');
const { attachProfileBus, tablesForUser, PROFILE_UPDATED_CHANNEL } = require('../src/profile-bus');
const WebSocket = require('ws');

describe('attachProfileBus', () => {
  test('profile:updated → s2c.delta with kind=player_updated for seated users', async () => {
    const stack = await bootStack({ tableId: '7' });
    try {
      await attachProfileBus(stack.gateway);
      // Open a WS bound to table 7 with userId u1.
      const token = tokenFor({ tableId: '7', userId: 'u1', sessionId: 's1' });
      const ws = new WebSocket(urlFor(stack.port, '7', token));
      const got = [];
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
      ws.send(JSON.stringify({ t: 'c2s.join', tableId: '7', lastSeq: 0 }));
      await new Promise((r) => setTimeout(r, 200));

      // Publish a profile:updated event for u1 (matches the WS's userId
      // — the gateway maps userId → table set via _hijack.userId).
      await stack.command.publish(
        PROFILE_UPDATED_CHANNEL,
        JSON.stringify({
          userId: 'u1',
          displayName: 'AliceNew',
          avatarId: '12',
          ts: Date.now(),
        })
      );

      const start = Date.now();
      let delta;
      while (Date.now() - start < 1500) {
        delta = got.find(
          (m) => m && m.t === 's2c.delta' && m.payload && m.payload.kind === 'player_updated'
        );
        if (delta) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(delta).toBeTruthy();
      expect(delta.payload.userId).toBe('u1');
      expect(delta.payload.displayName).toBe('AliceNew');
      expect(delta.payload.avatarId).toBe('12');
      ws.close();
    } finally {
      await stack.stop();
    }
  });

  test('events for users not seated anywhere are dropped', async () => {
    const stack = await bootStack({ tableId: '7' });
    try {
      await attachProfileBus(stack.gateway);
      const token = tokenFor({ tableId: '7', userId: 'u1', sessionId: 's1' });
      const ws = new WebSocket(urlFor(stack.port, '7', token));
      const got = [];
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
      ws.send(JSON.stringify({ t: 'c2s.join', tableId: '7', lastSeq: 0 }));
      await new Promise((r) => setTimeout(r, 200));

      // Publish for a userId the gateway doesn't know.
      await stack.command.publish(
        PROFILE_UPDATED_CHANNEL,
        JSON.stringify({ userId: 'u_ghost', displayName: 'Ghost', avatarId: '1' })
      );
      await new Promise((r) => setTimeout(r, 300));

      const delta = got.find(
        (m) => m && m.t === 's2c.delta' && m.payload && m.payload.kind === 'player_updated'
      );
      expect(delta).toBeUndefined();
      ws.close();
    } finally {
      await stack.stop();
    }
  });

  test('attachProfileBus is idempotent', async () => {
    const stack = await bootStack({ tableId: '1' });
    try {
      await attachProfileBus(stack.gateway);
      await attachProfileBus(stack.gateway); // second call no-ops
      expect(stack.gateway._profileBusAttached).toBe(true);
    } finally {
      await stack.stop();
    }
  });

  test('tablesForUser walks per-table socket sets', async () => {
    const stack = await bootStack({ tableId: '4' });
    try {
      const token = tokenFor({ tableId: '4', userId: 'u_walker', sessionId: 's1' });
      const ws = new WebSocket(urlFor(stack.port, '4', token));
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      ws.send(JSON.stringify({ t: 'c2s.join', tableId: '4', lastSeq: 0 }));
      await new Promise((r) => setTimeout(r, 100));
      const tables = tablesForUser(stack.gateway, 'u_walker');
      expect(tables.has('4')).toBe(true);
      const empty = tablesForUser(stack.gateway, 'u_unknown');
      expect(empty.size).toBe(0);
      ws.close();
    } finally {
      await stack.stop();
    }
  });
});
