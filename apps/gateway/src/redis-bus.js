'use strict';

/**
 * redis-bus.js — gateway side of the Redis pub/sub bridge.
 *
 * The worker publishes one message per tick to `table:{id}:events`. The
 * gateway subscribes lazily — only to the channels for tables that have
 * at least one connected client.
 *
 * ioredis specifics: a connection that has issued SUBSCRIBE can't issue
 * normal commands. So the bus owns a dedicated subscriber connection,
 * separate from any command connection the host process may need.
 *
 * Bus uses the `psubscribe` API style internally (one shared `pmessage`
 * handler) so adding/removing a single channel is O(1) on Redis even
 * with thousands of tables. We pattern-match on the channel name to
 * route to the right per-table listener set.
 */

const { verify } = require('@hijack/protocol/sign');

const channelPattern = 'table:*:events';
const channelFor = (tableId) => `table:${tableId}:events`;

const TABLE_FROM_CHANNEL = /^table:(.+):events$/;

class RedisBus {
  /**
   * @param {object} opts
   * @param {() => import('ioredis').Redis} opts.subscriberFactory
   *        Factory yielding a fresh ioredis connection. We need a
   *        *new* connection — pub/sub mode is exclusive on a connection.
   * @param {string} [opts.publishSecret]
   *        When set, every received message is HMAC-verified. Mismatched
   *        or missing-when-enforced messages are dropped silently and
   *        logged. Defaults to off (no enforcement) so existing tests
   *        and dev environments don't need to know about the env var.
   * @param {(...args: any[]) => void} [opts.log]
   * @param {boolean} [opts.enforceSig]
   *        When true (or `WORKER_PUBLISH_ENFORCE=1`), unsigned messages
   *        are also dropped. Recommended in production once both ends
   *        share the secret; safer to leave off during rollout.
   */
  constructor(opts) {
    this.subFactory = opts.subscriberFactory;
    /** @type {Map<string, Set<(msg: object) => void>>} */
    this.listeners = new Map();
    this.subscriber = null;
    this.subscribed = false;
    this.publishSecret = opts.publishSecret || null;
    this.enforceSig = opts.enforceSig != null
      ? !!opts.enforceSig
      : (process.env.WORKER_PUBLISH_ENFORCE === '1');
    this.log = opts.log || (() => {});
  }

  async start() {
    if (this.subscribed) return;
    this.subscriber = this.subFactory();
    await this.subscriber.psubscribe(channelPattern);
    this.subscriber.on('pmessage', (_pattern, channel, payload) => {
      const m = channel.match(TABLE_FROM_CHANNEL);
      if (!m) return;
      const tableId = m[1];
      const set = this.listeners.get(tableId);
      if (!set || set.size === 0) return;
      let parsed;
      try { parsed = JSON.parse(payload); } catch (_e) { return; }
      if (this.publishSecret) {
        const result = verify(parsed, this.publishSecret, { enforce: this.enforceSig });
        if (!result.ok) {
          this.log('publish_sig_rejected', { tableId, reason: result.reason });
          return;
        }
      }
      for (const fn of set) {
        try { fn(parsed); } catch (_e) { /* swallow — bus must not die */ }
      }
    });
    this.subscribed = true;
  }

  /**
   * Register a listener for a table. Returns an unsubscribe fn.
   */
  on(tableId, fn) {
    const key = String(tableId);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(fn);
    return () => {
      const s = this.listeners.get(key);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.listeners.delete(key);
    };
  }

  async stop() {
    if (this.subscriber) {
      try { await this.subscriber.punsubscribe(channelPattern); } catch (_e) {}
      this.subscriber.disconnect();
      this.subscriber = null;
    }
    this.listeners.clear();
    this.subscribed = false;
  }
}

module.exports = { RedisBus, channelFor, channelPattern };
