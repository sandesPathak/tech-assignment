'use strict';

/**
 * Restart-correctness test.
 *
 * Drive a hand part-way (target: step 8 = DEAL_TURN per phase doc),
 * then "kill" the worker by discarding the StateStore + tick wiring.
 * Bring up a fresh StateStore over the SAME redis-mock + event-store
 * instances and confirm the hand resumes from where we left off and
 * finishes correctly.
 *
 * This is the non-negotiable acceptance criterion — kill at step 8,
 * resume, no state loss.
 */

const RedisMock = require('ioredis-mock');
const { StateStore } = require('../src/state-store');
const { MemoryHandEventStore } = require('../src/hand-event-store');
const { processTable } = require('../src/tick');
const { GAME_HAND, ACTION } = require('@hijack/engine');
const { makeInitialState } = require('./test-helpers');

async function tickUntilStep(stateStore, tableId, target, max = 40) {
  for (let i = 0; i < max; i++) {
    const state = await stateStore.loadTable(tableId);
    if (state.game.handStep === target) return i;
    let result = await processTable(stateStore, tableId);
    if (result.status === 'awaiting_action') {
      const cur = await stateStore.loadTable(tableId);
      if (cur.game.handStep === target) return i;
      const seat = cur.game.move;
      const p = cur.players.find((x) => x.seat === seat);
      const owed = cur.game.currentBet - (p.bet || 0);
      const action = owed > 0 ? ACTION.CALL : ACTION.CHECK;
      const amount = owed > 0 ? cur.game.currentBet : 0;
      await processTable(stateStore, tableId, { seat, action, amount });
    }
  }
  throw new Error(`never reached step ${target}`);
}

async function finishHand(stateStore, tableId, max = 40) {
  for (let i = 0; i < max; i++) {
    let result = await processTable(stateStore, tableId);
    if (result.status === 'awaiting_action') {
      const cur = await stateStore.loadTable(tableId);
      const seat = cur.game.move;
      const p = cur.players.find((x) => x.seat === seat);
      const owed = cur.game.currentBet - (p.bet || 0);
      const action = owed > 0 ? ACTION.CALL : ACTION.CHECK;
      const amount = owed > 0 ? cur.game.currentBet : 0;
      result = await processTable(stateStore, tableId, { seat, action, amount });
    }
    if (result.handDone) return i + 1;
  }
  throw new Error('hand did not finish after restart');
}

describe('restart correctness', () => {
  it('resumes mid-hand after a worker kill at step 8 (DEAL_TURN)', async () => {
    const redis = new RedisMock();
    const eventStore = new MemoryHandEventStore();
    let store = new StateStore({ redis, eventStore, snapshotEvery: 16 });
    await store.initTable(1, makeInitialState());

    // Drive past the flop into DEAL_TURN.
    await tickUntilStep(store, 1, GAME_HAND.DEAL_TURN);
    const seqBefore = parseInt(await redis.get('table:1:seq'), 10);
    expect(seqBefore).toBeGreaterThan(0);
    const stateBefore = await store.loadTable(1);
    expect(stateBefore.game.handStep).toBe(GAME_HAND.DEAL_TURN);
    const potBefore = stateBefore.game.pot;
    const communityLenBefore = stateBefore.game.communityCards.length;

    // Simulate worker process death — discard the StateStore handle.
    // Redis + eventStore persist (they would in production too:
    // Upstash Redis + Neon outlive the Fly machine).
    store = null;

    // Boot a fresh StateStore over the same backing services.
    const restarted = new StateStore({ redis, eventStore, snapshotEvery: 16 });
    const stateAfter = await restarted.loadTable(1);
    expect(stateAfter.game.handStep).toBe(GAME_HAND.DEAL_TURN);
    expect(stateAfter.game.pot).toBe(potBefore);
    expect(stateAfter.game.communityCards.length).toBe(communityLenBefore);
    expect(stateAfter.seq).toBe(seqBefore);

    // Finish the hand from the resumed state.
    const ticks = await finishHand(restarted, 1);
    expect(ticks).toBeGreaterThan(0);

    const all = await eventStore.loadEvents('1:1');
    expect(all[all.length - 1].step).toBe(GAME_HAND.RECORD_STATS_AND_NEW_HAND);
    // No seq gaps — restart didn't drop or duplicate any events.
    all.forEach((e, i) => expect(e.seq).toBe(i + 1));
  });

  it('rebuilds state from snapshot when Redis hash is wiped', async () => {
    const redis = new RedisMock();
    const eventStore = new MemoryHandEventStore();
    const store = new StateStore({ redis, eventStore, snapshotEvery: 4 });
    await store.initTable(1, makeInitialState());
    await tickUntilStep(store, 1, GAME_HAND.DEAL_FLOP);

    // Wipe the live hash but keep snapshot — simulates Redis eviction
    // of a hot key after a long idle.
    await redis.del('table:1');
    const restored = await store.loadTable(1);
    expect(restored).toBeTruthy();
    expect(restored.game.tableId).toBe(1);
  });
});
