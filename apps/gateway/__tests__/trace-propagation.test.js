'use strict';

/**
 * trace-propagation.test.js — verifies that a traceparent stamped by the
 * worker's Publisher rides through Redis pub/sub and is read out by the
 * gateway with the SAME trace ID. This is the cross-service boundary
 * that OpenTelemetry context propagation has to clear.
 */

const WebSocket = require('ws');
const { processTable } = require('@hijack/worker/src/tick');
const { bootStack, tokenFor, urlFor } = require('./test-helpers');
const { injectTraceContext } = require('@hijack/observability/tracing');

jest.setTimeout(15000);

function awaitFrames(client, n, predicate) {
  const got = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout awaiting frames')), 4000);
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate && !predicate(msg)) return;
      got.push(msg);
      if (got.length >= n) {
        clearTimeout(timer);
        resolve(got);
      }
    });
  });
}

function waitFor(ws, evt) {
  return new Promise((resolve) => ws.on(evt, resolve));
}

describe('trace context propagation across Redis pub/sub', () => {
  test('worker publish → gateway broadcast preserves traceId', async () => {
    const stack = await bootStack({ tableId: '42', count: 2 });
    const { gateway, port, stateStore, command, publisher } = stack;

    // Spy on broadcast trace logs.
    const observed = [];
    gateway.log = (evt, fields) => {
      if (evt === 'broadcast_trace') observed.push(fields);
    };

    const token = tokenFor({ tableId: '42', userId: 'u1' });
    const client = new WebSocket(urlFor(port, '42', token));
    await waitFor(client, 'open');

    const snapshotPromise = awaitFrames(client, 1, (m) => m.t === 's2c.snapshot');
    client.send(JSON.stringify({ t: 'c2s.join', tableId: '42' }));
    await snapshotPromise;

    // Override Publisher.publishTick to inject a known traceparent so we
    // can assert the same traceId comes out at the gateway side.
    const KNOWN_TP = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const orig = publisher.publishTick.bind(publisher);
    publisher.publishTick = async (tableId, ev) => {
      ev = { ...ev, traceparent: KNOWN_TP };
      return orig(tableId, ev);
    };

    const deltaPromise = awaitFrames(client, 1, (m) => m.t === 's2c.delta');
    // Drive one tick.
    await processTable(stateStore, '42', undefined, publisher);
    const [delta] = await deltaPromise;

    expect(typeof delta.traceparent).toBe('string');
    expect(delta.traceparent).toBe(KNOWN_TP);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed[0].traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    client.close();
    await stack.stop();
  });

  test('publisher injects a traceparent automatically when none provided', async () => {
    const stack = await bootStack({ tableId: '43', count: 2 });
    const { gateway, port, stateStore, publisher } = stack;

    const token = tokenFor({ tableId: '43', userId: 'u1' });
    const client = new WebSocket(urlFor(port, '43', token));
    await waitFor(client, 'open');

    const snapshotPromise = awaitFrames(client, 1, (m) => m.t === 's2c.snapshot');
    client.send(JSON.stringify({ t: 'c2s.join', tableId: '43' }));
    await snapshotPromise;

    const deltaPromise = awaitFrames(client, 1, (m) => m.t === 's2c.delta');
    await processTable(stateStore, '43', undefined, publisher);
    const [delta] = await deltaPromise;

    expect(typeof delta.traceparent).toBe('string');
    expect(delta.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    client.close();
    await stack.stop();
  });
});
