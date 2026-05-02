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
const {
  createHandoffHandlers,
  shouldDeliverToSpectator,
} = require('./handoff');
const {
  C2S,
  S2C,
  isClientMessage,
  snapshot: mkSnapshot,
  error: mkError,
  kicked: mkKicked,
} = require('@hijack/protocol/messages');

const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKPRESSURE_LIMIT = 100; // messages queued
const MAX_INBOUND_BYTES = 64 * 1024;

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
    this.bus = new RedisBus({ subscriberFactory: opts.subscriberFactory });
    /** @type {Map<string, Set<object>>} sockets by tableId */
    this.byTable = new Map();
    /** @type {Map<string, number>} highest seq we've forwarded per table */
    this.tableSeq = new Map();
    this.httpServer = null;
    this.wss = null;
    this.heartbeatTimer = null;
  }

  async start({ port = 0 } = {}) {
    await this.bus.start();
    // Build the handoff HTTP handlers. They close over `this` so /redeem
    // can find and downgrade the prior socket bound to (userId, tableId,
    // seat). See `apps/gateway/src/handoff.js`.
    this.handoff = createHandoffHandlers({
      redis: this.opts.redis,
      gateway: this,
      secret: this.opts.secret,
      log: this.log,
    });
    // Bus → per-table fan-out. We register a single subscriber per table
    // when its first socket connects.
    this.httpServer = http.createServer(async (req, res) => {
      // Health endpoint — useful for Fly.io and the integration test.
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ service: 'hijack-gateway', status: 'ok' }));
        return;
      }
      // Handoff REST endpoints.
      try {
        if (await this.handoff.dispatch(req, res)) return;
      } catch (err) {
        this.log('handoff_handler_error', { err: err.message });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });

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
  }

  // ─── upgrade ─────────────────────────────────────────────────────────

  _handleUpgrade(req, socket, head) {
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
  }

  async _onJoin(ws, msg) {
    const { tableId } = ws._hijack;
    if (msg.tableId !== tableId) {
      return this._send(ws, mkError('table_mismatch', 'join tableId differs from URL'));
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
    if (ws._hijack.spectator) {
      return this._send(ws, mkError('spectator', 'socket downgraded after handoff'));
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

    const set = this.byTable.get(tableId);
    if (!set) return;
    for (const ws of set) {
      // Spectator-mode sockets (post-handoff) get a filtered stream.
      // shouldDeliverToSpectator returns true for public events; we drop
      // any frame that may reveal hole cards for the seat the spectator
      // used to occupy.
      if (ws._hijack && ws._hijack.spectator) {
        if (!shouldDeliverToSpectator(msg, { seat: ws._hijack.seat })) continue;
      }
      this._send(ws, msg);
    }
  }

  /**
   * Mark every socket bound to (userId, tableId, seat) on this gateway as
   * a spectator and notify them with `s2c.kicked` / reason `handoff`.
   * Called by the handoff `redeem` handler. Returns the number of sockets
   * downgraded (0 if the user wasn't connected here).
   */
  kickForHandoff({ userId, tableId, seat, newSessionId }) {
    const set = this.byTable.get(String(tableId));
    if (!set) return 0;
    let count = 0;
    for (const ws of set) {
      const meta = ws._hijack;
      if (!meta) continue;
      if (meta.spectator) continue;
      if (String(meta.userId) !== String(userId)) continue;
      if (seat != null && meta.seat != null && Number(meta.seat) !== Number(seat)) continue;
      meta.spectator = true;
      meta.replacedBy = newSessionId;
      // Notify the client so it can render the "moved to phone" screen.
      try {
        this._send(ws, mkKicked('handoff'));
      } catch (_e) { /* best effort */ }
      count += 1;
    }
    return count;
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
