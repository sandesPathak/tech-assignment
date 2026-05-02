'use strict';

/**
 * Backpressure: a stuck client (we never read its socket on the test
 * side; we use a low limit) should be kicked with `s2c.kicked` and the
 * socket closed once the gateway's pending counter exceeds the limit.
 */

const WebSocket = require('ws');
const { bootStack, tokenFor, urlFor } = require('./test-helpers');
const { delta } = require('@hijack/protocol/messages');

describe('backpressure', () => {
  it('kicks a client past the limit', async () => {
    const stack = await bootStack({ tableId: '1', backpressureLimit: 3 });
    try {
      const tableId = '1';
      const ws = new WebSocket(urlFor(stack.port, tableId, tokenFor()));
      await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

      // Pause the client socket so the kernel send buffer eventually
      // fills and the server-side `ws.send` callbacks stop firing —
      // which is what `pending` actually tracks. With small payloads
      // the kernel drains them immediately and the counter never
      // grows; large payloads guarantee the queue piles up.
      ws._socket.pause();

      // Skip c2s.join to keep things simple — directly invoke
      // _broadcast on the gateway.
      // We have access to the same gateway instance via stack.
      const gw = stack.gateway;

      // Find our server-side socket.
      const [serverWs] = [...gw.wss.clients];
      expect(serverWs).toBeDefined();
      // Mark joined so future actions wouldn't bounce — also harmless here.
      serverWs._hijack.joined = true;

      // Listen for both the server's close-frame request (state goes
      // to CLOSING immediately) and the final close event (only fires
      // once the close handshake completes — needs the paused client
      // to drain).
      const clientClosed = new Promise((r) => ws.on('close', (code) => r(code)));

      // 64 KB payload per frame ensures the OS send buffer fills fast.
      const bigPayload = { junk: 'x'.repeat(64 * 1024) };
      let i = 1;
      const maxBlast = 200;
      while (i < maxBlast && serverWs.readyState === serverWs.OPEN) {
        gw._broadcast(tableId, delta(tableId, i, 5, bigPayload));
        i++;
        await new Promise((r) => setImmediate(r));
      }

      // Server is in CLOSING (state=2) — it sent a close frame. The
      // client never sees it while paused, so resume it now and wait
      // for the close to complete on the client side.
      expect(serverWs.readyState).not.toBe(serverWs.OPEN);
      try { ws._socket.resume(); } catch (_e) {}

      const code = await clientClosed;
      // 1013 = "try again later" — we use this for backpressure.
      expect([1013, 1006, 1011]).toContain(code);
    } finally {
      await stack.stop();
    }
  });
});
