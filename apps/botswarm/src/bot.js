'use strict';

/**
 * bot.js — single bot, single WS connection.
 *
 * Lifecycle:
 *   1. open WS to gateway with bot-minted JWT
 *   2. send `c2s.join { tableId }`
 *   3. apply `s2c.snapshot` -> local view
 *   4. apply `s2c.delta`    -> mutate local view
 *   5. when it's our turn, strategy.decide(view) -> send `c2s.action`
 *   6. on SIGTERM (or runner.stop()): send `c2s.leave`, then close
 *
 * The bot owns NO heavy state — `state` is a thin projection of the
 * snapshot fields the strategies actually read (currentBet, myBet,
 * myStack, etc.). Heap target: < 2 MB resident per bot.
 */

const WebSocket = require('ws');
const {
  C2S,
  S2C,
  ACTIONS,
  isServerMessage,
} = require('@hijack/protocol/messages');
const { mintBotToken, botUrl } = require('./auth');
const { pickProfile } = require('./strategies');

// Per-bot tunables. Keep the surface area tiny — every field here costs
// 10k× when we run the full swarm.
const DEFAULTS = Object.freeze({
  reconnectBaseMs: 500,
  reconnectMaxMs: 10_000,
  actionDelayMs: 200,        // throttle so we don't fire faster than humans
  actionDelayJitterMs: 400,
});

