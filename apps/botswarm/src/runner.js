#!/usr/bin/env node
'use strict';

/**
 * runner.js — spawns N bots, ramps the connection rate, prints metrics,
 *             handles graceful shutdown.
 *
 * Usage:
 *   GATEWAY_JWT_SECRET=… node src/runner.js \
 *     --gateway=ws://gw.fly.dev \
 *     --tables=table-1,table-2 \
 *     --bots=1000 \
 *     --rate=100 \
 *     --duration=900 \
 *     --profile=mix
 *
 * Lobby mode (Phase 3, when merged):
 *   --lobby=https://api.example.com    (POST /lobby/sit-down for tableId)
 *
 * Direct-table fallback (the default in this worktree, since lobby isn't
 * wired yet): bots are round-robin assigned across `--tables`.
 *
 * Metrics: one JSON line per second on stdout —
 *   {"ts":..., "bots_active":..., "actions_per_sec":..., "connection_errors":...}
 */

const { Bot } = require('./bot');
const { PROFILES } = require('./strategies');
const { initTracing, shutdownTracing } = require('@hijack/observability/tracing');

// Hard rules from the phase contract.
const RAMP_DEFAULT = 100;       // bots/sec — thundering-herd guard
const METRICS_INTERVAL_MS = 1000;

class Runner {
  /**
   * @param {object} cfg
   * @param {string} cfg.gatewayUrl
   * @param {string[]} cfg.tableIds
   * @param {number} cfg.bots                target bot count
   * @param {number} [cfg.rampPerSec]        default 100
   * @param {string} [cfg.profile]           'random'|'tight'|'loose'|'mix'
   * @param {string} [cfg.secret]            override JWT secret (tests)
   * @param {(line:string)=>void} [cfg.write]   stdout sink
   * @param {(level:string,obj:object)=>void} [cfg.log]
   */
  constructor(cfg) {
    if (!cfg.gatewayUrl) throw new Error('gatewayUrl required');
    if (!cfg.tableIds || cfg.tableIds.length === 0) {
      throw new Error('at least one tableId required (lobby fallback)');
    }
    if (!Number.isFinite(cfg.bots) || cfg.bots <= 0) throw new Error('bots>0 required');
    this.cfg = {
      profile: 'mix',
      rampPerSec: RAMP_DEFAULT,
      ...cfg,
    };
    this.bots = [];
    this.metrics = {
      bots_active: 0,
      actions: 0,
      lastActions: 0,
      connectionErrors: 0,
      lastErrors: 0,
    };
    this.spawnTimer = null;
    this.metricsTimer = null;
    this.running = false;
    this.write = cfg.write || ((line) => process.stdout.write(line + '\n'));
    this.log = cfg.log || (() => {});
    this._spawned = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Ramp 100 bots/sec. We use a setInterval at 100ms granularity (so
    // a 100/s ramp = ~10 bots per tick) instead of one huge for-loop —
    // the latter would synchronously open hundreds of sockets and OOM
    // the WS lib's handshake queue.
    const tickMs = 100;
    const perTick = Math.max(1, Math.ceil(this.cfg.rampPerSec / (1000 / tickMs)));
    this.spawnTimer = setInterval(() => this._spawnBatch(perTick), tickMs);
    this.spawnTimer.unref?.();
    this.metricsTimer = setInterval(() => this._emitMetrics(), METRICS_INTERVAL_MS);
    this.metricsTimer.unref?.();
  }

  /**
   * Stop spawning, then send `c2s.leave` on every bot, then close.
   * Resolves when every socket has closed (or after a 5s grace).
   */
  async stop() {
    this.running = false;
    clearInterval(this.spawnTimer);
    clearInterval(this.metricsTimer);
    this.spawnTimer = null;
    this.metricsTimer = null;
    // Drain in chunks to avoid a 10k-wide simultaneous flush.
    const chunk = 200;
    for (let i = 0; i < this.bots.length; i += chunk) {
      const slice = this.bots.slice(i, i + chunk);
      await Promise.all(slice.map((b) => b.stop().catch(() => {})));
    }
    this._emitMetrics(); // final tick
  }

  // ─── internals ──────────────────────────────────────────────────────

  _spawnBatch(n) {
    if (!this.running) return;
    const remaining = this.cfg.bots - this._spawned;
    if (remaining <= 0) {
      clearInterval(this.spawnTimer);
      this.spawnTimer = null;
      return;
    }
    const toSpawn = Math.min(n, remaining);
    for (let i = 0; i < toSpawn; i += 1) {
      const idx = this._spawned;
      this._spawned += 1;
      const tableId = this.cfg.tableIds[idx % this.cfg.tableIds.length];
      const profile = pickProfileName(this.cfg.profile, idx);
      const seat = this.cfg.fixedSeat != null ? this.cfg.fixedSeat : undefined;
      const bot = new Bot({
        gatewayUrl: this.cfg.gatewayUrl,
        tableId,
        botId: `bot-${String(idx).padStart(5, '0')}`,
        profile,
        seat,
        secret: this.cfg.secret,
        seed: idx + 1, // deterministic across restarts
        metrics: {
          get actions() { return this._a; },
          set actions(v) { this._a = v; },
          get connectionErrors() { return this._e; },
          set connectionErrors(v) { this._e = v; },
          _a: 0,
          _e: 0,
        },
        log: this.log,
      });
      // Wire the per-bot counters into our aggregate. Cheaper than a
      // Set-based fan-out for 10k bots.
      const m = bot.metrics;
      Object.defineProperty(m, 'actions', {
        get: () => m._a,
        set: (v) => { const d = v - m._a; m._a = v; this.metrics.actions += d; },
      });
      Object.defineProperty(m, 'connectionErrors', {
        get: () => m._e,
        set: (v) => { const d = v - m._e; m._e = v; this.metrics.connectionErrors += d; },
      });
      bot.start();
      this.bots.push(bot);
    }
  }

  _emitMetrics() {
    const active = countActive(this.bots);
    const actions = this.metrics.actions;
    const errs = this.metrics.connectionErrors;
    const aps = actions - this.metrics.lastActions;
    const eps = errs - this.metrics.lastErrors;
    this.metrics.lastActions = actions;
    this.metrics.lastErrors = errs;
    this.metrics.bots_active = active;
    const line = JSON.stringify({
      ts: Date.now(),
      bots_active: active,
      actions_per_sec: aps,
      actions_total: actions,
      connection_errors: eps,
      connection_errors_total: errs,
      spawned: this._spawned,
      target: this.cfg.bots,
    });
    try { this.write(line); } catch (_e) {}
  }
}

function countActive(bots) {
  let n = 0;
  for (let i = 0; i < bots.length; i += 1) {
    const ws = bots[i].ws;
    if (ws && ws.readyState === ws.OPEN && bots[i].joined) n += 1;
  }
  return n;
}

function pickProfileName(profile, idx) {
  if (profile === 'mix') {
    const names = Object.keys(PROFILES);
    return names[idx % names.length];
  }
  if (!PROFILES[profile]) throw new Error(`unknown profile: ${profile}`);
  return profile;
}

// ─── CLI entry ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
    else if (a.startsWith('--')) args[a.slice(2)] = true;
  }
  return args;
}

