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

  const gateway = new Gateway({
    redis,
    subscriberFactory: () => new Redis(redisUrl),
    stateStore,
    eventStore,
    log: (evt, fields) => log.warn(fields, evt),
  });

  const port = parseInt(process.env.PORT || '3002', 10);
  await gateway.start({ port });
  // Phase 4 follow-up: HTTP /api/coach/:handId/:hero proxy + hand:completed
  // re-broadcast as s2c.delta with payload.kind='hand_completed'. Additive
  // — never modifies existing routes.
  try { await attachCoachApi(gateway); }
  catch (err) { log.warn({ err: err.message }, 'coach_api_attach_failed'); }
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
