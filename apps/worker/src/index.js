'use strict';

const Redis = require('ioredis');
const { StateStore } = require('./state-store');
const { createHandEventStore } = require('./hand-event-store');
const { createServer } = require('./server');

/**
 * Boot the worker:
 *   - Connect ioredis (REDIS_URL or default localhost:6379).
 *   - Connect HandEventStore (Neon if DATABASE_URL, sqlite otherwise).
 *   - Start HTTP server on PORT (default 3001).
 *
 * Tables are not pre-loaded here — they hydrate on first /process
 * call via stateStore.loadTable, which pulls Redis hash or replays
 * from snapshot+tail.
 */
async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const eventStore = await createHandEventStore();
  const stateStore = new StateStore({ redis, eventStore });
  const server = createServer({ stateStore });
  const port = parseInt(process.env.PORT || '3001', 10);

  await new Promise((resolve) => server.listen(port, resolve));
  // eslint-disable-next-line no-console
  console.log(`[worker] listening on :${port}`);

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${signal} received, shutting down`);
    server.close();
    await eventStore.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[worker] fatal:', err);
    process.exit(1);
  });
}

module.exports = { main };
