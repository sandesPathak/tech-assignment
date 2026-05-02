'use strict';

/**
 * logger.js — pino-based structured JSON logger for all services.
 *
 * Always includes `service` field. Callers attach per-context bindings
 * (`traceId`, `tableId`, `userId`) via `.child(bindings)` at the entry
 * point of a request/event. This keeps log output greppable in Grafana
 * Loki without per-log-line boilerplate.
 *
 * pino is preferred over winston (project rule). Output is JSON to stdout
 * — let the platform (Fly.io, Docker) ship it from there.
 */

const pino = require('pino');

let rootLogger = null;

function createLogger({ serviceName, level } = {}) {
  if (rootLogger && !serviceName) return rootLogger;
  const lvl = level || process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  const log = pino({
    name: serviceName || 'hijack',
    level: lvl,
    base: { service: serviceName || 'hijack' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  if (!rootLogger) rootLogger = log;
  return log;
}

/**
 * Build a child logger bound to the current request/event context.
 * Pass any of `{ traceId, tableId, userId, sessionId, handId, seq }`.
 */
function withContext(parentLog, bindings) {
  if (!parentLog) parentLog = createLogger();
  const clean = {};
  for (const [k, v] of Object.entries(bindings || {})) {
    if (v !== undefined && v !== null) clean[k] = v;
  }
  return parentLog.child(clean);
}

module.exports = { createLogger, withContext };
