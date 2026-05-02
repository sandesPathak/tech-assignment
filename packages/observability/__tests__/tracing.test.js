'use strict';

const {
  injectTraceContext,
  extractTraceContext,
  parseTraceparent,
  isOtlpConfigured,
  initTracing,
  withSpan,
} = require('../src/tracing');

describe('tracing — W3C traceparent fallback', () => {
  test('injectTraceContext stamps a parseable traceparent', () => {
    const evt = { foo: 'bar' };
    injectTraceContext(evt);
    expect(typeof evt.traceparent).toBe('string');
    const tc = extractTraceContext(evt);
    expect(tc).not.toBeNull();
    expect(tc.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(tc.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test('extractTraceContext returns null when missing', () => {
    expect(extractTraceContext({ foo: 'bar' })).toBeNull();
    expect(extractTraceContext(null)).toBeNull();
  });

  test('parseTraceparent rejects malformed strings', () => {
    expect(parseTraceparent('not-a-traceparent')).toBeNull();
    expect(parseTraceparent('00-' + '0'.repeat(32) + '-' + '0'.repeat(16) + '-00')).toBeNull();
  });

  test('round-trip: inject then extract preserves traceId/spanId', () => {
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const evt = { x: 1 };
    injectTraceContext(evt, tp);
    const tc = extractTraceContext(evt);
    expect(tc.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(tc.spanId).toBe('b7ad6b7169203331');
    expect(tc.sampled).toBe(true);
  });

  test('isOtlpConfigured reflects env var', () => {
    const prev = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(isOtlpConfigured()).toBe(false);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';
    expect(isOtlpConfigured()).toBe(true);
    if (prev === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prev;
  });

  test('initTracing is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    const prev = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const r = await initTracing({ serviceName: 'unit-test' });
    expect(r.started).toBe(false);
    expect(r.reason).toBe('OTEL_EXPORTER_OTLP_ENDPOINT_unset');
    if (prev !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prev;
  });

  test('withSpan runs fn and returns its value when SDK absent', async () => {
    const out = await withSpan('test.op', { 'x.y': 1 }, async () => 42);
    expect(out).toBe(42);
  });
});
