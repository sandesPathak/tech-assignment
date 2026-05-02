'use strict';

/**
 * tracing.js — shared OpenTelemetry bootstrap + a custom pub/sub
 * propagator for Redis pub/sub messages.
 *
 * Design constraints:
 *  - Must be a no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset so local
 *    dev / unit tests don't bring in heavy SDK init or emit telemetry.
 *  - OTel SDK packages are listed as `optionalDependencies` — services
 *    that haven't installed them still get a working `injectTraceContext`
 *    / `extractTraceContext` path (we fall back to a manual W3C
 *    traceparent serializer that uses crypto.randomBytes for IDs).
 *  - Trace context flows across Redis pub/sub by stamping a `traceparent`
 *    string onto the published JSON payload. The gateway (consumer) reads
 *    it and creates a follower span linked to the worker's span.
 *
 * W3C traceparent format:
 *   `${version}-${traceId}-${spanId}-${flags}`
 *   e.g. `00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01`
 */

const crypto = require('crypto');

const VERSION = '00';
const SAMPLED_FLAG = '01';
const NOT_SAMPLED_FLAG = '00';
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

let sdk = null;
let sdkStarted = false;
let otelApi = null;

function tryRequire(mod) {
  try { return require(mod); } catch (_e) { return null; }
}

function isOtlpConfigured() {
  return !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

/**
 * Initialize the OpenTelemetry Node SDK if OTLP env vars are configured
 * and the SDK packages are installed. No-op otherwise.
 *
 * @param {object} opts
 * @param {string} opts.serviceName  e.g. 'hijack-worker', 'hijack-gateway'
 * @param {string} [opts.serviceVersion]
 * @returns {Promise<{started: boolean, reason?: string}>}
 */
async function initTracing({ serviceName, serviceVersion = '0.1.0' }) {
  if (sdkStarted) return { started: true };
  if (!isOtlpConfigured()) {
    return { started: false, reason: 'OTEL_EXPORTER_OTLP_ENDPOINT_unset' };
  }

  const sdkNode = tryRequire('@opentelemetry/sdk-node');
  const otlp = tryRequire('@opentelemetry/exporter-trace-otlp-http');
  const resources = tryRequire('@opentelemetry/resources');
  const semconv = tryRequire('@opentelemetry/semantic-conventions');
  const api = tryRequire('@opentelemetry/api');

  if (!sdkNode || !otlp || !resources || !api) {
    return { started: false, reason: 'otel_packages_not_installed' };
  }

  otelApi = api;

  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const exporter = new otlp.OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers,
  });

  const SemanticResourceAttributes = (semconv && semconv.SemanticResourceAttributes) || {
    SERVICE_NAME: 'service.name',
    SERVICE_VERSION: 'service.version',
  };

  sdk = new sdkNode.NodeSDK({
    resource: new resources.Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: exporter,
  });

  await sdk.start();
  sdkStarted = true;
  return { started: true };
}

async function shutdownTracing() {
  if (sdk && sdkStarted) {
    try { await sdk.shutdown(); } catch (_e) {}
    sdkStarted = false;
  }
}

function parseHeaders(raw) {
  if (!raw) return {};
  const out = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

// ─── Manual W3C traceparent fallback (works without SDK installed) ──────

function newTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

function newSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Make a traceparent string. If the OTel API is loaded and a span is
 * active, use the live span's context; otherwise mint a fresh one.
 */
function currentTraceparent() {
  if (otelApi) {
    try {
      const active = otelApi.trace.getActiveSpan();
      if (active) {
        const ctx = active.spanContext();
        if (ctx && ctx.traceId && ctx.spanId) {
          const flags = (ctx.traceFlags & 1) ? SAMPLED_FLAG : NOT_SAMPLED_FLAG;
          return `${VERSION}-${ctx.traceId}-${ctx.spanId}-${flags}`;
        }
      }
    } catch (_e) {}
  }
  return `${VERSION}-${newTraceId()}-${newSpanId()}-${NOT_SAMPLED_FLAG}`;
}

/**
 * Stamp a traceparent onto a JSON-serializable event payload that's about
 * to be published through Redis pub/sub. Mutates and returns the input.
 *
 * @param {object} event
 * @param {string} [traceparent]  override (otherwise derived from active span)
 */
function injectTraceContext(event, traceparent) {
  if (!event || typeof event !== 'object') return event;
  event.traceparent = traceparent || currentTraceparent();
  return event;
}

/**
 * Read a traceparent off a payload received from Redis pub/sub.
 * Returns `{ traceId, spanId, sampled }` or `null` if absent/invalid.
 */
function extractTraceContext(event) {
  if (!event || typeof event !== 'object' || !event.traceparent) return null;
  return parseTraceparent(event.traceparent);
}

function parseTraceparent(tp) {
  const m = TRACEPARENT_RE.exec(tp);
  if (!m) return null;
  const [, , traceId, spanId, flags] = m;
  if (traceId === '0'.repeat(32) || spanId === '0'.repeat(16)) return null;
  return {
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & 1) === 1,
    raw: tp,
  };
}

/**
 * Run `fn` inside a span named `name`. If OTel SDK isn't initialized this
 * is just a function call — fn() runs, no overhead.
 *
 * @template T
 * @param {string} name
 * @param {Record<string, any>} attributes
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
async function withSpan(name, attributes, fn) {
  if (!otelApi) {
    otelApi = tryRequire('@opentelemetry/api');
  }
  if (!otelApi) return fn();
  const tracer = otelApi.trace.getTracer('@hijack/observability');
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const out = await fn(span);
      span.end();
      return out;
    } catch (err) {
      span.recordException?.(err);
      span.setStatus?.({ code: 2, message: err.message });
      span.end();
      throw err;
    }
  });
}

module.exports = {
  initTracing,
  shutdownTracing,
  injectTraceContext,
  extractTraceContext,
  parseTraceparent,
  currentTraceparent,
  withSpan,
  isOtlpConfigured,
};