/**
 * Tiny seedable PRNG (Mulberry32). One per bot — gives us deterministic
 * decisions in tests and avoids the 64-byte allocation that
 * `Math.random` requires for crypto seeding on Node startup.
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Bot {
  /**
   * @param {object} opts
   * @param {string} opts.gatewayUrl       e.g. `ws://127.0.0.1:8080`
   * @param {string} opts.tableId
   * @param {string} opts.botId
   * @param {string} opts.profile          'random' | 'tight' | 'loose'
   * @param {number} [opts.seat]
   * @param {string} [opts.secret]         JWT secret override
   * @param {number} [opts.seed]
   * @param {object} [opts.metrics]        Metrics object (optional)
   * @param {(level:string,obj:object)=>void} [opts.log]
   */
  constructor(opts) {
    this.opts = { ...DEFAULTS, ...opts };
    this.botId = opts.botId;
    this.tableId = String(opts.tableId);
    this.profile = pickProfile(opts.profile);
    this.metrics = opts.metrics || null;
    this.log = opts.log || (() => {});
    this.rng = makeRng(opts.seed != null ? opts.seed : (Date.now() ^ hash(opts.botId)));

    /** @type {WebSocket|null} */
    this.ws = null;
    this.lastSeq = 0;
    this.joined = false;
    this.shuttingDown = false;
    this.reconnectAttempt = 0;
    this.pendingActionTimer = null;

    // Strategy view — the minimum slice of state strategies need.
    // Updated from snapshots/deltas. Kept flat to keep JIT happy.
    this.view = {
      currentBet: 0,
      myBet: 0,
      myStack: 0,
      mySeat: opts.seat,
      bigBlind: 2,
      isMyTurn: false,
      handStep: 'GAME_PREP',
    };
  }

  start() {
    if (this.ws) return;
    this._open();
  }

  /**
   * Graceful shutdown. Sends `c2s.leave` then closes.
   * Returns once the socket is closed (or after a 2s grace timeout).
   */
  async stop() {
    this.shuttingDown = true;
    clearTimeout(this.pendingActionTimer);
    this.pendingActionTimer = null;
    const ws = this.ws;
    if (!ws) return;
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({ t: C2S.LEAVE, tableId: this.tableId }));
      } catch (_e) { /* ignore */ }
    }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      ws.once('close', finish);
      ws.once('error', finish);
      try { ws.close(1000, 'bot_shutdown'); } catch (_e) {}
      setTimeout(() => {
        try { ws.terminate(); } catch (_e) {}
        finish();
      }, 2000).unref?.();
    });
  }

  // ─── transport ───────────────────────────────────────────────────────

  _open() {
    if (this.shuttingDown) return;
    const token = mintBotToken({
      botId: this.botId,
      tableId: this.tableId,
      seat: this.opts.seat,
      secret: this.opts.secret,
    });
    const url = botUrl({ gatewayUrl: this.opts.gatewayUrl, tableId: this.tableId, token });
    let ws;
    try {
      ws = new WebSocket(url, { perMessageDeflate: false });
    } catch (err) {
      this._onConnError(err);
      return;
    }
    this.ws = ws;
    this.joined = false;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
      // Bots always join with `lastSeq: 0` — they don't track gaps; if the
      // gateway's durable store is missing events, snapshot is fine, the
      // bot doesn't care about historical hands.
      try {
        ws.send(JSON.stringify({
          t: C2S.JOIN,
          tableId: this.tableId,
          seat: this.opts.seat,
          lastSeq: 0,
        }));
      } catch (err) { this._onConnError(err); }
    });

    ws.on('message', (raw) => this._onMessage(raw));
    ws.on('close', () => this._onClose());
    ws.on('error', (err) => this._onConnError(err));
  }

  _onClose() {
    this.ws = null;
    this.joined = false;
    if (this.shuttingDown) return;
    // Exponential backoff with cap. The runner's overall ramp limiter
    // keeps the herd thin; we add jitter here to avoid synchronized
    // reconnect storms.
    const delay = Math.min(
      this.opts.reconnectMaxMs,
      this.opts.reconnectBaseMs * (2 ** this.reconnectAttempt)
    ) + Math.floor(this.rng() * 200);
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 8);
    setTimeout(() => this._open(), delay).unref?.();
  }

  _onConnError(err) {
    if (this.metrics) this.metrics.connectionErrors += 1;
    this.log('warn', { evt: 'conn_err', botId: this.botId, err: err && err.message });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (_e) { return; }
    if (!isServerMessage(msg)) return;

    switch (msg.t) {
      case S2C.SNAPSHOT:
        this.lastSeq = msg.seq;
        this._applySnapshot(msg.state);
        this.joined = true;
        this._maybeAct();
        break;
      case S2C.DELTA:
        this.lastSeq = msg.seq;
        this._applyDelta(msg.payload);
        this._maybeAct();
        break;
      case S2C.ERROR:
        // Don't escalate — just log. Engine will continue and hand us
        // another turn shortly.
        this.log('warn', { evt: 's2c.error', botId: this.botId, code: msg.code, message: msg.message });
        break;
      case S2C.KICKED:
        // Server is forcibly closing us. Let the close handler reconnect.
        this.log('info', { evt: 's2c.kicked', botId: this.botId, reason: msg.reason });
        break;
      default:
        break;
    }
  }

  // ─── view projection ────────────────────────────────────────────────

  _applySnapshot(state) {
    if (!state || typeof state !== 'object') return;
    const game = state.game || {};
    const players = state.players || [];
    this.view.currentBet = num(game.currentBet);
    this.view.bigBlind = num(game.bigBlind, 2);
    this.view.handStep = String(game.handStep || '');
    const me = pickMe(players, this.botId, this.opts.seat);
    if (me) {
      this.view.mySeat = me.seat;
      this.view.myBet = num(me.bet);
      this.view.myStack = num(me.stack);
      this.view.isMyTurn = isMyTurn(game, me);
    } else {
      // We're not seated — the table may still be filling. Pretend it's
      // not our turn; if the engine deals us in we'll see a delta.
      this.view.isMyTurn = false;
    }
  }

  _applyDelta(payload) {
    if (!payload || typeof payload !== 'object') return;
    // Deltas come in many shapes from the worker. We pull the small set
    // of fields we care about and fall back to leaving values in place.
    if (payload.game) {
      const g = payload.game;
      if (g.currentBet != null) this.view.currentBet = num(g.currentBet);
      if (g.bigBlind != null) this.view.bigBlind = num(g.bigBlind, 2);
      if (g.handStep != null) this.view.handStep = String(g.handStep);
      if (g.move != null && this.view.mySeat != null) {
        this.view.isMyTurn = Number(g.move) === Number(this.view.mySeat);
      }
    }
    if (Array.isArray(payload.players)) {
      const me = pickMe(payload.players, this.botId, this.view.mySeat);
      if (me) {
        if (me.bet != null) this.view.myBet = num(me.bet);
        if (me.stack != null) this.view.myStack = num(me.stack);
      }
    }
    // Some engine deltas use a flat `currentSeat` / `toAct` hint.
    if (payload.toAct != null && this.view.mySeat != null) {
      this.view.isMyTurn = Number(payload.toAct) === Number(this.view.mySeat);
    }
  }

  // ─── decision loop ──────────────────────────────────────────────────

  _maybeAct() {
    if (!this.joined || this.shuttingDown) return;
    if (!this.view.isMyTurn) return;
    if (this.pendingActionTimer) return;
    const delay =
      this.opts.actionDelayMs +
      Math.floor(this.rng() * this.opts.actionDelayJitterMs);
    this.pendingActionTimer = setTimeout(() => {
      this.pendingActionTimer = null;
      this._fire();
    }, delay);
    this.pendingActionTimer.unref?.();
  }

  _fire() {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    if (!this.view.isMyTurn) return;
    let decision;
    try {
      decision = this.profile.decide(this.view, { rng: this.rng });
    } catch (err) {
      // If the strategy ever throws, fall back to check-or-fold so we
      // never softlock the table.
      decision = { action: this.view.currentBet > this.view.myBet ? ACTIONS.FOLD : ACTIONS.CHECK };
      this.log('warn', { evt: 'strategy_threw', botId: this.botId, err: err.message });
    }
    if (!decision || !decision.action) {
      decision = { action: ACTIONS.CHECK };
    }
    const frame = {
      t: C2S.ACTION,
      tableId: this.tableId,
      seat: this.view.mySeat == null ? 0 : Number(this.view.mySeat),
      action: decision.action,
    };
    if (decision.amount != null) frame.amount = Number(decision.amount);
    try {
      this.ws.send(JSON.stringify(frame));
      if (this.metrics) this.metrics.actions += 1;
      // Optimistically clear our turn — the next delta will set it
      // again if the engine disagrees. This avoids double-firing if
      // deltas arrive faster than the engine's tick.
      this.view.isMyTurn = false;
    } catch (err) {
      this._onConnError(err);
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickMe(players, botId, seat) {
  if (!Array.isArray(players)) return null;
  // Prefer match by seat (cheaper, deterministic). Fall back to guid /
  // username heuristic for snapshots that label players by name.
  if (seat != null) {
    const bySeat = players.find((p) => Number(p.seat) === Number(seat));
    if (bySeat) return bySeat;
  }
  const idStr = String(botId);
  return (
    players.find((p) => p.guid === idStr) ||
    players.find((p) => p.username === idStr) ||
    players.find((p) => String(p.playerId) === idStr) ||
    null
  );
}

function isMyTurn(game, me) {
  if (!game || !me) return false;
  if (game.move != null) return Number(game.move) === Number(me.seat);
  if (game.toAct != null) return Number(game.toAct) === Number(me.seat);
  if (game.currentSeat != null) return Number(game.currentSeat) === Number(me.seat);
  return false;
}

function hash(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

module.exports = { Bot, makeRng };
