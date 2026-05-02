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
const { injectTraceContext } = require('@hijack/observability/tracing');

const channelFor = (tableId) => `table:${tableId}:events`;
const HAND_COMPLETED_CHANNEL = 'hand:completed';

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
    // Stamp the active span's traceparent so the gateway can extract it
    // and continue the same trace across the Redis pub/sub boundary.
    injectTraceContext(msg, ev.traceparent);
    try {
      await this.redis.publish(channelFor(tableId), JSON.stringify(msg));
    } catch (err) {
      // Best-effort. Clients with `lastSeq` will resume from durable store.
      this.log('publish_failed', { tableId, seq: ev.seq, err: err.message });
    }
  }

  /**
   * Publish a `hand_completed` signal after the worker reaches step 16
   * (RECORD_STATS_AND_NEW_HAND). Consumed by `apps/coach`, which loads
   * the durable hand-event range [1, lastSeq] and runs EV analysis.
   *
   * Best-effort like `publishTick` — durable record is in Neon, so the
   * coach can be replayed off a cron if Redis pub/sub drops a message.
   *
   * @param {object} ev { handId, tableId, lastSeq, gameNo, players? }
   */
  async publishHandCompleted(ev) {
    const msg = {
      handId: ev.handId,
      tableId: String(ev.tableId),
      gameNo: ev.gameNo,
      lastSeq: ev.lastSeq,
      // Range is [fromSeq, toSeq) — coach reads HandEventStore.range().
      // gateway/coach can reconstruct the hand from any subset.
      fromSeq: 1,
      toSeq: ev.lastSeq + 1,
      completedAt: new Date().toISOString(),
      // seat→playerId snapshot, consumed by apps/streaks-bridge to update
      // each human player's streak. Bots (`bot-*`) are filtered downstream.
      players: Array.isArray(ev.players) ? ev.players : [],
    };
    injectTraceContext(msg);
    try {
      await this.redis.publish(HAND_COMPLETED_CHANNEL, JSON.stringify(msg));
    } catch (err) {
      this.log('publish_hand_completed_failed', { handId: ev.handId, err: err.message });
    }
  }
}

/** No-op publisher used when no Redis is wired (unit tests). */
class NullPublisher {
  async publishTick() {}
  async publishHandCompleted() {}
}

module.exports = { Publisher, NullPublisher, channelFor, HAND_COMPLETED_CHANNEL };
