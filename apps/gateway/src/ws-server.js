'use strict';

/**
 * ws-server.js — the WebSocket gateway.
 *
 *   GET ws://gateway/table/:id?token=<jwt>
 *
 * Upgrade flow:
 *   1. Pull `:id` and `?token` from the URL.
 *   2. Verify JWT (HS256, GATEWAY_JWT_SECRET) and check that the token's
 *      `tableId` matches the URL `:id`. Reject with HTTP 401 otherwise.
 *   3. Accept the upgrade. The first c2s frame must be `c2s.join` with
 *      optional `lastSeq` — we resume or snapshot from there.
 *
 * Per-socket lifecycle:
 *   - Subscribe to RedisBus for this tableId; every published delta is
 *     written to the socket.
 *   - Heartbeat: 30 s interval, ping; close if no pong by next interval.
 *   - Backpressure: if `bufferedAmount`/queue depth grows past a
 *     threshold we drop and force a snapshot resync next reconnect.
 *
 * Sticky-by-tableId is just an in-memory Map. Cross-process sharding is
 * a load-balancer concern (Phase later). One process owns its sockets.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const {
  AuthError,
  verifyToken,
  extractToken,
  extractTableId,
} = require('./auth');
const { RedisBus } = require('./redis-bus');
const { planResume } = require('./resume');
const { LobbyManager } = require('./lobby');
const { SeatClaimer } = require('./seat-claim');
const { listStakes, getStake } = require('@hijack/protocol/stakes');
const {
  C2S,
  S2C,
  isClientMessage,
  snapshot: mkSnapshot,
  error: mkError,
  kicked: mkKicked,
} = require('@hijack/protocol/messages');
const { extractTraceContext, withSpan } = require('@hijack/observability/tracing');
const {
  isShardSaturated,
  DEFAULT_SATURATION_PCT,
} = require('@hijack/observability/shard-metrics');

const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKPRESSURE_LIMIT = 100; // messages queued
const MAX_INBOUND_BYTES = 64 * 1024;
const SHARD_SATURATION_THRESHOLD = DEFAULT_SATURATION_PCT; // 80%

/**
 * @typedef {object} GatewayOpts
 * @property {import('ioredis').Redis} redis            command client
 * @property {() => import('ioredis').Redis} subscriberFactory  pub/sub client factory
 * @property {object} stateStore                        from @hijack/worker (or compatible)
 * @property {object} eventStore                        HandEventStore-compatible
 * @property {string} [secret]                          override JWT secret (tests)
 * @property {(...args: any[]) => void} [log]
 * @property {number} [heartbeatMs]
 * @property {number} [backpressureLimit]
 * @property {(action: object, ctx: object) => Promise<void>} [onAction]
 *           Hook to forward `c2s.action` to the worker. Phase 2 doesn't
 *           wire a real RPC — for tests/integration we inject one.
 */

