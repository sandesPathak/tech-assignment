'use strict';

/**
 * coach-api.js — Phase 4 follow-up.
 *
 * Two pieces:
 *
 * 1. HTTP `GET /api/coach/:handId/:hero` — proxies to a Neon read of
 *    `hand_analysis` (the table the coach worker writes). When
 *    `DATABASE_URL` is unset (local dev / tests), the handler falls
 *    back to an in-memory map so the frontend `<CoachPanel/>` has
 *    something to render. The gateway intentionally doesn't import
 *    `pg` — we lazy-require it so test suites without `pg` keep
 *    working.
 *
 * 2. `subscribeHandCompleted({redis, gateway})` — listens on the
 *    `hand:completed` Redis channel (worker writes this after step 16,
 *    Phase 7) and re-broadcasts a derived `s2c.delta` with
 *    `payload.kind = 'hand_completed'` to every socket bound to that
 *    table. The frontend `useTableStore` watches for this kind to
 *    open the coach panel — no new wire shape needed, just a
 *    well-defined payload kind.
 *
 * Both pieces are additive: opt in by calling `attachCoachApi(gateway)`
 * at boot. Existing tests don't import this module, so nothing changes
 * for them.
 */

const { delta: mkDelta } = require('@hijack/protocol/messages');

const HAND_COMPLETED_CHANNEL = 'hand:completed';

// ─── Memory fallback for /api/coach/... ─────────────────────────────────
// In production the gateway reads from Neon. For local dev/test, set
// `coachAnalysisStore` to a Map keyed by `${handId}|${hero}`.
const memoryStore = new Map();

function setMemoryAnalysis(handId, hero, row) {
  memoryStore.set(`${handId}|${hero}`, row);
}

function getMemoryAnalysis(handId, hero) {
  return memoryStore.get(`${handId}|${hero}`) || null;
}

async function readAnalysisFromPg(handId, hero) {
  if (!process.env.DATABASE_URL) return null;
  let pgMod;
  try { pgMod = require('pg'); }
  catch { return null; }
  // Reuse a single pool across calls.
  if (!readAnalysisFromPg._pool) {
    readAnalysisFromPg._pool = new pgMod.Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  const pool = readAnalysisFromPg._pool;
  try {
    const { rows } = await pool.query(
      'SELECT hand_id, hero, prose, findings, situation_hash, created_at FROM hand_analysis WHERE hand_id = $1 AND hero = $2 LIMIT 1',
      [handId, hero]
    );
    return rows[0] || null;
  } catch (err) {
    return { _error: err.message };
  }
}

/**
 * HTTP handler for `GET /api/coach/:handId/:hero`. Returns 200 with the
 * row JSON, or 404 if no analysis is available yet (the coach worker
 * may still be running). Errors are logged and return 502.
 */
async function handleCoachLookup(req, res, handId, hero) {
  if (!handId || !hero) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'bad_params' }));
  }
  // Coach analysis can mention the hero's hole cards in prose — require
  // the requester to identify themselves as the hero. The X-Player-Id
  // header is the same convention used by streaks-api auth.
  const claimed = String(req.headers['x-player-id'] || '');
  if (claimed && claimed !== String(hero)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'forbidden', detail: 'analysis is private to the hero' }));
  }
  // Length / charset guard so the param can't be smuggled through to
  // the SQL layer with surprising contents (the query is parameterized,
  // but defense in depth).
  if (String(handId).length > 128 || !/^[A-Za-z0-9_\-:.]+$/.test(String(handId))) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'bad_handId' }));
  }
  if (String(hero).length > 64 || !/^[A-Za-z0-9_\-:.]+$/.test(String(hero))) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'bad_hero' }));
  }
  let row = await readAnalysisFromPg(handId, hero);
  if (row && row._error) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'pg_error', detail: row._error }));
  }
  if (!row) row = getMemoryAnalysis(handId, hero);
  if (!row) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not_found' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(row));
}

/**
 * Subscribe to `hand:completed` and broadcast a derived delta to every
 * socket bound to the relevant table.
 *
 * The frame is a synthetic `s2c.delta` with `seq = lastSeq + 1` and
 * `payload.kind = 'hand_completed'`. The frontend store reads this
 * payload kind and opens the coach panel.
 */
async function subscribeHandCompleted({ redis, subscriberFactory, gateway, log = () => {} }) {
  const sub = subscriberFactory ? subscriberFactory() : redis.duplicate();
  await sub.subscribe(HAND_COMPLETED_CHANNEL);
  sub.on('message', (channel, raw) => {
    if (channel !== HAND_COMPLETED_CHANNEL) return;
    let ev;
    try { ev = JSON.parse(raw); }
    catch (err) { log('hand_completed_bad_json', { err: err.message }); return; }
    if (!ev || !ev.tableId || !ev.handId) return;
    const seq = (ev.lastSeq != null ? Number(ev.lastSeq) : 0) + 1;
    const frame = mkDelta(String(ev.tableId), seq, -1, {
      kind: 'hand_completed',
      handId: String(ev.handId),
      gameNo: ev.gameNo,
    });
    // Stamp traceparent through if the worker sent one.
    if (ev.traceparent) frame.traceparent = ev.traceparent;
    try { gateway._broadcast(String(ev.tableId), frame); }
    catch (err) { log('hand_completed_broadcast_failed', { err: err.message }); }
  });
  return async () => {
    try { await sub.unsubscribe(HAND_COMPLETED_CHANNEL); } catch (_e) {}
    try { await sub.quit(); } catch (_e) {}
  };
}

/**
 * Wire onto an existing Gateway instance. Adds:
 *   - GET /api/coach/:handId/:hero   (extends the HTTP dispatcher)
 *   - hand:completed subscription    (re-broadcast as s2c.delta)
 *
 * Idempotent: calling twice is a no-op the second time.
 */
async function attachCoachApi(gateway, opts = {}) {
  if (gateway._coachApiAttached) return;
  gateway._coachApiAttached = true;

  // HTTP route — wrap the existing _handleHttp so we can intercept
  // before the 404 fallback.
  const origHandleHttp = gateway._handleHttp.bind(gateway);
  gateway._handleHttp = async function (req, res) {
    try {
      const url = (req.url || '/').split('?')[0];
      const m = url.match(/^\/api\/coach\/([^/]+)\/([^/]+)$/);
      if (req.method === 'GET' && m) {
        return handleCoachLookup(req, res, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      }
      return;
    }
    return origHandleHttp(req, res);
  };

  if (opts.subscribe !== false && gateway.opts && gateway.opts.redis) {
    await subscribeHandCompleted({
      redis: gateway.opts.redis,
      subscriberFactory: gateway.opts.subscriberFactory,
      gateway,
      log: gateway.log,
    });
  }
}

module.exports = {
  attachCoachApi,
  subscribeHandCompleted,
  handleCoachLookup,
  setMemoryAnalysis,
  getMemoryAnalysis,
  HAND_COMPLETED_CHANNEL,
};
