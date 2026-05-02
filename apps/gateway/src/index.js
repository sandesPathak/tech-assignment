'use strict';

/**
 * Gateway entrypoint — boot the WS server with real Redis + stateStore.
 *
 * The worker package owns the StateStore + HandEventStore types; the
 * gateway re-uses those classes (it's a sibling workspace dep) so
 * hot-state lookups and durable replay come from one source of truth.
 */

const Redis = require('ioredis');
const { Gateway } = require('./ws-server');
const { attachCoachApi } = require('./coach-api');
const { attachProfileBus } = require('./profile-bus');
const { StateStore } = require('@hijack/worker/src/state-store');
const { createHandEventStore } = require('@hijack/worker/src/hand-event-store');
const { initTracing, shutdownTracing } = require('@hijack/observability/tracing');
const { createLogger } = require('@hijack/observability/logger');

async function main() {
  await initTracing({ serviceName: 'hijack-gateway' });
  const log = createLogger({ serviceName: 'hijack-gateway' });

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(redisUrl);
  const eventStore = await createHandEventStore();
  const stateStore = new StateStore({ redis, eventStore });

  const saturationPct = Number(process.env.GATEWAY_SATURATION_PCT || 99);
  const workerUrl = process.env.WORKER_URL || 'http://127.0.0.1:3001';

  // Drive the worker's engine: post /process repeatedly until the engine
  // is awaiting a human action. Strict single-flight per tableId so the
  // tick rate stays paced regardless of how many actions fire at once.
  // Actions fed via pumpTable(...,playerAction) are queued and sent on
  // the next iteration of the running pump; if none is running we start
  // one with that action as the first body.
  const inflight = new Map();   // tableId → Promise
  const pendingAction = new Map(); // tableId → playerAction (latest wins)

  async function pumpTable(tableId, playerAction) {
    if (playerAction) pendingAction.set(tableId, playerAction);
    if (inflight.has(tableId)) return inflight.get(tableId);

    const STEP_DELAY = Number(process.env.PUMP_STEP_DELAY_MS || 900);
    const HAND_DELAY = Number(process.env.PUMP_HAND_DELAY_MS || 3000);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const run = (async () => {
      let lastHandId = null;
      for (let i = 0; i < 200; i += 1) {
        const queued = pendingAction.get(tableId);
        pendingAction.delete(tableId);
        const body = queued ? { tableId, ...queued } : { tableId };
        let res;
        try {
          res = await fetch(`${workerUrl}/process`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch (err) {
          log.warn({ err: err.message, tableId }, 'pump_fetch_failed');
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (json.status === 'error' || json.status === 'not_found') return;
        if (json.status === 'awaiting_action') {
          // Park until an action is queued.
          for (let waited = 0; waited < 60_000; waited += 100) {
            if (pendingAction.has(tableId)) break;
            await sleep(100);
          }
          if (!pendingAction.has(tableId)) return; // 60s idle → give up
          continue;
        }
        if (json.handDone) {
          if (lastHandId !== json.handId) lastHandId = json.handId;
          await sleep(HAND_DELAY);
        } else {
          await sleep(STEP_DELAY);
        }
      }
    })().finally(() => inflight.delete(tableId));
    inflight.set(tableId, run);
    return run;
  }

  const gateway = new Gateway({
    redis,
    subscriberFactory: () => new Redis(redisUrl),
    stateStore,
    eventStore,
    shardSaturationThreshold: saturationPct,
    onAction: async (msg /*, ctx */) => {
      await pumpTable(msg.tableId, {
        seat: msg.seat,
        action: msg.action,
        amount: msg.amount,
      });
    },
    onJoin: async (ctx) => {
      if (!ctx?.tableId) return;
      // Seated joins: insert the player into the engine state via /sit.
      // Spectator joins (seat == null) are skipped.
      if (ctx.seat != null && ctx.userId) {
        try {
          await fetch(`${workerUrl}/sit`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              tableId: ctx.tableId,
              seat: ctx.seat,
              playerId: ctx.userId,
              username: ctx.username || ctx.userId,
            }),
          });
        } catch (err) {
          log.warn({ err: err.message, tableId: ctx.tableId }, 'sit_failed');
        }
      }
      // Kickstart engine: advance until awaiting_action. With ≥2 seated
      // players the engine deals; with <2 it stays idle.
      pumpTable(ctx.tableId).catch(() => {});
    },
    log: (evt, fields) => log.warn(fields, evt),
  });

  const port = parseInt(process.env.PORT || '3002', 10);
  await gateway.start({ port });
  // Phase 4 follow-up: HTTP /api/coach/:handId/:hero proxy + hand:completed
  // re-broadcast as s2c.delta with payload.kind='hand_completed'. Additive
  // — never modifies existing routes.
  try { await attachCoachApi(gateway); }
  catch (err) { log.warn({ err: err.message }, 'coach_api_attach_failed'); }
  // Phase 5: subscribe to `profile:updated` and re-broadcast as
  // `s2c.delta` with payload.kind='player_updated' to seated tables.
  try { await attachProfileBus(gateway); }
  catch (err) { log.warn({ err: err.message }, 'profile_bus_attach_failed'); }
  log.info({ port }, 'gateway_listening');

  const shutdown = async (signal) => {
    log.info({ signal }, 'gateway_shutting_down');
    await gateway.stop();
    redis.disconnect();
    await shutdownTracing();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[gateway] fatal:', err);
    process.exit(1);
  });
}

module.exports = { main };
