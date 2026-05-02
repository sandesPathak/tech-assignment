'use strict';

const Redis = require('ioredis');
const { StateStore } = require('./state-store');
const { createHandEventStore } = require('./hand-event-store');
const { createServer } = require('./server');
const { Publisher } = require('./publish');
const { initTracing, shutdownTracing } = require('@hijack/observability/tracing');
const { createLogger } = require('@hijack/observability/logger');
const { ShardMetricsReporter } = require('@hijack/observability/shard-metrics');
const { Matchmaker } = require('./matchmaker');

/**
 * Boot the worker:
 *   - Connect ioredis (REDIS_URL or default localhost:6379).
 *   - Connect HandEventStore (Neon if DATABASE_URL, in-memory otherwise).
 *   - Wire a Publisher that fans out per-tick events to the gateway via
 *     Redis pub/sub on `table:{id}:events`.
 *   - Start HTTP server on PORT (default 3001).
 */
async function main() {
  // No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
  await initTracing({ serviceName: 'hijack-worker' });
  const log = createLogger({ serviceName: 'hijack-worker' });

  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const eventStore = await createHandEventStore();
  const stateStore = new StateStore({ redis, eventStore });
  const publisher = new Publisher({ redis, log: (evt, fields) => log.warn(fields, evt) });
  const server = createServer({ stateStore, publisher, log });
  const matchmaker = new Matchmaker({
    redis,
    stateStore,
    log: (evt, fields) => log.warn(fields, evt),
  });
  matchmaker.start();
  const port = parseInt(process.env.PORT || '3001', 10);

  // Shard metrics — every 5s, write `metrics:shard:{id}` so the gateway
  // can decide when to load-shed new joins.
  const shardId = process.env.SHARD_ID || 'shard-0';
  const reporter = new ShardMetricsReporter({
    redis,
    shardId,
    sampler: () => stateStore.sampleShardMetrics(),
    log: (evt, fields) => log.warn(fields, evt),
  });
  reporter.start();

  await new Promise((resolve) => server.listen(port, resolve));
  log.info({ port, shardId }, 'worker_listening');

  const shutdown = async (signal) => {
    log.info({ signal }, 'worker_shutting_down');
    reporter.stop();
    matchmaker.stop();
    server.close();
    await eventStore.close();
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
    console.error('[worker] fatal:', err);
    process.exit(1);
  });
}

module.exports = { main };
