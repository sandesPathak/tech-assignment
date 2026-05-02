'use strict';

const { makeStore, makeInitialState } = require('./test-helpers');

describe('StateStore', () => {
  it('initTable + loadTable round-trip', async () => {
    const { stateStore } = makeStore();
    const state = makeInitialState();
    await stateStore.initTable(1, state);
    const loaded = await stateStore.loadTable(1);
    expect(loaded.game.tableId).toBe(1);
    expect(loaded.players).toHaveLength(2);
    expect(loaded.seq).toBe(0);
  });

  it('applyTick increments seq and writes durable event', async () => {
    const { stateStore, eventStore } = makeStore();
    const state = makeInitialState();
    await stateStore.initTable(1, state);

    const seq = await stateStore.applyTick(
      1,
      state,
      { step: 1, payload: { foo: 'bar' } },
      '1:1'
    );
    expect(seq).toBe(1);
    const events = await eventStore.loadEvents('1:1');
    expect(events).toHaveLength(1);
    expect(events[0].payload.foo).toBe('bar');
  });

  it('snapshot fires every N events', async () => {
    const { stateStore, redis } = makeStore({ snapshotEvery: 4 });
    const state = makeInitialState();
    await stateStore.initTable(1, state);

    for (let i = 0; i < 5; i++) {
      await stateStore.applyTick(1, state, { step: 0, payload: {} }, '1:1');
    }
    const snapStr = await redis.get('table:1:snapshot');
    expect(snapStr).toBeTruthy();
    const snap = JSON.parse(snapStr);
    // Snapshot is taken at seq=4 (the 4th tick), so seq stored == 4.
    expect(snap.seq).toBe(4);
  });

  it('rebuilds hash from snapshot when hash is wiped', async () => {
    const { stateStore, redis } = makeStore({ snapshotEvery: 2 });
    const state = makeInitialState();
    await stateStore.initTable(1, state);
    await stateStore.applyTick(1, state, { step: 1, payload: {} }, '1:1');
    await stateStore.applyTick(1, state, { step: 2, payload: {} }, '1:1');
    // Simulate Redis hash loss (e.g. eviction); snapshot survives.
    await redis.del('table:1');
    const restored = await stateStore.loadTable(1);
    expect(restored).toBeTruthy();
    expect(restored.game.tableId).toBe(1);
  });

  it('measureFootprint reports bytes and stays small', async () => {
    const { stateStore } = makeStore();
    const state = makeInitialState();
    await stateStore.initTable(1, state);
    const bytes = await stateStore.measureFootprint(1);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(50_000);
  });
});
