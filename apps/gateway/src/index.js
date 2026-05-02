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
const { StateStore } = require('@hijack/worker/src/state-store');
const { createHandEventStore } = require('@hijack/worker/src/hand-event-store');

async function main() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(redisUrl);
  const eventStore = await createHandEventStore();
  const stateStore = new StateStore({ redis, eventStore });

  const gateway = new Gateway({
    redis,
    subscriberFactory: () => new Redis(redisUrl),
    stateStore,
    eventStore,
    log: (...a) => console.warn('[gateway]', ...a),
  });

  const port = parseInt(process.env.PORT || '3002', 10);
  await gateway.start({ port });
  // eslint-disable-next-line no-console
  console.log(`[gateway] listening on :${port}`);

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[gateway] ${signal} received, shutting down`);
    await gateway.stop();
    redis.disconnect();
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
