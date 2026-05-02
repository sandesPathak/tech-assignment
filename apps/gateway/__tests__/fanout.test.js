'use strict';

/**
 * 10-client fan-out integration test.
 *
 * Boots a real Gateway over ioredis-mock + MemoryHandEventStore, drives
 * one full hand via the worker's processTable + Publisher (so Redis
 * pub/sub is the real path), opens 10 fake WS clients, and asserts
 * every client sees the same final ordered sequence of frames with no
 * gaps.
 */

const WebSocket = require('ws');
const { bootStack, tokenFor, urlFor } = require('./test-helpers');
const { processTable } = require('@hijack/worker/src/tick');
const { ACTION } = require('@hijack/engine');

function awaitFrame(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('frame timeout')), timeoutMs);
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (predicate(m)) {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
  });
}

function collect(ws) {
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  return frames;
}

function openClient(port, tableId, sessionId) {
  return new Promise((resolve, reject) => {
    const tok = tokenFor({ tableId, sessionId });
    const ws = new WebSocket(urlFor(port, tableId, tok));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function joinAndSnapshot(ws, tableId) {
  ws.send(JSON.stringify({ t: 'c2s.join', tableId, lastSeq: 0 }));
  return awaitFrame(ws, (m) => m.t === 's2c.snapshot');
}

async function runOneHand(stateStore, tableId, publisher, maxSteps = 60) {
  for (let i = 0; i < maxSteps; i++) {
    let r = await processTable(stateStore, tableId, undefined, publisher);
    if (r.status === 'awaiting_action') {
      const state = await stateStore.loadTable(tableId);
      const seat = state.game.move;
      const player = state.players.find((p) => p.seat === seat);
      const owed = state.game.currentBet - (player.bet || 0);
      const action = owed > 0 ? ACTION.CALL : ACTION.CHECK;
      const amount = owed > 0 ? state.game.currentBet : 0;
      r = await processTable(stateStore, tableId, { seat, action, amount }, publisher);
    }
    if (r.handDone) return r;
  }
  throw new Error('hand did not finish');
}

describe('fan-out — 10 WS clients see the same hand', () => {
  let stack;
  beforeAll(async () => { stack = await bootStack({ tableId: '1' }); });
  afterAll(async () => { await stack.stop(); });

  it('all 10 clients receive identical delta sequences', async () => {
    const N = 10;
    const tableId = '1';

    // Open all sockets and complete c2s.join + snapshot first, so every
    // client is subscribed before we start ticking.
    const sockets = [];
    for (let i = 0; i < N; i++) {
      const ws = await openClient(stack.port, tableId, `sess-${i}`);
      await joinAndSnapshot(ws, tableId);
      sockets.push(ws);
    }
    const collectors = sockets.map((ws) => collect(ws));

    await runOneHand(stack.stateStore, tableId, stack.publisher);

    // Pub/sub is async — give the event loop a few ticks to drain.
    await new Promise((r) => setTimeout(r, 200));

    // Each client should have received the same set of deltas in seq
    // order. Compare the ordered seq lists.
    const seqLists = collectors.map((frames) =>
      frames.filter((f) => f.t === 's2c.delta').map((f) => f.seq)
    );

    // All 10 lists must be identical.
    const ref = seqLists[0];
    expect(ref.length).toBeGreaterThanOrEqual(16);
    for (let i = 1; i < seqLists.length; i++) {
      expect(seqLists[i]).toEqual(ref);
    }

    // Sequence is contiguous starting at 1.
    ref.forEach((s, i) => expect(s).toBe(i + 1));

    sockets.forEach((ws) => ws.close());
    await Promise.all(sockets.map((ws) => new Promise((r) => ws.on('close', r))));
  });
});