async function main() {
  // No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
  await initTracing({ serviceName: 'hijack-botswarm' });
  const args = parseArgs(process.argv.slice(2));
  const gatewayUrl = args.gateway || process.env.HIJACK_GATEWAY_URL || 'ws://127.0.0.1:8080';
  const tablesCsv = args.tables || process.env.HIJACK_TABLE_IDS || '1';
  const tableIds = tablesCsv.split(',').map((s) => s.trim()).filter(Boolean);
  const bots = Number(args.bots || process.env.HIJACK_BOTS || 100);
  const rampPerSec = Number(args.rate || RAMP_DEFAULT);
  const durationSec = Number(args.duration || 60);
  const profile = args.profile || 'mix';
  if (args.lobby) {
    process.stderr.write(
      'runner: --lobby flag was passed but Phase 3 lobby is not yet wired in this worktree; ' +
      'falling back to direct table connect via --tables.\n'
    );
  }
  const runner = new Runner({ gatewayUrl, tableIds, bots, rampPerSec, profile });
  runner.start();

  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`runner: received ${sig}, draining…\n`);
    await runner.stop();
    await shutdownTracing();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  if (durationSec > 0) {
    setTimeout(() => shutdown('duration_elapsed'), durationSec * 1000).unref?.();
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`runner: fatal ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = { Runner };
