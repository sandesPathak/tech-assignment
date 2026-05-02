'use strict';

/**
 * end-to-end.test.js — mock hand_completed → CoachWorker → analysis row.
 *
 * Stubs the Anthropic SDK so no real API call is made. Asserts:
 *   - subscriber wires up to `hand:completed`.
 *   - publishing a message triggers processHand.
 *   - durable analysis row lands in MemoryAnalysisStore.
 *   - second identical message hits the cache (no LLM call).
 */

const RedisMock = require('ioredis-mock');
const { CoachWorker } = require('../src/index');
const { CoachLLM } = require('../src/llm');
const { MemoryAnalysisStore } = require('../src/repo');
const { MemoryHandEventStore } = require('@hijack/worker/src/hand-event-store');
const { GAME_HAND } = require('@hijack/engine');

function makeStubAnthropic(stats = { calls: 0 }) {
  return {
    messages: {
      async create(_req) {
        stats.calls += 1;
        return {
          id: `msg_${stats.calls}`,
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: 'Test coaching prose.',
              decisions: [{ street: 'preflop', tag: 'on_chart', comment: 'Standard open.' }],
            }),
          }],
          usage: {
            cache_creation_input_tokens: stats.calls === 1 ? 1000 : 0,
            cache_read_input_tokens: stats.calls === 1 ? 0 : 1000,
            input_tokens: 200,
            output_tokens: 50,
          },
        };
      },
    },
  };
}

async function seedEvents(eventStore, handId) {
  // 5 events covering preflop + flop. Same shape as worker.
  const events = [
    { step: GAME_HAND.PRE_FLOP_BETTING_ROUND, payload: { pot: 5, currentBet: 3, move: 1, community: [] }, actorSeat: 1, actionTaken: 'raise', actionAmount: 3 },
    { step: GAME_HAND.PRE_FLOP_BETTING_ROUND, payload: { pot: 6, currentBet: 3, move: 2, community: [] }, actorSeat: 2, actionTaken: 'call', actionAmount: 3 },
    { step: GAME_HAND.DEAL_FLOP, payload: { pot: 6, currentBet: 0, move: 1, community: ['AH', 'KD', '7C'] } },
    { step: GAME_HAND.FLOP_BETTING_ROUND, payload: { pot: 10, currentBet: 4, move: 1, community: ['AH', 'KD', '7C'] }, actorSeat: 1, actionTaken: 'bet', actionAmount: 4 },
    { step: GAME_HAND.FLOP_BETTING_ROUND, payload: { pot: 10, currentBet: 4, move: 2, community: ['AH', 'KD', '7C'] }, actorSeat: 2, actionTaken: 'fold', actionAmount: 0 },
  ];
  for (let i = 0; i < events.length; i++) {
    await eventStore.appendEvent({
      handId,
      seq: i + 1,
      step: events[i].step,
      payload: { ...events[i].payload, actorSeat: events[i].actorSeat, actionTaken: events[i].actionTaken, actionAmount: events[i].actionAmount },
    });
  }
}

