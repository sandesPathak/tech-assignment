'use strict';

/**
 * Reconnection test.
 *
 *   1. Connect, send c2s.join with lastSeq=0 → snapshot.
 *   2. Drive a few ticks; observe N deltas.
 *   3. Disconnect.
 *   4. Drive M more ticks while disconnected.
 *   5. Reconnect with lastSeq=N. Gateway should replay events
 *      (N+1 .. N+M) in order, with no gaps and no duplicates.
 *   6. Snapshot path: disconnect long enough that we cross the gap
 *      threshold → reconnect with very small lastSeq → expect snapshot
 *      (not replay).
 */

const WebSocket = require('ws');
const { bootStack, tokenFor, urlFor } = require('./test-helpers');
const { processTable } = require('@hijack/worker/src/tick');
const { ACTION } = require('@hijack/engine');

function open(port, tableId, sessionId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(urlFor(port, tableId, tokenFor({ tableId, sessionId })));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function awaitFrames(ws, predicate, timeoutMs = 2500) {
  // Resolve once `predicate(framesSoFar)` returns true.
  return new Promise((resolve, reject) => {
    const frames = [];
    const t = setTimeout(() => reject(new Error('await frames timeout')), timeoutMs);
    const onMsg = (raw) => {
      frames.push(JSON.parse(raw.toString()));
      if (predicate(frames)) {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(frames);
      }
    };
    ws.on('message', onMsg);
  });
}

async function nextStep(stateStore, tableId, publisher) {
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
  return r;
}

describe('reconnection', () => {
  it('replays missed events with no gaps when lastSeq is recent', async () => {
    const stack = await bootStack({ tableId: '1' });
    try {
      const tableId = '1';
      const ws1 = await open(stack.port, tableId, 'sess');
      ws1.send(JSON.stringify({ t: 'c2s.join', tableId, lastSeq: 0 }));

      // Set up the await BEFORE driving ticks so we don't miss any
      // pub/sub frames. Then kick off ticks in parallel.
      const collected = awaitFrames(ws1, (frames) =>
        frames.some((f) => f.t === 's2c.snapshot') &&
        frames.filter((f) => f.t === 's2c.delta').length >= 5
      , 4000);

      // Drive several ticks in the background; pub/sub will populate
      // the awaiter's frame buffer.
      (async () => {
        for (let i = 0; i < 8; i++) {
          await nextStep(stack.stateStore, tableId, stack.publisher);
        }
      })().catch(() => {});

      const initial = await collected;
      const beforeDeltas = initial.filter((f) => f.t === 's2c.delta');
      expect(beforeDeltas.length).toBeGreaterThanOrEqual(5);
      const lastSeq = beforeDeltas[beforeDeltas.length - 1].seq;

      ws1.close();
      await new Promise((r) => ws1.on('close', r));

      // Drive more ticks while disconnected.
      const ticksWhileGone = 6;
      for (let i = 0; i < ticksWhileGone; i++) {
        const r = await nextStep(stack.stateStore, tableId, stack.publisher);
        if (r.handDone) break;
      }

      // Reconnect with lastSeq.
      const ws2 = await open(stack.port, tableId, 'sess-2');
      ws2.send(JSON.stringify({ t: 'c2s.join', tableId, lastSeq }));

      // Expect a series of `s2c.delta` (replay), not snapshot.
      const replayFrames = await awaitFrames(ws2, (frames) => {
        const deltas = frames.filter((f) => f.t === 's2c.delta');
        return deltas.length >= 1 && frames.every((f) => f.t === 's2c.delta');
      }, 3000).catch(() => []);

      const replayDeltas = replayFrames.filter((f) => f.t === 's2c.delta');
      expect(replayDeltas.length).toBeGreaterThanOrEqual(1);
      // Every replayed seq strictly greater than lastSeq, in order.
      let prev = lastSeq;
      for (const f of replayDeltas) {
        expect(f.seq).toBe(prev + 1);
        prev = f.seq;
      }

      ws2.close();
      await new Promise((r) => ws2.on('close', r));
    } finally {
      await stack.stop();
    }
  });

  it('falls back to snapshot when gap > MAX_REPLAY_GAP', async () => {
    // Boot a stack and drive past the replay window. We don't actually
    // need 500+ events — we just lie about lastSeq being from the
    // future-past (i.e. negative number relative to head). The
    // simplest deterministic check: pass lastSeq=1 against a head that
    // is several ticks ahead AND inject a tiny maxReplayGap via a
    // direct call to planResume. We test the direct path here (the
    // ws-server uses default 500).
    const { planResume } = require('../src/resume');
    const stack = await bootStack({ tableId: '2' });
    try {
      const tableId = '2';
      // Drive a couple of ticks.
      for (let i = 0; i < 4; i++) {
        await nextStep(stack.stateStore, tableId, stack.publisher);
      }
      const plan = await planResume({
        redis: stack.command,
        stateStore: stack.stateStore,
        eventStore: stack.eventStore,
        tableId,
        lastSeq: 1,
        maxReplayGap: 1, // force snapshot
      });
      expect(plan.mode).toBe('snapshot');
      expect(plan.frame.t).toBe('s2c.snapshot');
    } finally {
      await stack.stop();
    }
  });
});
