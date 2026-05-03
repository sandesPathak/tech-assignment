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
    // Build the handoff HTTP handlers. They close over `this` so /redeem
    // can find and downgrade the prior socket bound to (userId, tableId,
    // seat). See `apps/gateway/src/handoff.js`.
    this.handoff = createHandoffHandlers({
      redis: this.opts.redis,
      gateway: this,
      secret: this.opts.secret,
      log: this.log,
    });
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
      // ── CORS — allowlist, not reflection ──────────────────────────
      // Reflecting any origin with `Allow-Credentials: true` lets any
      // page on the internet call the gateway with the user's cookies.
      // Configure ALLOWED_ORIGINS as a comma-separated list. Default
      // to localhost dev ports.
      const origin = req.headers.origin;
      const allowed = (process.env.ALLOWED_ORIGINS
        || 'http://localhost:4001,http://localhost:3000,http://localhost:5173,http://127.0.0.1:4001,http://127.0.0.1:3000'
      ).split(',').map((s) => s.trim()).filter(Boolean);
      if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, traceparent, X-Player-Id, X-Admin-Token',
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      // ── /admin/* gate ─────────────────────────────────────────────
      // If ADMIN_TOKEN is set, require an exact match in the
      // X-Admin-Token header before letting the request reach a
      // destructive handler. /admin/stats is read-only and stays open
      // (the lobby polls it every 2s for the live-cluster card).
      const adminPath = (req.url || '').split('?')[0];
      const isAdminRoute = adminPath.startsWith('/admin/');
      const isReadOnlyAdmin = adminPath === '/admin/stats';
      if (isAdminRoute && !isReadOnlyAdmin) {
        const expected = process.env.ADMIN_TOKEN;
        if (expected) {
          const supplied = req.headers['x-admin-token'];
          if (supplied !== expected) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'unauthorized' }));
          }
        }
      }
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
        const playerId = req.headers['x-player-id'];
        return this.lobby.handleRestList(lobbyMatch[1], res, { playerId });
      }
      if (req.method === 'POST' && urlPath === '/seat-claim') {
        return this._handleSeatClaim(req, res);
      }
      if (req.method === 'POST' && urlPath === '/spectator-token') {
        return this._handleSpectatorToken(req, res);
      }
      if (req.method === 'POST' && urlPath === '/admin/swarm') {
        return this._handleSwarmSpawn(req, res);
      }
      if (req.method === 'POST' && urlPath === '/admin/swarm/stop') {
        return this._handleSwarmStop(req, res);
      }
      if (req.method === 'POST' && urlPath === '/admin/fill-table') {
        return this._handleFillTable(req, res);
      }
      if (req.method === 'GET' && urlPath === '/admin/stats') {
        return this._handleAdminStats(req, res);
      }
      // Handoff REST endpoints — /handoff/issue, /handoff/redeem, etc.
      if (this.handoff) {
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
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async _handleSwarmSpawn(req, res) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = body ? JSON.parse(body) : {}; }
    catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'bad_json' })); }
    const total = Math.max(1, Math.min(10000, Number(parsed.total) || 100));
    const ramp = Math.max(5, Math.min(200, Number(parsed.ramp) || 50));
    // Pre-spawn enough tables for the swarm so bots don't fail
    // their seat-claim while waiting for the matchmaker (5s tick,
    // threshold-of-3 — way too slow for a 10k ramp).
    const preSpawned = await this._preSpawnTablesForSwarm(total).catch((err) => {
      this.log('preflight_table_spawn_failed', { err: err.message });
      return 0;
    });
    // eslint-disable-next-line global-require
    const path = require('path');
    // eslint-disable-next-line global-require
    const { spawn } = require('child_process');
    if (this._swarmProc) {
      try { this._swarmProc.kill('SIGTERM'); } catch (_e) {}
    }
    const swarmJs = path.resolve(__dirname, '../../botswarm/src/swarm.js');
    const child = spawn(process.execPath, [swarmJs, `--total=${total}`, `--ramp=${ramp}`], {
      env: { ...process.env, GATEWAY_HTTP_URL: 'http://127.0.0.1:3002', HIJACK_GATEWAY_URL: 'ws://127.0.0.1:3002' },
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    this._swarmProc = child;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: child.pid, total, ramp, preSpawned }));
  }

  /**
   * Synchronously provision enough tables to seat `total` bots split
   * roughly evenly across stakes. Mirrors the matchmaker's spawn
   * primitive (zadd lobby, hset meta, initTable, publish table_added)
   * so the bot swarm has somewhere to land the moment it starts.
   */
  async _preSpawnTablesForSwarm(total) {
    if (!this.opts.redis || !this.opts.stateStore) return 0;
    const redis = this.opts.redis;
    const stateStore = this.opts.stateStore;
    const stakes = listStakes();
    if (!stakes.length) return 0;
    let spawned = 0;
    const perStake = Math.ceil(total / stakes.length);
    // eslint-disable-next-line global-require
    const crypto = require('crypto');
    // eslint-disable-next-line global-require
    const { GAME_HAND } = require('@hijack/engine');
    for (const stake of stakes) {
      // How many tables we need at this stake to seat `perStake` bots.
      const tablesNeeded = Math.ceil(perStake / Math.max(1, stake.maxSeats));
      // How many we've already got — sum of openSeats / maxSeats is a
      // rough proxy. Always spawn at least `tablesNeeded - existing`.
      const existing = await redis.zcard(`lobby:${stake.id}:tables`);
      const toSpawn = Math.max(0, tablesNeeded - Number(existing));
      for (let i = 0; i < toSpawn; i += 1) {
        const n = await redis.incr('lobby:next-table-id');
        const tableId = `${stake.id}-${n}`;
        const now = Date.now();
        const meta = {
          stake: stake.id,
          name: `${stake.name} #${tableId}`,
          maxSeats: String(stake.maxSeats),
          smallBlind: String(stake.smallBlind),
          bigBlind: String(stake.bigBlind),
          minBuyIn: String(stake.minBuyIn),
          maxBuyIn: String(stake.maxBuyIn),
          lastActivityMs: String(now),
          createdAtMs: String(now),
        };
        const pipe = redis.pipeline();
        pipe.hset(`table:${tableId}:meta`, meta);
        pipe.zadd(`lobby:${stake.id}:tables`, stake.maxSeats, tableId);
        pipe.publish(
          `lobby:${stake.id}:events`,
          JSON.stringify({
            t: 'table_added',
            tableId,
            name: meta.name,
            openSeats: stake.maxSeats,
            maxSeats: stake.maxSeats,
            smallBlind: stake.smallBlind,
            bigBlind: stake.bigBlind,
          }),
        );
        await pipe.exec();
        await stateStore.initTable(tableId, {
          game: {
            id: crypto.randomBytes(6).toString('hex'),
            tableId,
            gameNo: 1,
            handStep: GAME_HAND.GAME_PREP,
            dealerSeat: 0,
            smallBlindSeat: 0,
            bigBlindSeat: 0,
            communityCards: [],
            pot: 0,
            currentBet: 0,
            sidePots: [],
            move: 0,
            status: 'pending',
            smallBlind: stake.smallBlind,
            bigBlind: stake.bigBlind,
            maxSeats: stake.maxSeats,
            deck: [],
            winners: [],
          },
          players: [],
        });
        spawned += 1;
      }
    }
    return spawned;
  }

  async _handleFillTable(req, res) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = body ? JSON.parse(body) : {}; }
    catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'bad_json' })); }
    const tableId = String(parsed.tableId || '');
    const stake = String(parsed.stake || '');
    const count = Math.max(1, Math.min(8, Number(parsed.count) || 4));
    if (!tableId || !stake) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'missing_table_or_stake' }));
    }
    // de-dupe: don't relaunch a fill for the same table within 30s
    this._fillCache = this._fillCache || new Map();
    const last = this._fillCache.get(tableId) || 0;
    if (Date.now() - last < 30_000) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, deduped: true }));
    }
    this._fillCache.set(tableId, Date.now());
    // eslint-disable-next-line global-require
    const path = require('path');
    // eslint-disable-next-line global-require
    const { spawn } = require('child_process');
    const swarmJs = path.resolve(__dirname, '../../botswarm/src/swarm.js');
    const idPrefix = `bot-fill-${tableId.slice(0, 8)}`;
    const child = spawn(
      process.execPath,
      [swarmJs, `--total=${count}`, `--ramp=${count}`, `--tableId=${tableId}`, `--stake=${stake}`, `--idPrefix=${idPrefix}`],
      {
        env: { ...process.env, GATEWAY_HTTP_URL: 'http://127.0.0.1:3002', HIJACK_GATEWAY_URL: 'ws://127.0.0.1:3002' },
        stdio: 'ignore',
        detached: true,
      }
    );
    child.unref();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: child.pid, count, tableId, stake }));
  }

  async _handleSwarmStop(req, res) {
    if (this._swarmProc) {
      const proc = this._swarmProc;
      this._swarmProc = null;
      // Only signal if the child is still alive — `proc.exitCode === null`
      // means it hasn't exited yet. Avoids `kill(-pid)` racing with PID
      // reuse and accidentally targeting an unrelated process group.
      if (proc.exitCode === null && proc.signalCode === null && proc.pid) {
        try {
          // Prefer the ChildProcess.kill API which validates the pid
          // hasn't already been reaped.
          proc.kill('SIGTERM');
        } catch (_e) { /* already gone */ }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }

  async _handleAdminStats(req, res) {
    try {
      const stakes = ['1-2', '5-10', '25-50'];
      let totalTables = 0;
      let totalSeated = 0;
      let openSeats = 0;
      for (const s of stakes) {
        const raw = await this.opts.redis.zrange(`lobby:${s}:tables`, 0, -1, 'WITHSCORES');
        for (let i = 0; i < raw.length; i += 2) {
          totalTables += 1;
          const open = Number(raw[i + 1]) || 0;
          openSeats += open;
          const meta = await this.opts.redis.hgetall(`table:${raw[i]}:meta`);
          const max = Number(meta.maxSeats) || 0;
          totalSeated += Math.max(0, max - open);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ totalTables, totalSeated, openSeats, swarmRunning: !!this._swarmProc }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async _handleSpectatorToken(req, res) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = body ? JSON.parse(body) : {}; }
    catch (_e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'bad_json' }));
    }
    const { tableId } = parsed;
    if (!tableId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'tableId required' }));
    }
    // Charset + length guard.
    const safeTableId = String(tableId).slice(0, 64);
    if (!/^[A-Za-z0-9_\-:]+$/.test(safeTableId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'tableId_invalid' }));
    }
    // Reject tokens for tables that don't exist — otherwise an attacker
    // can enumerate / pre-mint tokens for arbitrary IDs and DoS the WS
    // upgrade path.
    if (this.opts.redis) {
      try {
        const exists = await this.opts.redis.exists(`table:${safeTableId}:meta`);
        if (!exists) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'table_not_found' }));
        }
      } catch (_e) { /* on redis hiccup, fall through */ }
    }
    // Per-IP token bucket — 10 spectator tokens / minute / IP. Stops
    // a script from minting tokens for every table.
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    this._specTokenBuckets = this._specTokenBuckets || new Map();
    const now = Date.now();
    const bucket = this._specTokenBuckets.get(ip) || { tokens: 10, ts: now };
    bucket.tokens = Math.min(10, bucket.tokens + ((now - bucket.ts) / 60_000) * 10);
    bucket.ts = now;
    if (bucket.tokens < 1) {
      this._specTokenBuckets.set(ip, bucket);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'rate_limited' }));
    }
    bucket.tokens -= 1;
    this._specTokenBuckets.set(ip, bucket);
    const secret = this.opts.secret || process.env.GATEWAY_JWT_SECRET;
    if (!secret) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'secret_not_configured' }));
    }
    // eslint-disable-next-line global-require
    const jwt = require('jsonwebtoken');
    const sessionId = `spec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const token = jwt.sign(
      {
        sub: `spec-${sessionId}`,
        tableId: String(tableId),
        sessionId,
        // no `seat` claim — spectator
      },
      secret,
      { algorithm: 'HS256', expiresIn: '30m' }
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token, tableId, sessionId }));
  }

  async _handleSeatClaim(req, res) {
    if (!this.seatClaimer) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'seat_claim_unavailable' }));
    }
    // Per-IP rate limit — 30 claim attempts / minute. The legitimate
    // claim path on join is at most ~6 tries (one per seat). Anything
    // above that is a script trying to brute-force occupancy.
    //
    // Trusted callers bypass the limit:
    //   • loopback (127.0.0.1 / ::1) — the bot swarm runs in-process via
    //     the gateway's `/admin/swarm` spawn, so all 10k bots share this IP.
    //   • requests carrying a valid x-admin-token — the operator console
    //     and remote-deployed swarm runners.
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    const adminToken = process.env.ADMIN_TOKEN;
    const hasAdmin = adminToken && req.headers['x-admin-token'] === adminToken;
    const bypassRateLimit = isLoopback || hasAdmin;
    if (!bypassRateLimit) {
      this._claimBuckets = this._claimBuckets || new Map();
      const now = Date.now();
      const bucket = this._claimBuckets.get(ip) || { tokens: 30, ts: now };
      bucket.tokens = Math.min(30, bucket.tokens + ((now - bucket.ts) / 60_000) * 30);
      bucket.ts = now;
      if (bucket.tokens < 1) {
        this._claimBuckets.set(ip, bucket);
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'rate_limited' }));
      }
      bucket.tokens -= 1;
      this._claimBuckets.set(ip, bucket);
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
    // Server-side bounds — never let arbitrary seat numbers pollute Redis.
    const seatNum = Number(seat);
    if (!Number.isInteger(seatNum) || seatNum < 1 || seatNum > 12) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'seat_out_of_range' }));
    }
    const safeUserId = String(userId).slice(0, 64);
    if (!/^[A-Za-z0-9_\-:.]+$/.test(safeUserId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'userId_invalid' }));
    }
    const safeStake = String(stake).slice(0, 16);
    if (!/^[A-Za-z0-9_\-]+$/.test(safeStake)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'stake_invalid' }));
    }
    const safeTableId = String(tableId).slice(0, 64);
    if (!/^[A-Za-z0-9_\-:]+$/.test(safeTableId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'tableId_invalid' }));
    }
    const result = await this.seatClaimer.claim({
      stake: safeStake,
      tableId: safeTableId,
      seat: seatNum,
      userId: safeUserId,
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
    // Origin allowlist on the WS upgrade. Browsers always send Origin
    // for cross-origin WS handshakes; non-browser clients (bots/tests)
    // typically don't, and we let those through. When ALLOWED_ORIGINS
    // is unset we fall back to the same dev defaults as CORS so local
    // dev keeps working out of the box.
    const reqOrigin = req.headers && req.headers.origin;
    if (reqOrigin) {
      const allowed = (process.env.ALLOWED_ORIGINS
        || 'http://localhost:4001,http://localhost:3000,http://localhost:5173,http://127.0.0.1:4001,http://127.0.0.1:3000'
      ).split(',').map((s) => s.trim()).filter(Boolean);
      if (!allowed.includes(reqOrigin)) {
        this.log('ws_upgrade_origin_denied', { origin: reqOrigin });
        return rejectHttp(socket, 403, 'forbidden_origin');
      }
    }
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
    // Snapshot before we tear the bookkeeping down — we need it to call
    // onLeave for seated players whose socket just dropped.
    const wasSeated = ws._hijack && ws._hijack.joined && ws._hijack.seat != null && !ws._hijack.spectator;
    const leaveCtx = wasSeated
      ? {
          tableId,
          seat: ws._hijack.seat,
          userId: ws._hijack.userId,
          sessionId: ws._hijack.sessionId,
        }
      : null;
    if (ws._hijack) ws._hijack.joined = false;
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
    if (leaveCtx && this.opts.onLeave) {
      try { this.opts.onLeave(leaveCtx); }
      catch (_e) { /* best-effort */ }
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
        // Evict any prior socket already bound to (tableId, seat). The
        // seat-claim Lua hands the seat to the new caller once the old
        // reservation lapses, but the previous occupant's WS keeps its
        // `meta.seat` binding and the seat-spoof guard in `_onAction`
        // still matches — so the old occupant (typically a bot from the
        // swarm) keeps firing `c2s.action` for what is now THIS user's
        // seat. Closing the stale socket is the only way to stop it.
        const existingSet = this.byTable.get(tableId);
        if (existingSet) {
          for (const other of existingSet) {
            if (other === ws) continue;
            const om = other._hijack;
            if (!om || om.spectator) continue;
            if (om.seat == null || Number(om.seat) !== Number(claims.seat)) continue;
            if (om.boundUserId === String(claims.sub)) continue; // same user reconnect
            this.log('seat_takeover_evict', {
              tableId,
              seat: claims.seat,
              evictedUser: om.boundUserId,
              newUser: String(claims.sub),
            });
            try { this._send(other, mkKicked('seat_takeover')); } catch (_e) {}
            try { other.close(1000, 'seat_takeover'); } catch (_e) {}
            // Mark the evicted socket so any in-flight `c2s.action`
            // racing with the close gets rejected before it reaches the
            // worker.
            om.bound = false;
            om.seat = null;
          }
        }
        // Pin the seat reservation while this WS is alive. The seat-claim
        // Lua writes a 30s TTL — long enough for the WS handshake but
        // short enough that the matchmaker reaps it once we're seated,
        // which then resets the lobby ZSET back to maxSeats and makes
        // the table look empty in the UI even though we're actively
        // playing. The heartbeat loop refreshes this every interval.
        try {
          const longExpiry = Date.now() + 5 * 60 * 1000; // 5 min
          await this.opts.redis.hset(
            `table:${tableId}:seats`,
            String(claims.seat),
            `${claims.sub}|${claims.reservationToken}|${longExpiry}`,
          );
        } catch (_e) { /* best-effort */ }
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
      if (this.opts.onJoin) {
        try { this.opts.onJoin({ tableId, userId: ws._hijack.userId, seat: ws._hijack.seat, username: msg.username || ws._hijack.username }); }
        catch (_e) { /* best-effort */ }
      }
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
    // If this socket was evicted by a seat-takeover but hasn't fully
    // closed yet, drop any in-flight actions before they reach the
    // worker. Without this an evicted bot can land one last fold/call
    // for the seat its successor just claimed.
    if (ws._hijack.bound === false) {
      return this._send(ws, mkError('seat_taken_over', 'seat reassigned to another user'));
    }
    // Per-socket token-bucket rate limit. Refills at 8 actions/sec with
    // a burst of 16 — generous for a real human (timer auto-folds at
    // ~30s) but cuts off scripts that try to flood a table or mash the
    // pump loop. Tokens are stored on the ws meta to avoid a Map lookup.
    const now = Date.now();
    const meta = ws._hijack;
    if (meta.actionBucket == null) {
      meta.actionBucket = 16;
      meta.actionBucketTs = now;
    } else {
      const elapsed = (now - meta.actionBucketTs) / 1000;
      meta.actionBucket = Math.min(16, meta.actionBucket + elapsed * 8);
      meta.actionBucketTs = now;
    }
    if (meta.actionBucket < 1) {
      this.log('action_rate_limited', { tableId: meta.tableId, userId: meta.userId });
      return this._send(ws, mkError('rate_limited', 'too many actions, slow down', msg.tableId));
    }
    meta.actionBucket -= 1;
    // Reject obviously malformed action payloads before they reach the
    // worker. The engine validates legality, but we want to keep junk
    // off the worker queue altogether.
    const validActions = new Set(['fold', 'check', 'call', 'bet', 'raise', 'allin', 'all_in']);
    if (typeof msg.action !== 'string' || !validActions.has(msg.action)) {
      return this._send(ws, mkError('bad_action', 'unknown action', msg.tableId));
    }
    if (msg.amount != null) {
      const amt = Number(msg.amount);
      if (!Number.isFinite(amt) || amt < 0 || amt > 10_000_000) {
        return this._send(ws, mkError('bad_amount', 'amount out of range', msg.tableId));
      }
      msg.amount = amt;
    }
    // The seat in the action MUST match the seat the join token bound
    // this socket to. Otherwise a player could send an action labelled
    // with someone else's seat and the worker would happily process it.
    if (msg.seat != null && meta.seat != null && Number(msg.seat) !== Number(meta.seat)) {
      this.log('action_seat_spoof', { socketSeat: meta.seat, claimedSeat: msg.seat, userId: meta.userId });
      return this._send(ws, mkError('seat_mismatch', 'cannot act for another seat', msg.tableId));
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
    // Enforce monotonic per-table seq on outbound — but only for engine
    // ticks (step >= 0). Synthetic deltas (`hand_completed`, `player_updated`,
    // …) are tagged with `step === -1` and ride alongside the real seq
    // stream; if we tracked their seq the next real worker tick would be
    // dropped as a "duplicate" because they reuse `lastSeq + 1`.
    const isSynthetic = typeof msg.step === 'number' && msg.step < 0;
    if (!isSynthetic) {
      const lastForTable = this.tableSeq.get(tableId) || 0;
      if (typeof msg.seq === 'number' && msg.seq <= lastForTable) {
        return; // dropped duplicate / out-of-order republish
      }
      if (typeof msg.seq === 'number') this.tableSeq.set(tableId, msg.seq);
    }

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
    // Stringify-once fast path. Most deltas don't carry a `players[]`
    // array, so per-recipient redaction is a no-op and we'd be paying
    // 10k× the JSON.stringify cost of a single frame for nothing. Only
    // frames that actually carry hole-card-bearing `players` need the
    // per-recipient redact + restringify.
    const carriesPlayers = (
      (msg.t === 's2c.snapshot' && msg.state && Array.isArray(msg.state.players)) ||
      (msg.t === 's2c.delta' && msg.payload && Array.isArray(msg.payload.players))
    );
    let encoded = null;
    if (!carriesPlayers) {
      try { encoded = JSON.stringify(msg); } catch (_e) { /* fall back to per-recipient */ }
    }
    for (const ws of set) {
      // Spectator-mode sockets (post-handoff) get a filtered stream.
      // shouldDeliverToSpectator returns true for public events; we drop
      // any frame that may reveal hole cards for the seat the spectator
      // used to occupy.
      if (ws._hijack && ws._hijack.spectator) {
        if (!shouldDeliverToSpectator(msg, { seat: ws._hijack.seat })) continue;
      }
      if (encoded != null) this._sendEncoded(ws, encoded);
      else this._send(ws, msg);
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
   * Strip other players' hole cards from a frame before delivering it to
   * a specific socket. Without this, anyone with the browser network tab
   * could read every opponent's cards out of the WebSocket payload —
   * the per-seat `cards` array is broadcast verbatim by the worker.
   *
   * Rules:
   *   - Snapshot/delta with `players[]` → keep cards only for the seat
   *     this socket owns; everyone else's cards are replaced with a
   *     length-preserving back-of-card placeholder ('??').
   *   - At showdown (handStep ∈ FIND_WINNERS / PAY_WINNERS / RECORD_STATS)
   *     cards become public — we ship them through unchanged.
   *   - Spectators (no seat) see no hole cards pre-showdown.
   *   - Folded players' cards remain hidden even at showdown — they
   *     mucked.
   */
  _redactForRecipient(frame, ws) {
    if (!frame || (frame.t !== 's2c.snapshot' && frame.t !== 's2c.delta')) return frame;
    let players = null;
    let step = -1;
    if (frame.t === 's2c.snapshot' && frame.state) {
      players = frame.state.players;
      step = Number(frame.state.game && frame.state.game.handStep);
    } else if (frame.t === 's2c.delta' && frame.payload) {
      players = frame.payload.players;
      step = Number(frame.step);
    }
    if (!Array.isArray(players) || players.length === 0) return frame;
    const recipientSeat = ws && ws._hijack && !ws._hijack.spectator
      ? ws._hijack.seat
      : null;
    // Showdown phase = engine step 13/14/15. Cards are public for any
    // player still in the hand (status === '1'). Folded seats stay hidden.
    const isShowdown = Number.isFinite(step) && step >= 13 && step <= 15;

    const cardLen = (c) => {
      if (Array.isArray(c)) return c.length;
      if (typeof c === 'string') return c.split(',').filter(Boolean).length;
      return 0;
    };
    const PLACEHOLDER = '??';
    const hideFor = (p) => {
      const len = cardLen(p.cards);
      if (len === 0) return p;
      // Folded players (status !== '1') always hide. Otherwise hide unless
      // it's the recipient or we're at showdown.
      const isFolded = String(p.status) !== '1';
      const isMine = recipientSeat != null && Number(p.seat) === Number(recipientSeat);
      if (isMine) return p;
      if (isShowdown && !isFolded) return p;
      return { ...p, cards: Array(len).fill(PLACEHOLDER) };
    };

    const redactedPlayers = players.map(hideFor);
    // Only allocate a new frame if anything actually changed.
    let mutated = false;
    for (let i = 0; i < players.length; i += 1) {
      if (redactedPlayers[i] !== players[i]) { mutated = true; break; }
    }
    if (!mutated) return frame;

    if (frame.t === 's2c.snapshot') {
      return { ...frame, state: { ...frame.state, players: redactedPlayers } };
    }
    return { ...frame, payload: { ...frame.payload, players: redactedPlayers } };
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
    const safeFrame = this._redactForRecipient(frame, ws);
    meta.pending += 1;
    ws.send(JSON.stringify(safeFrame), (err) => {
      meta.pending = Math.max(0, meta.pending - 1);
      if (err) {
        try { ws.terminate(); } catch (_e) {}
      }
    });
  }

  /**
   * Send a pre-encoded JSON string. Used by `_broadcast` when the frame
   * has no per-recipient redaction work — saves a `JSON.stringify` per
   * recipient at swarm scale. Skips redaction by construction: the
   * caller has guaranteed the frame is safe for everyone.
   */
  _sendEncoded(ws, encoded) {
    if (ws.readyState !== ws.OPEN) return;
    const meta = ws._hijack;
    if (!meta) return;
    if (meta.pending >= this.backpressureLimit) {
      this.log('backpressure_drop', { tableId: meta.tableId, pending: meta.pending });
      try { ws.send(JSON.stringify(mkKicked('backpressure_resync'))); } catch (_e) {}
      try { ws.close(1013, 'backpressure'); } catch (_e) {}
      return;
    }
    meta.pending += 1;
    ws.send(encoded, (err) => {
      meta.pending = Math.max(0, meta.pending - 1);
      if (err) {
        try { ws.terminate(); } catch (_e) {}
      }
    });
  }

  // ─── heartbeat ──────────────────────────────────────────────────────

  async _heartbeat() {
    if (!this.wss) return;
    const refreshExpiry = Date.now() + 5 * 60 * 1000; // 5 min
    // Pass 1: ping every socket and collect the seated ones that need a
    // reservation refresh. The previous implementation fired up to 3
    // Redis ops per socket — at 10k bots that was ~30k round-trips every
    // 30s. We dedupe the players lookup per table and pipeline the
    // per-socket reads/writes so each tick is ~3 round-trips total.
    const seated = [];
    for (const ws of this.wss.clients) {
      const meta = ws._hijack;
      if (!meta) continue;
      if (!meta.isAlive) {
        try { ws.terminate(); } catch (_e) {}
        continue;
      }
      meta.isAlive = false;
      try { ws.ping(); } catch (_e) {}
      if (meta.bound && meta.tableId && meta.seat != null && meta.boundUserId && this.opts.redis) {
        seated.push(ws);
      }
    }
    if (seated.length === 0 || !this.opts.redis) return;

    // Step 1: dedupe the engine-presence lookup per table.
    const tableIds = new Set();
    for (const ws of seated) tableIds.add(ws._hijack.tableId);
    const tableIdList = [...tableIds];
    let playersArrays;
    try {
      playersArrays = await Promise.all(
        tableIdList.map((tid) => this.opts.redis.hget(`table:${tid}`, 'players').catch(() => null)),
      );
    } catch (_e) {
      return;
    }
    const playersByTable = new Map();
    for (let i = 0; i < tableIdList.length; i += 1) {
      const raw = playersArrays[i];
      let arr = null;
      if (raw) { try { arr = JSON.parse(raw); } catch (_e) {} }
      playersByTable.set(tableIdList[i], arr);
    }

    // Step 2: batch-read existing seat tokens so we can preserve them
    // on the refresh. One pipeline = one round-trip.
    let existingTokens = null;
    try {
      const pipeReads = this.opts.redis.pipeline();
      for (const ws of seated) {
        const meta = ws._hijack;
        pipeReads.hget(`table:${meta.tableId}:seats`, String(meta.seat));
      }
      existingTokens = await pipeReads.exec();
    } catch (_e) { existingTokens = null; }

    // Step 3: batch-write all hdel/hset ops in a single pipeline.
    try {
      const pipeWrites = this.opts.redis.pipeline();
      let queued = 0;
      for (let i = 0; i < seated.length; i += 1) {
        const meta = seated[i]._hijack;
        const expectedUser = String(meta.boundUserId);
        const players = playersByTable.get(meta.tableId);
        const inEngine = Array.isArray(players) && players.some(
          (p) => String(p.playerId) === expectedUser && Number(p.seat) === Number(meta.seat),
        );
        const seatKey = `table:${meta.tableId}:seats`;
        const seatStr = String(meta.seat);
        if (!inEngine) {
          // Phantom seat: drop the reservation so the lobby openSeats
          // can recover. Worker /process tick will also re-sync the
          // ZSET via state-store applyTick.
          pipeWrites.hdel(seatKey, seatStr);
          queued += 1;
          continue;
        }
        let token = '';
        if (existingTokens && existingTokens[i]) {
          const [err, val] = existingTokens[i];
          if (!err && val) {
            const parts = String(val).split('|');
            token = parts[1] || '';
          }
        }
        pipeWrites.hset(seatKey, seatStr, `${expectedUser}|${token}|${refreshExpiry}`);
        queued += 1;
      }
      if (queued > 0) await pipeWrites.exec();
    } catch (_e) { /* best-effort */ }
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