describe('CoachWorker end-to-end', () => {
  it('processes a hand_completed message and writes an analysis row', async () => {
    // ioredis-mock instances share a global pubsub bus, so two fresh
    // mocks behave like real Redis for publish/subscribe.
    const subRedis = new RedisMock();
    const pubRedis = new RedisMock();

    const eventStore = new MemoryHandEventStore();
    const analysisStore = new MemoryAnalysisStore();
    const stats = { calls: 0 };
    const llm = new CoachLLM({ client: makeStubAnthropic(stats) });

    // Production-side compat: events stored have actor/action info on
    // the payload because that's how the analyzer extracts decisions.
    // We re-shape them here so the analyzer sees the right fields.
    await seedEvents(eventStore, 't1:1');

    const handContextLoader = async (handId, events) => ({
      players: [
        { playerId: 'p1', seat: 1, cards: ['AS', 'KS'], stack: 200, bet: 0 },
        { playerId: 'p2', seat: 2, cards: ['9D', '8D'], stack: 200, bet: 0 },
      ],
      hero: 'p1',
      dealerSeat: 1,
      bigBlindSeat: 2,
      bigBlind: 2,
      // Map durable event payloads back into the analyzer's expected shape.
      _: events.map((e) => Object.assign(e, e.payload)),
    });

    // Wrap the eventStore.range so events come back with actor fields lifted
    // out of payload (mirroring the production side-channel).
    const eventStoreView = {
      async range(handId, fromSeq, toSeq) {
        const evs = await eventStore.range(handId, fromSeq, toSeq);
        return evs.map((e) => ({
          ...e,
          actorSeat: e.payload?.actorSeat,
          actionTaken: e.payload?.actionTaken,
          actionAmount: e.payload?.actionAmount,
        }));
      },
    };

    const worker = new CoachWorker({
      subRedis,
      pubRedis,
      eventStore: eventStoreView,
      analysisStore,
      llm,
      handContextLoader,
    });
    await worker.start();

    // Publish a hand_completed message and wait for delivery.
    const delivered = new Promise((resolve) => {
      const orig = analysisStore.insert.bind(analysisStore);
      analysisStore.insert = async (row) => { await orig(row); resolve(row); };
    });
    await pubRedis.publish('hand:completed', JSON.stringify({
      handId: 't1:1',
      tableId: '1',
      gameNo: 1,
      lastSeq: 5,
      fromSeq: 1,
      toSeq: 6,
    }));
    const row = await delivered;

    expect(row.hand_id).toBe('t1:1');
    expect(row.hero).toBe('p1');
    expect(row.findings.length).toBeGreaterThanOrEqual(1);
    expect(row.prose.summary).toBe('Test coaching prose.');
    expect(row.cache_hit).toBe(false);
    expect(stats.calls).toBe(1);

    // Send the same message again: should hit the cache.
    const delivered2 = new Promise((resolve) => {
      const orig = analysisStore.insert.bind(analysisStore);
      analysisStore.insert = async (r) => { await orig(r); resolve(r); };
    });
    await pubRedis.publish('hand:completed', JSON.stringify({
      handId: 't1:1',
      tableId: '1',
      gameNo: 1,
      lastSeq: 5,
      fromSeq: 1,
      toSeq: 6,
    }));
    const row2 = await delivered2;
    expect(row2.cache_hit).toBe(true);
    expect(stats.calls).toBe(1);  // no extra LLM call

    await worker.stop();
  });
});

describe('CoachLLM with stub Anthropic SDK', () => {
  it('caches the system prompt across calls and tallies usage', async () => {
    const stats = { calls: 0 };
    const llm = new CoachLLM({ client: makeStubAnthropic(stats) });
    const analysis = {
      handId: 'h1',
      hero: 'p1',
      findings: [{
        street: 'preflop',
        position: 'BTN',
        hole_class: 'AA',
        action_taken: 'raise',
        action_taken_ev: 1.2,
        best_action: 'raise',
        best_action_ev: 1.2,
        mistake_bb: 0,
        tag: 'on_chart',
      }],
    };
    const r1 = await llm.generate(analysis);
    const r2 = await llm.generate(analysis);
    expect(r1.summary).toBe('Test coaching prose.');
    expect(r2.summary).toBe('Test coaching prose.');
    // First call writes cache, second reads.
    expect(llm.usage.cache_creation_input_tokens).toBe(1000);
    expect(llm.usage.cache_read_input_tokens).toBe(1000);
    expect(stats.calls).toBe(2);
  });

  it('returns a no-op result on empty findings without calling the SDK', async () => {
    const stats = { calls: 0 };
    const llm = new CoachLLM({ client: makeStubAnthropic(stats) });
    const r = await llm.generate({ handId: 'x', hero: 'y', findings: [] });
    expect(r.decisions).toEqual([]);
    expect(stats.calls).toBe(0);
  });
});
