'use strict';

/**
 * coach worker — subscribes to `hand:completed` on Redis and processes
 * one hand at a time:
 *
 *   1. Receive { handId, tableId, fromSeq, toSeq } from Redis pub/sub.
 *   2. Load hand events from durable store (Neon `hand_events`).
 *   3. For each player who hasn't disabled the coach: build a hand
 *      context, run analyze.js, hit the situation cache, otherwise
 *      call Claude Haiku via llm.js.
 *   4. Persist `(hand_id, hero, findings, prose, cache_hit)` to Neon
 *      `hand_analysis`.
 *
 * Bootstrap is best-effort: pub/sub is the trigger, durable hand_events
 * is the source of truth. Replay is just `for handId in untreated:
 * processHand(handId)`.
 */

const { CoachCache, situationHash } = require('./cache');
const { analyzeHand } = require('./analyze');
const { CoachLLM } = require('./llm');
const { extractTraceContext, withSpan } = require('@hijack/observability/tracing');

class CoachWorker {
  /**
   * @param {object} deps
   * @param {object} deps.subRedis     Redis subscribe client
   * @param {object} deps.pubRedis     Redis command client (cache)
   * @param {object} deps.eventStore   HandEventStore (read durable hand events)
   * @param {object} deps.analysisStore  AnalysisStore (write hand_analysis)
   * @param {object} [deps.llm]        CoachLLM (or stub)
   * @param {object} [deps.cache]      CoachCache (or built from pubRedis)
   * @param {(...args:any[]) => void} [deps.log]
   * @param {(handId:string) => Promise<{ players, hero, dealerSeat, bigBlindSeat, bigBlind }>} [deps.handContextLoader]
   *   Adapter for fetching the player-side info (hole cards, dealer seat).
   *   In production the worker writes a `hand:{id}:context` hash; tests
   *   inject this adapter directly.
   */
  constructor(deps) {
    this.subRedis = deps.subRedis;
    this.pubRedis = deps.pubRedis;
    this.eventStore = deps.eventStore;
    this.analysisStore = deps.analysisStore;
    this.llm = deps.llm || new CoachLLM();
    this.cache = deps.cache || new CoachCache({ redis: deps.pubRedis });
    this.log = deps.log || (() => {});
    this.handContextLoader = deps.handContextLoader || null;
    this._stop = false;
  }

  async start() {
    await this.subRedis.subscribe('hand:completed');
    this.subRedis.on('message', async (channel, raw) => {
      if (channel !== 'hand:completed' || this._stop) return;
      try {
        const msg = JSON.parse(raw);
        // Continue the trace started by the worker. Logs will carry
        // traceId so a single hand is queryable end-to-end in Grafana.
        const tc = extractTraceContext(msg);
        if (tc) this.log('coach_trace', { handId: msg.handId, traceId: tc.traceId });
        await withSpan(
          'coach.processHand',
          { 'hijack.hand_id': msg.handId, 'hijack.trace_id': tc?.traceId },
          () => this.processHand(msg)
        );
      } catch (err) {
        this.log('coach_message_failed', { err: err.message });
      }
    });
  }

  async stop() {
    this._stop = true;
    try { await this.subRedis.unsubscribe('hand:completed'); } catch (_) {}
  }

  /**
   * Process one hand_completed message. Idempotent — re-processing a
   * hand is a cheap cache hit.
   *
   * @param {{ handId:string, tableId:string, fromSeq:number, toSeq:number }} msg
   */
  async processHand(msg) {
    const { handId, fromSeq = 1, toSeq } = msg;
    const events = await this.eventStore.range(handId, fromSeq, toSeq);
    if (!events || events.length === 0) {
      this.log('coach_no_events', { handId });
      return;
    }

    const ctx = this.handContextLoader
      ? await this.handContextLoader(handId, events)
      : null;
    if (!ctx) {
      this.log('coach_no_context', { handId });
      return;
    }

    const heroes = Array.isArray(ctx.heroes) ? ctx.heroes : [ctx.hero];
    const results = [];
    for (const hero of heroes) {
      if (!hero) continue;
      const result = await this.processForHero({
        handId,
        events,
        hero,
        players: ctx.players,
        dealerSeat: ctx.dealerSeat,
        bigBlindSeat: ctx.bigBlindSeat,
        bigBlind: ctx.bigBlind,
      });
      if (result) results.push(result);
    }
    return results;
  }

  async processForHero({ handId, events, hero, players, dealerSeat, bigBlindSeat, bigBlind }) {
    const handContext = {
      handId,
      events,
      hero,
      players,
      dealerSeat,
      bigBlindSeat,
      bigBlind,
    };
    const analysis = analyzeHand(handContext);

    // Single situation hash — first finding is usually the most recent
    // / largest decision; for caching we collapse to the lead spot.
    const lead = analysis.findings[0] || {};
    const situationKey = situationHash({
      stack_bb: lead.stack_bb || 100,
      position: lead.position,
      hole_class: lead.hole_class,
      action_history: [],
      board: lead.board,
    });

    const cached = await this.cache.get({
      stack_bb: lead.stack_bb || 100,
      position: lead.position,
      hole_class: lead.hole_class,
      action_history: [],
      board: lead.board,
    });

    let prose;
    let cacheHit = false;
    if (cached) {
      prose = cached;
      cacheHit = true;
    } else {
      prose = await this.llm.generate(analysis);
      await this.cache.set({
        stack_bb: lead.stack_bb || 100,
        position: lead.position,
        hole_class: lead.hole_class,
        action_history: [],
        board: lead.board,
      }, prose);
    }

    const row = {
      hand_id: handId,
      hero: String(hero),
      situation_hash: situationKey,
      findings: analysis.findings,
      prose,
      token_usage: prose.raw?.usage || null,
      cache_hit: cacheHit,
    };
    await this.analysisStore.insert(row);
    return row;
  }
}

/**
 * Process bootstrap. Wires everything together when running the
 * coach as a real Fly machine.
 */
async function main() {
  // eslint-disable-next-line global-require
  const Redis = require('ioredis');
  // eslint-disable-next-line global-require
  const { createHandEventStore } = require('@hijack/worker/src/hand-event-store');

  const subRedis = new Redis(process.env.REDIS_URL);
  const pubRedis = new Redis(process.env.REDIS_URL);
  const eventStore = await createHandEventStore({ driver: 'pg' });
  const { createAnalysisStore } = require('./repo');
  const analysisStore = await createAnalysisStore({ driver: 'pg' });

  const worker = new CoachWorker({
    subRedis,
    pubRedis,
    eventStore,
    analysisStore,
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  });
  await worker.start();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event: 'coach_started' }));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

module.exports = { CoachWorker };
