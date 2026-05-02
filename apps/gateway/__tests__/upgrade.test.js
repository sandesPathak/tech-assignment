'use strict';

/**
 * Upgrade-path tests: bad auth → 401, good auth → WS opens, mismatched
 * tableId in token → 401.
 */

const WebSocket = require('ws');
const { bootStack, tokenFor, urlFor, TEST_SECRET } = require('./test-helpers');
const { signToken } = require('../src/auth');

describe('WS upgrade auth', () => {
  let stack;
  beforeAll(async () => { stack = await bootStack({ tableId: '1' }); });
  afterAll(async () => { await stack.stop(); });

  function open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on('open', () => resolve(ws));
      ws.on('unexpected-response', (_req, res) => {
        reject(new Error(`http ${res.statusCode}`));
        ws.terminate();
      });
      ws.on('error', (err) => reject(err));
    });
  }

  it('rejects when token is missing', async () => {
    const url = `ws://127.0.0.1:${stack.port}/table/1`;
    await expect(open(url)).rejects.toThrow(/401/);
  });

  it('rejects bad signature', async () => {
    const tok = signToken({ sub: 'u1', tableId: '1', sessionId: 's1' }, { secret: 'WRONG' });
    await expect(open(urlFor(stack.port, '1', tok))).rejects.toThrow(/401/);
  });

  it('rejects token whose tableId does not match URL', async () => {
    const tok = signToken({ sub: 'u1', tableId: '999', sessionId: 's1' }, { secret: TEST_SECRET });
    await expect(open(urlFor(stack.port, '1', tok))).rejects.toThrow(/401/);
  });

  it('accepts a valid token', async () => {
    const ws = await open(urlFor(stack.port, '1', tokenFor()));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => ws.on('close', r));
  });
});
