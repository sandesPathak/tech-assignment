'use strict';

/**
 * profile-bus.js — Phase 5.
 *
 * Listens on the `profile:updated` Redis pub/sub channel (the Next.js
 * `/api/profile` PATCH route publishes there after a successful write)
 * and re-broadcasts the change to every WS bound to a table where that
 * user is seated. The frame is a synthetic `s2c.delta` with
 * `payload.kind = 'player_updated'` — same wire shape we used for
 * `hand_completed` in Phase 4 (see `coach-api.js`), so the existing
 * `_broadcast` / spectator filter / seq logic works unchanged.
 *
 * The payload carries `userId`, `displayName`, `avatarId`. The frontend
 * store reads these and mutates any seat with a matching `userId` in the
 * current snapshot.
 *
 * Wire-up: opt-in by calling `attachProfileBus(gateway)` once at boot.
 */

const { delta: mkDelta } = require('@hijack/protocol/messages');

const PROFILE_UPDATED_CHANNEL = 'profile:updated';

/**
 * Find every tableId currently fanning out to at least one socket whose
 * `_hijack.userId === userId`. We walk the gateway's per-table socket
 * sets — small + fast for the connection counts we care about.
 */
function tablesForUser(gateway, userId) {
  const out = new Set();
  if (!gateway || !gateway.byTable) return out;
  const target = String(userId);
  for (const [tableId, set] of gateway.byTable.entries()) {
    for (const ws of set) {
      const meta = ws && ws._hijack;
      if (!meta) continue;
      if (String(meta.userId) === target) {
        out.add(tableId);
        break;
      }
    }
  }
  return out;
}

async function subscribeProfileUpdated({ redis, subscriberFactory, gateway, log = () => {} }) {
  const sub = subscriberFactory ? subscriberFactory() : redis.duplicate();
  await sub.subscribe(PROFILE_UPDATED_CHANNEL);
  sub.on('message', (channel, raw) => {
    if (channel !== PROFILE_UPDATED_CHANNEL) return;
    let ev;
    try { ev = JSON.parse(raw); }
    catch (err) { log('profile_updated_bad_json', { err: err.message }); return; }
    if (!ev || !ev.userId) return;
    const userId = String(ev.userId);
    const tables = tablesForUser(gateway, userId);
    for (const tableId of tables) {
      // Bump per-table seq so the frame is monotonic with the rest of
      // the stream. We use the gateway's own outbound counter rather
      // than the worker's INCR — `player_updated` is a meta-frame, not
      // a hand-engine event.
      const lastSeq = gateway.tableSeq.get(tableId) || 0;
      const seq = lastSeq + 1;
      const frame = mkDelta(String(tableId), seq, -1, {
        kind: 'player_updated',
        userId,
        displayName: ev.displayName || null,
        avatarId: ev.avatarId || null,
      });
      try { gateway._broadcast(String(tableId), frame); }
      catch (err) { log('profile_updated_broadcast_failed', { err: err.message }); }
    }
  });
  return async () => {
    try { await sub.unsubscribe(PROFILE_UPDATED_CHANNEL); } catch (_e) {}
    try { await sub.quit(); } catch (_e) {}
  };
}

async function attachProfileBus(gateway, opts = {}) {
  if (gateway._profileBusAttached) return;
  gateway._profileBusAttached = true;
  if (opts.subscribe === false) return;
  if (!gateway.opts || !gateway.opts.redis) return;
  await subscribeProfileUpdated({
    redis: gateway.opts.redis,
    subscriberFactory: gateway.opts.subscriberFactory,
    gateway,
    log: gateway.log,
  });
}

module.exports = {
  attachProfileBus,
  subscribeProfileUpdated,
  tablesForUser,
  PROFILE_UPDATED_CHANNEL,
};
