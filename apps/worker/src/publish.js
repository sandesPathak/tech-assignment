'use strict';

/**
 * publish.js — worker-side fan-out into Redis pub/sub.
 *
 * After every successful `applyTick`, the worker publishes the event to
 * `table:{id}:events`. The gateway's pub/sub subscriber relays it to all
 * sockets attached to that table.
 *
 * Design notes:
 *  - The publish client is separate from the command client (ioredis won't
 *    multiplex a connection that's also issuing commands), but ioredis
 *    *does* allow PUBLISH on the same connection as regular commands —
 *    only SUBSCRIBE flips the connection into subscriber mode. So a single
 *    shared command client is fine here. The gateway, by contrast, needs a
 *    second connection because it SUBSCRIBEs.
 *  - Payload is the same shape that the gateway forwards as `s2c.delta`,
 *    so the gateway only has to wrap it in a tableId/t envelope.
 *  - Failures are logged but never thrown — pub/sub is best-effort (the
 *    durable record is in Neon and clients can resume from there).
 */

const { S2C } = require('@hijack/protocol/messages');

const channelFor = (tableId) => `table:${tableId}:events`;

class Publisher {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} opts.redis  command client (used to PUBLISH)
   * @param {(...args: any[]) => void} [opts.log]
   */
  constructor(opts) {
    this.redis = opts.redis;
    this.log = opts.log || (() => {});
  }

  /**
   * Publish a tick to the table channel.
   * @param {string|number} tableId
   * @param {object} ev { handId, seq, step, payload }
   */
  async publishTick(tableId, ev) {
    const msg = {
      t: S2C.DELTA,
      tableId: String(tableId),
      seq: ev.seq,
      step: ev.step,
      payload: ev.payload,
      handId: ev.handId,
    };
    try {
      await this.redis.publish(channelFor(tableId), JSON.stringify(msg));
    } catch (err) {
      // Best-effort. Clients with `lastSeq` will resume from durable store.
      this.log('publish_failed', { tableId, seq: ev.seq, err: err.message });
    }
  }
}

/** No-op publisher used when no Redis is wired (unit tests). */
class NullPublisher {
  async publishTick() {}
}

module.exports = { Publisher, NullPublisher, channelFor };
