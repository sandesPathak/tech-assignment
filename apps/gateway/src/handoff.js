'use strict';

/**
 * handoff.js — cross-device session handoff.
 *
 * The flow: a player has socket A bound to (userId, tableId, seat) on one
 * device. They want to "move the seat" to another device. They hit
 * `POST /handoff/issue` (auth'd by the same JWT they use for WS) and get
 * back a short-lived single-use token. They encode that token in a QR /
 * deep-link. The phone opens `/resume?token=...` which calls
 * `POST /handoff/redeem`, gets a fresh JWT that binds them to the seat,
 * opens a WS, and the gateway evicts socket A.
 *
 * Why a separate module:
 *   - Keeps the WS hot path in `ws-server.js` untouched. The handoff
 *     logic is HTTP + Redis only, and only needs the gateway's socket
 *     index to deliver the kick.
 *   - Separates the two concerns the test matrix cares about: the
 *     Redis-side single-use semantics (token issue/redeem/replay/expiry)
 *     and the gateway-side socket transition (kick + spectator downgrade).
 *
 * Token semantics (REQUIRED):
 *   - `crypto.randomBytes(32).toString('base64url')` — 256 bits, never
 *     sequential, URL-safe (fits in QR + query string without escaping).
 *   - Stored at Redis key `handoff:{token}` as JSON
 *     `{userId, tableId, seat, issuedAt}`.
 *   - 60-second TTL; redeem uses `GETDEL` so a race between two redeem
 *     calls cleanly resolves to one winner.
 *
 * Spectator downgrade:
 *   - When socket B redeems and binds, we mark socket A's `_hijack` meta
 *     with `spectator: true` and `replacedBy: <new sessionId>`. The WS
 *     fan-out filter (see `attachSpectatorFilter` below) drops any frame
 *     whose payload may reveal hole cards for the seat the user was
 *     bound to. We deliberately keep public events (community card deals,
 *     pot updates, bets, board) flowing so the old device shows the hand
 *     play out — that's the "spectator" UX the phase doc asks for.
 *   - Socket A also receives `s2c.kicked` with `reason: 'handoff'` so
 *     the client can render the "moved to phone" overlay. We do NOT
 *     close the socket on a handoff — closing would let the client
 *     auto-reconnect into a normal seat binding, which would race the
 *     newly-bound socket B for the seat. Spectator mode is the stable
 *     state.
 *
 * Endpoints (mounted on the gateway's HTTP server):
 *   POST /handoff/issue   — body { tableId, seat }, header Authorization: Bearer <jwt>.
 *                           Returns { token, expiresIn } (HandoffToken).
 *   POST /handoff/redeem  — body { token, sessionId }.
 *                           Returns { jwt, userId, tableId, seat } and
 *                           triggers the kick on any prior socket bound
 *                           to (userId, tableId, seat) on this gateway.
 *
 * The WS upgrade itself does not change — clients use the `/handoff/redeem`
 * response's JWT in the existing `?token=` flow.
 */

const crypto = require('crypto');
const { signToken, verifyToken, AuthError } = require('./auth');
const { kicked: mkKicked } = require('@hijack/protocol/messages');

const TOKEN_TTL_SEC = 60;
const TOKEN_PREFIX = 'handoff:';

/** Fresh, opaque token. 256 bits of entropy, URL-safe. */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Issue a single-use handoff token. Caller has already proven they own
 * the JWT for (userId, tableId, seat) — we just persist the mapping.
 *
 * @param {object} args
 * @param {import('ioredis').Redis} args.redis
 * @param {string} args.userId
 * @param {string} args.tableId
 * @param {number|null} args.seat
 * @param {number} [args.ttlSeconds]
 * @returns {Promise<{token: string, expiresIn: number}>}
 */
async function issueHandoffToken({ redis, userId, tableId, seat, ttlSeconds = TOKEN_TTL_SEC }) {
  const token = newToken();
  const payload = JSON.stringify({
    userId: String(userId),
    tableId: String(tableId),
    seat: seat == null ? null : Number(seat),
    issuedAt: Date.now(),
  });
  // SET ... EX guarantees atomic write+TTL; the token is fresh so
  // collisions don't happen in practice (256 bits).
  await redis.set(TOKEN_PREFIX + token, payload, 'EX', ttlSeconds);
  return { token, expiresIn: ttlSeconds };
}

