'use strict';

/**
 * coach-api.test.js — Phase 4 follow-up endpoint.
 *
 * Verifies:
 *   1. GET /api/coach/:handId/:hero returns 404 when no row, 200 with the
 *      memory-store row when populated.
 *   2. Existing routes (/health, /lobby/:stake) still respond after
 *      attachCoachApi runs — additive change, no regressions.
 *   3. hand:completed Redis pub/sub triggers an s2c.delta with payload
 *      kind 'hand_completed' on table sockets.
 */

const { bootStack, tokenFor, urlFor } = require('./test-helpers');
const {
  attachCoachApi,
  setMemoryAnalysis,
} = require('../src/coach-api');
const WebSocket = require('ws');

async function fetchText(port, path) {
  return new Promise((resolve, reject) => {
    const req = require('http').request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('attachCoachApi', () => {
  test('GET /api/coach/:handId/:hero — memory hit + miss', async () => {
    const stack = await bootStack({ tableId: '1' });
    try {
      await attachCoachApi(stack.gateway, { subscribe: false });
      // Miss
      const miss = await fetchText(stack.port, '/api/coach/h1/u1');
      expect(miss.status).toBe(404);
      // Hit
      setMemoryAnalysis('h1', 'u1', {
        hand_id: 'h1',
        hero: 'u1',
        prose: { summary: 'You should have folded preflop.' },
        findings: { decisions: [{ street: 'preflop', tag: 'open', mistake_bb: 1.2, comment: 'too loose' }] },
      });
      const hit = await fetchText(stack.port, '/api/coach/h1/u1');
      expect(hit.status).toBe(200);
      const body = JSON.parse(hit.body);
      expect(body.hand_id).toBe('h1');
      expect(body.prose.summary).toMatch(/folded/);
    } finally {
      await stack.stop();
    }
  });

  test('does not break /health or /lobby', async () => {
    const stack = await bootStack({ tableId: '1' });
    try {
      await attachCoachApi(stack.gateway, { subscribe: false });
      const h = await fetchText(stack.port, '/health');
      expect(h.status).toBe(200);
      expect(JSON.parse(h.body).status).toBe('ok');
      const l = await fetchText(stack.port, '/lobby');
      expect(l.status).toBe(200);
    } finally {
      await stack.stop();
    }
  });

  test('hand:completed pub/sub broadcasts s2c.delta with kind=hand_completed', async () => {
    const stack = await bootStack({ tableId: '7' });
    try {
      await attachCoachApi(stack.gateway, { subscribe: true });
      // Open a WS bound to table 7.
      const token = tokenFor({ tableId: '7', userId: 'u1', sessionId: 's1' });
      const ws = new WebSocket(urlFor(stack.port, '7', token));
      const got = [];
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
      ws.send(JSON.stringify({ t: 'c2s.join', tableId: '7', lastSeq: 0 }));
      // Wait for snapshot.
      await new Promise((r) => setTimeout(r, 200));

      // Publish a hand:completed event.
      await stack.command.publish(
        'hand:completed',
        JSON.stringify({
          handId: 'h_42',
          tableId: '7',
          gameNo: 1,
          lastSeq: 5,
          fromSeq: 1,
          toSeq: 6,
        })
      );
      // Poll up to 1.5s for the derived delta to arrive.
      const start = Date.now();
      let handCompleted;
      while (Date.now() - start < 1500) {
        handCompleted = got.find(
          (m) => m && m.t === 's2c.delta' && m.payload && m.payload.kind === 'hand_completed'
        );
        if (handCompleted) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(handCompleted).toBeTruthy();
      expect(handCompleted.payload.handId).toBe('h_42');
      ws.close();
    } finally {
      await stack.stop();
    }
  });
});
