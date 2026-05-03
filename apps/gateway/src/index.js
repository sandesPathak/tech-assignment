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

  // Hard-fail if the gateway can't sign/verify auth tokens. Otherwise
  // misconfigured prod deploys silently fall back to no-auth on every
  // route that depends on the JWT secret.
  if (!process.env.GATEWAY_JWT_SECRET || process.env.GATEWAY_JWT_SECRET.length < 16) {
    // Allow tests / local-dev to opt out by exporting an obvious dev
    // value, but force operators to set SOMETHING.
    if (process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console
      console.error('[gateway] FATAL: GATEWAY_JWT_SECRET unset or too short (<16 chars).');
      process.exit(1);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[gateway] WARN: GATEWAY_JWT_SECRET unset or short — using insecure dev fallback.');
      process.env.GATEWAY_JWT_SECRET = process.env.GATEWAY_JWT_SECRET || 'dev-only-insecure-secret-change-me';
    }
  }

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

  // Late-bound: gateway is constructed below us. We pass this lookup
  // into pumpTable so the auto-fold-on-disconnect check can probe live
  // sockets without circular-importing the Gateway class.
  let gatewayRef = null;
  function isSeatLive(tableId, seat) {
    if (!gatewayRef || !gatewayRef.byTable) return true; // best-effort
    const set = gatewayRef.byTable.get(String(tableId));
    if (!set) return false;
    for (const ws of set) {
      const meta = ws._hijack;
      if (!meta) continue;
      if (meta.spectator) continue;
      if (Number(meta.seat) === Number(seat)) return true;
    }
    return false;
  }

  async function pumpTable(tableId, playerAction) {
    if (playerAction) pendingAction.set(tableId, playerAction);
    if (inflight.has(tableId)) return inflight.get(tableId);

    const STEP_DELAY = Number(process.env.PUMP_STEP_DELAY_MS || 900);
    const HAND_DELAY = Number(process.env.PUMP_HAND_DELAY_MS || 3000);
    // Grace period before auto-folding a player whose WS is gone.
    // Generous enough to ride out a quick reconnect, short enough that
    // the table doesn't visibly stall.
    const ORPHAN_AUTOFOLD_MS = Number(process.env.PUMP_ORPHAN_AUTOFOLD_MS || 6000);
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
          // The acting seat is in `json.move`. If that seat has no live
          // WS bound to it on this gateway AND the seat is occupied by
          // a bot (predictable playerId prefix), park briefly then
          // auto-fold so the rest of the table doesn't hang on a dead
          // bot process. Humans are NEVER auto-folded — they get the
          // full 60s park (and no fold at all on timeout). Brief WS
          // reconnects from a page reload won't punish the user.
          const actingSeat = Number(json.move);
          let actingPlayerId = null;
          try {
            const raw = await redis.hget(`table:${tableId}`, 'players');
            if (raw) {
              const arr = JSON.parse(raw);
              const acting = arr.find((p) => Number(p.seat) === actingSeat);
              if (acting) actingPlayerId = String(acting.playerId || '');
            }
          } catch (_e) { /* best-effort */ }
          const isBot = actingPlayerId && /^bot-/.test(actingPlayerId);
          let waited = 0;
          let autoFolded = false;
          for (; waited < 60_000; waited += 200) {
            if (pendingAction.has(tableId)) break;
            // Only consider auto-folding bot seats. Human seats park the
            // full 60s and then the pump exits without acting.
            if (isBot && waited >= ORPHAN_AUTOFOLD_MS && !isSeatLive(tableId, actingSeat)) {
              pendingAction.set(tableId, { seat: actingSeat, action: 'fold', amount: 0 });
              autoFolded = true;
              log.warn({ tableId, seat: actingSeat, playerId: actingPlayerId }, 'orphan_seat_autofold');
              fetch(`${workerUrl}/leave`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tableId, playerId: actingPlayerId }),
              }).catch(() => { /* best-effort */ });
              break;
            }
            await sleep(200);
          }
          if (!pendingAction.has(tableId) && !autoFolded) return; // idle exhausted → give up
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

  // Track in-flight `/sit` retries so we can cancel them when the
  // user disconnects. Key: `${tableId}|${userId}`. Value: cancel fn.
  const pendingSits = new Map();

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
        const key = `${ctx.tableId}|${ctx.userId}`;
        // Cancel any previous retry loop for this same (table, user) —
        // happens on a quick reconnect.
        const prev = pendingSits.get(key);
        if (prev) prev();

        let cancelled = false;
        let timer = null;
        const cancel = () => {
          cancelled = true;
          if (timer) clearTimeout(timer);
          pendingSits.delete(key);
        };
        pendingSits.set(key, cancel);

        const attempt = async (tries) => {
          if (cancelled) return;
          let res;
          try {
            res = await fetch(`${workerUrl}/sit`, {
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
            return;
          }
          if (res.ok) {
            cancel();
            // Nudge engine — adding a player may unblock the deal-cards
            // gate if the table was waiting for a quorum.
            pumpTable(ctx.tableId).catch(() => {});
            return;
          }
          if (res.status === 409 && tries < 40) {
            // Mid-hand: the seat is still held by the previous occupant
            // (cards in hand). Try again every 3s — a hand at our pace
            // is ~5–8s, so we'll usually land on the 1st or 2nd retry.
            // 40 tries × 3s = 2 min hard cap to avoid leaks.
            timer = setTimeout(() => attempt(tries + 1), 3000);
            return;
          }
          // Non-409 failure or out of retries: give up but keep the
          // socket open so the user still sees the table as a spectator.
          log.warn(
            { tableId: ctx.tableId, status: res.status, tries },
            'sit_retry_exhausted',
          );
          cancel();
        };
        attempt(0).catch(() => cancel());
      }
      // Kickstart engine: advance until awaiting_action. With ≥2 seated
      // players the engine deals; with <2 it stays idle.
      pumpTable(ctx.tableId).catch(() => {});
    },
    onLeave: async (ctx) => {
      // Cancel any pending /sit retry — the user is gone, no point
      // pestering the worker.
      const key = `${ctx?.tableId}|${ctx?.userId}`;
      const cancel = pendingSits.get(key);
      if (cancel) cancel();
      // Socket dropped while the player was seated. Tell the worker so
      // the seat is freed in engine state AND the seat reservation in
      // Redis is cleared — otherwise the table stalls forever waiting
      // on a ghost (orphaned bot, browser closed, dev restart, etc).
      if (!ctx?.tableId || !ctx.userId) return;
      try {
        await fetch(`${workerUrl}/leave`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tableId: ctx.tableId, playerId: ctx.userId }),
        });
      } catch (err) {
        log.warn({ err: err.message, tableId: ctx.tableId }, 'leave_failed');
      }
      // Also drop the lobby's seat-claim row + bump openSeats so the
      // matchmaker / fill-table can hand the seat to a live player.
      try {
        const stake = await redis.hget(`table:${ctx.tableId}:meta`, 'stake');
        if (stake) {
          await redis.hdel(`table:${ctx.tableId}:seats`, String(ctx.seat));
          await redis.zincrby(`lobby:${stake}:tables`, 1, ctx.tableId);
        }
      } catch (_e) { /* best-effort */ }
      // Nudge the engine to advance: if the leaver was the acting player,
      // the worker auto-folds them on next tick.
      pumpTable(ctx.tableId).catch(() => {});
    },
    log: (evt, fields) => log.warn(fields, evt),
  });

  // Wire the late-bound gateway reference so pumpTable's auto-fold can
  // probe live sockets via gatewayRef.byTable.
  gatewayRef = gateway;
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