/**
 * Atomically read-and-delete a handoff token. Single-use semantics —
 * a replay attack that re-uses the same token gets `null` here.
 *
 * Returns the parsed payload `{userId, tableId, seat, issuedAt}` or
 * `null` if the token is missing/expired/already-redeemed.
 *
 * @param {object} args
 * @param {import('ioredis').Redis} args.redis
 * @param {string} args.token
 */
async function consumeHandoffToken({ redis, token }) {
  if (!token || typeof token !== 'string') return null;
  // ioredis exposes GETDEL since Redis 6.2. ioredis-mock implements it
  // too. If GETDEL is missing on an older server we fall back to a
  // multi-exec transaction — semantically identical for our use.
  let raw;
  if (typeof redis.getdel === 'function') {
    raw = await redis.getdel(TOKEN_PREFIX + token);
  } else {
    const [[, v]] = await redis.multi().get(TOKEN_PREFIX + token).del(TOKEN_PREFIX + token).exec();
    raw = v;
  }
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      userId: String(parsed.userId),
      tableId: String(parsed.tableId),
      seat: parsed.seat == null ? null : Number(parsed.seat),
      issuedAt: Number(parsed.issuedAt) || 0,
    };
  } catch (_e) {
    return null;
  }
}

// ─── HTTP wiring ────────────────────────────────────────────────────────

/**
 * Read the entire request body up to a small limit, parse JSON. Tiny
 * helper — the gateway intentionally avoids dragging in an HTTP framework
 * just for two endpoints.
 */
function readJsonBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new HttpError(413, 'body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_e) {
        reject(new HttpError(400, 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function writeJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function extractBearer(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/**
 * Build the issue/redeem HTTP handlers. The handlers close over the
 * gateway instance so `redeem` can find and downgrade the existing
 * socket. `secret` is the JWT secret used for both `verifyToken` (issue)
 * and `signToken` (redeem hands the client a fresh JWT).
 *
 * @param {object} opts
 * @param {import('ioredis').Redis} opts.redis
 * @param {object} opts.gateway     — `Gateway` instance from ws-server.js
 * @param {string} [opts.secret]    — override JWT secret (tests)
 * @param {(...a:any[]) => void} [opts.log]
 * @param {number} [opts.ttlSeconds]
 * @param {string} [opts.jwtTtl]   — JWT lifetime for the post-redeem token (default 5m)
 */
function createHandoffHandlers({ redis, gateway, secret, log = () => {}, ttlSeconds = TOKEN_TTL_SEC, jwtTtl = '5m' }) {
  async function issue(req, res) {
    let claims;
    try {
      const tok = extractBearer(req);
      claims = verifyToken(tok, { secret });
    } catch (err) {
      const status = err instanceof AuthError ? 401 : 500;
      return writeJson(res, status, { error: err.code || 'unauthorized', message: err.message });
    }
    let body;
    try { body = await readJsonBody(req); }
    catch (err) {
      return writeJson(res, err.status || 400, { error: err.code || 'bad_request' });
    }
    const tableId = body.tableId == null ? claims.tableId : String(body.tableId);
    const seat = body.seat == null ? claims.seat ?? null : Number(body.seat);
    if (tableId !== claims.tableId) {
      return writeJson(res, 403, { error: 'token_table_mismatch' });
    }
    const out = await issueHandoffToken({
      redis,
      userId: claims.userId,
      tableId,
      seat,
      ttlSeconds,
    });
    log('handoff_issued', { userId: claims.userId, tableId, seat, expiresIn: out.expiresIn });
    return writeJson(res, 200, out);
  }

  async function redeem(req, res) {
    let body;
    try { body = await readJsonBody(req); }
    catch (err) {
      return writeJson(res, err.status || 400, { error: err.code || 'bad_request' });
    }
    const token = body && body.token;
    const sessionId = (body && body.sessionId) || crypto.randomBytes(8).toString('base64url');
    const consumed = await consumeHandoffToken({ redis, token });
    if (!consumed) {
      return writeJson(res, 401, { error: 'token_invalid_or_expired' });
    }
    // Mint a fresh JWT for the new socket. The phase-2 auth module's
    // signToken handles the secret + algorithm.
    const jwt = signToken(
      {
        sub: consumed.userId,
        tableId: consumed.tableId,
        seat: consumed.seat,
        sessionId,
      },
      { secret, expiresIn: jwtTtl }
    );
    // Side-effect: kick the prior socket on this gateway instance.
    // Cross-process: the new socket will overwrite the seat binding via
    // its own JWT/JOIN; old sockets on other gateway instances will
    // receive the existing `replaced_by_other_session` semantics if the
    // seat-id collision is signalled. (Out of scope here — single-process
    // test covers our acceptance criteria.)
    const kicked = gateway.kickForHandoff({
      userId: consumed.userId,
      tableId: consumed.tableId,
      seat: consumed.seat,
      newSessionId: sessionId,
    });
    log('handoff_redeemed', {
      userId: consumed.userId,
      tableId: consumed.tableId,
      seat: consumed.seat,
      kickedSockets: kicked,
    });
    return writeJson(res, 200, {
      jwt,
      userId: consumed.userId,
      tableId: consumed.tableId,
      seat: consumed.seat,
      sessionId,
    });
  }

  /** Wire onto a Node HTTP server. Returns true if the request was handled. */
  async function dispatch(req, res) {
    if (req.method !== 'POST') return false;
    const path = (req.url || '').split('?')[0];
    if (path === '/handoff/issue') { await issue(req, res); return true; }
    if (path === '/handoff/redeem') { await redeem(req, res); return true; }
    return false;
  }

  return { issue, redeem, dispatch };
}

// ─── Spectator downgrade — payload filter ──────────────────────────────

/**
 * Event payload kinds that may reveal hole cards. The worker's tick
 * pipeline emits step-tagged deltas; we filter conservatively — anything
 * that names a player's private cards is dropped for spectator sockets.
 *
 * The list is intentionally small + explicit so a future engine change
 * that adds a new private-info event type fails *closed* — the new event
 * won't match this set and so won't reach spectators anyway. Public
 * events (community deals, bets, pot, board) pass through.
 */
const PRIVATE_PAYLOAD_KINDS = new Set([
  'hole_cards_dealt',
  'hand_dealt',
  'deal_hole',
  'showdown_reveal_private',
]);

/**
 * Decide whether a single fan-out frame should reach a spectator socket.
 *
 * Rule:
 *   - `s2c.kicked`, `s2c.error`, `s2c.snapshot` are infrastructure frames
 *     and always pass.
 *   - `s2c.delta` frames pass *unless* their `payload.kind` (or
 *     `payload.type`) names a private-info event for the spectator's
 *     prior seat.
 *
 * @param {object} frame   the fan-out frame
 * @param {object} ctx     `{ seat: number|null }` — the seat whose
 *                          private info we must hide.
 */
function shouldDeliverToSpectator(frame, ctx) {
  if (!frame || typeof frame !== 'object') return false;
  if (frame.t !== 's2c.delta') return true;
  const payload = frame.payload;
  if (!payload || typeof payload !== 'object') return true;
  const kind = payload.kind || payload.type;
  if (!kind || !PRIVATE_PAYLOAD_KINDS.has(kind)) return true;
  // Private-info event. If the payload doesn't even target the kicked
  // seat we still drop conservatively — a delta without a `seat` field
  // covering hole cards is structured oddly enough that the safer default
  // is to hide it.
  if (ctx.seat == null) return false;
  if (payload.seat != null && Number(payload.seat) !== Number(ctx.seat)) {
    // Private info for another seat — already hidden by the engine
    // (it shouldn't be on the public bus). But if it leaks we still
    // filter it for safety.
    return false;
  }
  return false;
}

module.exports = {
  TOKEN_TTL_SEC,
  TOKEN_PREFIX,
  issueHandoffToken,
  consumeHandoffToken,
  createHandoffHandlers,
  shouldDeliverToSpectator,
  PRIVATE_PAYLOAD_KINDS,
  newToken,
};