class Gateway {
  /**
   * @param {GatewayOpts} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.log = opts.log || (() => {});
    this.heartbeatMs = opts.heartbeatMs || HEARTBEAT_INTERVAL_MS;
    this.backpressureLimit = opts.backpressureLimit || BACKPRESSURE_LIMIT;
    // Map tableId → shardId for load-shed lookup. In production this is
    // a cluster-wide ring/hash; in dev/test we accept either an explicit
    // resolver or default to a single shard.
    this.resolveShardId = opts.resolveShardId || (() => process.env.SHARD_ID || 'shard-0');
    this.shardSaturationThreshold = opts.shardSaturationThreshold ?? SHARD_SATURATION_THRESHOLD;
    this.bus = new RedisBus({ subscriberFactory: opts.subscriberFactory });
    /** @type {Map<string, Set<object>>} sockets by tableId */
    this.byTable = new Map();
    /** @type {Map<string, number>} highest seq we've forwarded per table */
    this.tableSeq = new Map();
    this.httpServer = null;
    this.wss = null;
    this.heartbeatTimer = null;
    // Phase 3 — lobby + seat-claim. Both are optional in tests that don't
    // need them (existing fan-out tests inject `redis` only).
    this.lobby = new LobbyManager({
      redis: opts.redis,
      subscriberFactory: opts.subscriberFactory,
      log: this.log,
    });
    this.seatClaimer = opts.secret || process.env.GATEWAY_JWT_SECRET
      ? new SeatClaimer({
          redis: opts.redis,
          secret: opts.secret || process.env.GATEWAY_JWT_SECRET,
        })
      : null;
  }

  async start({ port = 0 } = {}) {
    await this.bus.start();
    await this.lobby.start();
    if (this.seatClaimer) {
      try { await this.seatClaimer.load(); }
      catch (err) { this.log('seat_claim_lua_load_failed', { err: err.message }); }
    }
    this.httpServer = http.createServer((req, res) => this._handleHttp(req, res));

    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INBOUND_BYTES });

    this.httpServer.on('upgrade', (req, socket, head) => this._handleUpgrade(req, socket, head));

    this.heartbeatTimer = setInterval(() => this._heartbeat(), this.heartbeatMs);
    this.heartbeatTimer.unref?.();

    await new Promise((resolve) => this.httpServer.listen(port, resolve));
    return { port: this.httpServer.address().port };
  }

  async stop() {
    clearInterval(this.heartbeatTimer);
    if (this.wss) {
      for (const ws of this.wss.clients) {
        try { ws.terminate(); } catch (_e) {}
      }
      this.wss.close();
    }
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
    }
    await this.bus.stop();
    await this.lobby.stop();
  }

  /**
   * HTTP request router — `/health`, `/lobby/:stake` list, `/seat-claim`
   * POST (REST shim that wraps the same Lua call the WS handler uses).
   * All non-WS routes pass through here; WS upgrades are intercepted in
   * the `upgrade` event before this fires.
   */
  async _handleHttp(req, res) {
    try {
      const urlPath = (req.url || '/').split('?')[0];
      if (req.method === 'GET' && urlPath === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ service: 'hijack-gateway', status: 'ok' }));
      }
      if (req.method === 'GET' && urlPath === '/lobby') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ stakes: listStakes() }));
      }
      const lobbyMatch = urlPath.match(/^\/lobby\/([^/]+)$/);
      if (req.method === 'GET' && lobbyMatch) {
        return this.lobby.handleRestList(lobbyMatch[1], res);
      }
      if (req.method === 'POST' && urlPath === '/seat-claim') {
        return this._handleSeatClaim(req, res);
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async _handleSeatClaim(req, res) {
    if (!this.seatClaimer) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'seat_claim_unavailable' }));
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = body ? JSON.parse(body) : {}; }
    catch (_e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'bad_json' }));
    }
    const { stake, tableId, seat, userId, reservationToken } = parsed;
    if (!stake || !tableId || seat == null || !userId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'missing_field' }));
    }
    const result = await this.seatClaimer.claim({
      stake,
      tableId,
      seat: Number(seat),
      userId: String(userId),
      reservationToken,
    });
    if (!result.ok) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: result.reason }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  // ─── upgrade ─────────────────────────────────────────────────────────

  _handleUpgrade(req, socket, head) {
    const path = (req.url || '').split('?')[0];

    // Lobby upgrade — no table binding. Token is optional; if supplied
    // we record the userId but the lobby is browseable anonymously.
    if (path === '/lobby') {
      let claims = null;
      const token = extractToken(req.url);
      if (token) {
        try { claims = verifyToken(token, { secret: this.opts.secret }); }
        catch (_err) { /* anonymous browse */ }
      }
      return this.wss.handleUpgrade(req, socket, head, (ws) => {
        this._attachLobby(ws, { claims });
      });
    }

    const tableId = extractTableId(req.url);
    if (!tableId) return rejectHttp(socket, 404, 'not_found');

    const token = extractToken(req.url);
    let claims;
    try {
      claims = verifyToken(token, { secret: this.opts.secret });
    } catch (err) {
      const code = err instanceof AuthError ? 401 : 500;
      return rejectHttp(socket, code, err.message);
    }
    if (claims.tableId !== tableId) {
      return rejectHttp(socket, 401, 'token_table_mismatch');
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this._attach(ws, { tableId, claims });
    });
  }

  /**
   * Attach a lobby-only socket — receives `s2c.lobby_state` /
   * `s2c.lobby_delta` frames, accepts `c2s.lobby_subscribe`/`unsubscribe`.
   * Cannot send `c2s.action` / `c2s.join`.
   */
  _attachLobby(ws, ctx) {
    ws._hijack = {
      lobby: true,
      userId: ctx.claims ? ctx.claims.userId : null,
      isAlive: true,
      pending: 0,
      stakeUnsubs: new Map(),
    };
    ws.on('pong', () => { ws._hijack.isAlive = true; });
    ws.on('message', (raw) => this._onLobbyMessage(ws, raw));
    ws.on('close', () => this._detachLobby(ws));
    ws.on('error', () => this._detachLobby(ws));
  }

  _detachLobby(ws) {
    const meta = ws._hijack;
    if (!meta || !meta.stakeUnsubs) return;
    for (const off of meta.stakeUnsubs.values()) {
      try { off(); } catch (_e) {}
    }
    meta.stakeUnsubs.clear();
  }

  async _onLobbyMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (_e) { return this._send(ws, mkError('bad_json', 'invalid JSON')); }
    if (!msg || typeof msg !== 'object') {
      return this._send(ws, mkError('bad_type', 'not an object'));
    }
    if (msg.t === C2S.LOBBY_SUBSCRIBE) return this._onLobbySubscribe(ws, msg);
    if (msg.t === C2S.LOBBY_UNSUBSCRIBE) return this._onLobbyUnsubscribe(ws, msg);
    return this._send(ws, mkError('bad_type', `unknown lobby t=${msg.t}`));
  }

  async _onLobbySubscribe(ws, msg) {
    const stake = msg.stake;
    if (!stake || !getStake(stake)) {
      return this._send(ws, mkError('unknown_stake', `no stake ${stake}`));
    }
    const meta = ws._hijack;
    if (meta.stakeUnsubs.has(stake)) return; // idempotent

    const off = this.lobby.subscribe(stake, (frame) => this._send(ws, frame));
    meta.stakeUnsubs.set(stake, off);

    const stateFrame = await this.lobby.makeStateFrame(stake);
    if (stateFrame) this._send(ws, stateFrame);
  }

  _onLobbyUnsubscribe(ws, msg) {
    const stake = msg.stake;
    const meta = ws._hijack;
    const off = meta.stakeUnsubs.get(stake);
    if (off) {
      off();
      meta.stakeUnsubs.delete(stake);
    }
  }

  // ─── per-socket lifecycle ────────────────────────────────────────────

  _attach(ws, ctx) {
    ws._hijack = {
      tableId: ctx.tableId,
      userId: ctx.claims.userId,
      seat: ctx.claims.seat,
      sessionId: ctx.claims.sessionId,
      isAlive: true,
      // outbound queue depth — proxy for "how far behind is this socket?"
      pending: 0,
      joined: false,
      unsubscribe: null,
    };

    ws.on('pong', () => { ws._hijack.isAlive = true; });
    ws.on('message', (raw) => this._onMessage(ws, raw));
    ws.on('close', () => this._detach(ws));
    ws.on('error', () => this._detach(ws));

    // Register against the table's socket set; subscribe RedisBus the
    // first time a socket joins this table.
    const set = this.byTable.get(ctx.tableId) || new Set();
    if (set.size === 0) {
      const off = this.bus.on(ctx.tableId, (msg) => this._broadcast(ctx.tableId, msg));
      set._unsubscribe = off;
    }
    set.add(ws);
    this.byTable.set(ctx.tableId, set);
  }

  _detach(ws) {
    const tableId = ws._hijack?.tableId;
    if (tableId) {
      const set = this.byTable.get(tableId);
      if (set) {
        set.delete(ws);
        if (set.size === 0 && set._unsubscribe) {
          set._unsubscribe();
          this.byTable.delete(tableId);
        }
      }
    }
    if (ws._hijack?.unsubscribe) {
      try { ws._hijack.unsubscribe(); } catch (_e) {}
      ws._hijack.unsubscribe = null;
    }
    // Drop any lobby subscriptions this socket had piggy-backed on.
    if (ws._hijack?.stakeUnsubs) {
      for (const off of ws._hijack.stakeUnsubs.values()) {
        try { off(); } catch (_e) {}
      }
      ws._hijack.stakeUnsubs.clear();
    }
  }

  async _onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (_e) {
      return this._send(ws, mkError('bad_json', 'invalid JSON'));
    }
    if (!isClientMessage(msg)) {
      return this._send(ws, mkError('bad_type', `unknown t=${msg && msg.t}`));
    }

    if (msg.t === C2S.JOIN) return this._onJoin(ws, msg);
    if (msg.t === C2S.LEAVE) {
      try { ws.close(1000, 'client_leave'); } catch (_e) {}
      return;
    }
    if (msg.t === C2S.ACTION) return this._onAction(ws, msg);
    if (msg.t === C2S.LOBBY_SUBSCRIBE || msg.t === C2S.LOBBY_UNSUBSCRIBE) {
      // Allow table-bound sockets to also subscribe to lobby deltas — same
      // handler set as the lobby-only path.
      if (!ws._hijack.stakeUnsubs) ws._hijack.stakeUnsubs = new Map();
      if (msg.t === C2S.LOBBY_SUBSCRIBE) return this._onLobbySubscribe(ws, msg);
      return this._onLobbyUnsubscribe(ws, msg);
    }
  }

  async _onJoin(ws, msg) {
    const { tableId } = ws._hijack;
    if (msg.tableId !== tableId) {
      return this._send(ws, mkError('table_mismatch', 'join tableId differs from URL'));
    }
    // Load-shed: refuse joins when the target shard's mem_pct exceeds
    // the saturation threshold (default 80%). Equivalent of an HTTP 503
    // for WebSockets — we send `s2c.error { code: 'shard_saturated' }`
    // and close the socket so the client can back off and retry.
    try {
      const shardId = this.resolveShardId(tableId);
      const saturated = await isShardSaturated(
        this.opts.redis,
        shardId,
        this.shardSaturationThreshold
      );
      if (saturated) {
        this.log('shard_saturated_reject', {
          tableId,
          shardId,
          userId: ws._hijack.userId,
        });
        this._send(ws, mkError('shard_saturated', 'shard at capacity, retry later', tableId));
        try { ws.close(1013, 'shard_saturated'); } catch (_e) {}
        return;
      }
    } catch (err) {
      // Metrics lookup failure shouldn't take the gateway down — log and
      // fall through to the resume path. The shard is presumed healthy.
      this.log('shard_metrics_lookup_failed', { tableId, err: err.message });
    }
    // Phase 3 — optional join-token confirm flow. Spectators may join
    // without a token (no seat binding); seated players MUST present
    // a token whose tableId/seat match the seat reservation in Redis.
    if (msg.joinToken && this.seatClaimer) {
      try {
        const claims = this.seatClaimer.verifyJoinToken(msg.joinToken);
        if (claims.tableId !== tableId) {
          return this._send(ws, mkError('join_token_table_mismatch', 'token tableId mismatch'));
        }
        // Cross-check the live seat reservation hash to defend against a
        // stale token after an admin-forced clear.
        const seatsRaw = await this.opts.redis.hget(`table:${tableId}:seats`, String(claims.seat));
        if (!seatsRaw) {
          return this._send(ws, mkError('seat_not_reserved', 'no live reservation'));
        }
        const parts = String(seatsRaw).split('|');
        if (parts[1] !== claims.reservationToken) {
          return this._send(ws, mkError('seat_token_mismatch', 'token superseded'));
        }
        ws._hijack.seat = claims.seat;
        ws._hijack.boundUserId = String(claims.sub);
        ws._hijack.bound = true;
      } catch (err) {
        return this._send(ws, mkError('bad_join_token', err.message));
      }
    }
    try {
      const plan = await planResume({
        redis: this.opts.redis,
        stateStore: this.opts.stateStore,
        eventStore: this.opts.eventStore,
        tableId,
        lastSeq: msg.lastSeq,
      });
      if (plan.mode === 'snapshot') {
        this._send(ws, plan.frame);
        // Track outbound seq baseline so subsequent deltas are monotonic
        // against this client.
        ws._hijack.lastSent = plan.frame.seq;
      } else {
        for (const f of plan.frames) {
          this._send(ws, f);
          ws._hijack.lastSent = f.seq;
        }
      }
      ws._hijack.joined = true;
    } catch (err) {
      this.log('join_failed', { tableId, err: err.message });
      this._send(ws, mkError('resume_failed', err.message, tableId));
      try { ws.close(1011, 'resume_failed'); } catch (_e) {}
    }
  }

  async _onAction(ws, msg) {
    if (!ws._hijack.joined) {
      return this._send(ws, mkError('not_joined', 'send c2s.join first'));
    }
    if (!this.opts.onAction) {
      // Phase 2 doesn't define gateway → worker RPC. For now, simply
      // ack — the worker test harness drives ticks directly. The hook
      // exists so integration tests can plumb actions through.
      return;
    }
    try {
      await this.opts.onAction(msg, {
        userId: ws._hijack.userId,
        sessionId: ws._hijack.sessionId,
      });
    } catch (err) {
      this._send(ws, mkError('action_failed', err.message, msg.tableId));
    }
  }

  // ─── fan-out & backpressure ─────────────────────────────────────────

  _broadcast(tableId, msg) {
    // Enforce monotonic per-table seq on outbound. The worker's INCR
    // already guarantees this server-side; we additionally guard against
    // duplicates from pub/sub redelivery.
    const lastForTable = this.tableSeq.get(tableId) || 0;
    if (typeof msg.seq === 'number' && msg.seq <= lastForTable) {
      return; // dropped duplicate / out-of-order republish
    }
    if (typeof msg.seq === 'number') this.tableSeq.set(tableId, msg.seq);

    // Extract worker-side trace context from the published payload so we
    // continue the same trace through the gateway → client fan-out. We
    // expose it on the message for tests/instrumentation; the wire shape
    // already includes `traceparent`.
    const tc = extractTraceContext(msg);
    if (tc) {
      this.lastTraceId = tc.traceId;
      this.log('broadcast_trace', { tableId, seq: msg.seq, traceId: tc.traceId });
    }

    const set = this.byTable.get(tableId);
    if (!set) return;
    for (const ws of set) {
      this._send(ws, msg);
    }
  }

  /**
   * Send with backpressure handling. If the socket has too many queued
   * messages we drop it and let it resync via reconnect — the durable
   * record is in the event store so this is safe.
   */
  _send(ws, frame) {
    if (ws.readyState !== ws.OPEN) return;
    const meta = ws._hijack;
    if (!meta) return;
    if (meta.pending >= this.backpressureLimit) {
      this.log('backpressure_drop', { tableId: meta.tableId, pending: meta.pending });
      try {
        ws.send(JSON.stringify(mkKicked('backpressure_resync')));
      } catch (_e) {}
      try { ws.close(1013, 'backpressure'); } catch (_e) {}
      return;
    }
    meta.pending += 1;
    ws.send(JSON.stringify(frame), (err) => {
      meta.pending = Math.max(0, meta.pending - 1);
      if (err) {
        try { ws.terminate(); } catch (_e) {}
      }
    });
  }

  // ─── heartbeat ──────────────────────────────────────────────────────

  _heartbeat() {
    if (!this.wss) return;
    for (const ws of this.wss.clients) {
      const meta = ws._hijack;
      if (!meta) continue;
      if (!meta.isAlive) {
        try { ws.terminate(); } catch (_e) {}
        continue;
      }
      meta.isAlive = false;
      try { ws.ping(); } catch (_e) {}
    }
  }
}

function rejectHttp(socket, code, msg) {
  const lines = [
    `HTTP/1.1 ${code} ${msg || ''}`,
    'Connection: close',
    'Content-Length: 0',
    '',
    '',
  ];
  try {
    socket.write(lines.join('\r\n'));
  } finally {
    socket.destroy();
  }
}

module.exports = {
  Gateway,
  HEARTBEAT_INTERVAL_MS,
  BACKPRESSURE_LIMIT,
};
