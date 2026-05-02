'use strict';

/**
 * Smoke test — drive one full hand end-to-end via processTable.
 * Two-player heads-up table; SB calls the BB, both check thereafter.
 *
 * This exercises:
 *   - All 16 step labels in GAME_HAND (some collapse — e.g. preflop
 *     betting is two ticks not one).
 *   - Pipelined Redis writes (we use ioredis-mock).
 *   - Durable event append (MemoryHandEventStore stand-in for Neon).
 *   - `handDone` signal at RECORD_STATS_AND_NEW_HAND.
 */

const { makeStore, makeInitialState } = require('./test-helpers');
const { processTable } = require('../src/tick');
const { GAME_HAND, ACTION } = require('@hijack/engine');

async function runOneHand(stateStore, tableId, maxSteps = 40) {
  const events = [];
  for (let i = 0; i < maxSteps; i++) {
    let result = await processTable(stateStore, tableId);
    if (result.status === 'awaiting_action') {
      // Inspect current state to decide a check/call action.
      const state = await stateStore.loadTable(tableId);
      const seat = state.game.move;
      const player = state.players.find((p) => p.seat === seat);
      const owed = state.game.currentBet - (player.bet || 0);
      const action = owed > 0 ? ACTION.CALL : ACTION.CHECK;
      const amount = owed > 0 ? state.game.currentBet : 0;
      result = await processTable(stateStore, tableId, { seat, action, amount });
    }
    events.push(result);
    if (result.handDone) return { events, ticks: i + 1 };
  }
  throw new Error(`hand did not finish in ${maxSteps} ticks`);
}

describe('smoke — one full hand', () => {
  it('completes a hand and writes durable events', async () => {
    const { stateStore, eventStore } = makeStore();
    await stateStore.initTable(1, makeInitialState());

    const { events, ticks } = await runOneHand(stateStore, 1);

    // The phase doc estimates ~16 events per hand; with a heads-up
    // call+check sequence we typically see ~17-21 ticks. Assert a
    // floor so we know the loop actually ran a full hand.
    expect(ticks).toBeGreaterThanOrEqual(16);
    expect(events[events.length - 1].handDone).toBe(true);
    expect(events[events.length - 1].step).toBe(GAME_HAND.RECORD_STATS_AND_NEW_HAND);

    const durable = await eventStore.loadEvents('1:1');
    expect(durable.length).toBeGreaterThanOrEqual(16);
    // seqs should be contiguous from 1.
    durable.forEach((e, i) => expect(e.seq).toBe(i + 1));
  });

  it('memory footprint per table stays under 50KB', async () => {
    const { stateStore } = makeStore();
    await stateStore.initTable(1, makeInitialState());
    await runOneHand(stateStore, 1);
    const bytes = await stateStore.measureFootprint(1);
    expect(bytes).toBeLessThan(50_000);
  });
});
