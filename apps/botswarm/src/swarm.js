#!/usr/bin/env node
'use strict';
// swarm.js — keep seating bots across all stakes until N total are
// connected. Hops to new tables as the matchmaker spawns them. Each
// bot opens its own WS and runs the auto-call/check strategy from
// seat-bots.js (re-imported via a small inline module).
//
// At swarm scale (10k bots) a single Node process saturates the event
// loop with WS + JSON.parse + per-bot 1Hz timers, so the gateway falls
// behind on broadcasts and bots miss action windows. We shard the load
// across `cluster` workers — each worker owns a contiguous slice of the
// userId range and reports `connected` deltas to the master via IPC.

const cluster = require('cluster');
const os = require('os');
const WebSocket = require('ws');
const { C2S, S2C } = require('@hijack/protocol/messages');

const HTTP = process.env.GATEWAY_HTTP_URL || 'http://127.0.0.1:3002';
const WS  = process.env.HIJACK_GATEWAY_URL || 'ws://127.0.0.1:3002';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const STAKES = ['1-2', '5-10', '25-50'];
const BETTING_STEPS = new Set([5, 7, 9, 11]);

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const TARGET = Number(arg('total', 10000));
const RAMP_PER_SEC = Number(arg('ramp', 50));
const ID_PREFIX = arg('idPrefix', 'bot-swarm');
const TARGET_TABLE_ID = arg('tableId', '');
const TARGET_STAKE = arg('stake', '');
// Default to 6 workers (or fewer if the box has fewer cores). Directed
// runs (--tableId) stick to a single worker — they're tiny and don't
// benefit from sharding.
const DEFAULT_WORKERS = Math.max(1, Math.min(6, (os.cpus() || []).length || 1));
const WORKERS = TARGET_TABLE_ID
  ? 1
  : Math.max(1, Number(arg('workers', DEFAULT_WORKERS)));

let connected = 0;
let lastReport = Date.now();
const conns = [];

// One shared 1Hz tick per process walks every bot's `maybeAct`. With 10k
// bots a per-bot setInterval was scheduling 10k timers per second — most
// of them no-ops — which dominated the event loop. The shared tick still
// fires every bot's safety net but only costs one timer wakeup.
const sharedBots = [];
let sharedTickStarted = false;
function startSharedTick() {
  if (sharedTickStarted) return;
  sharedTickStarted = true;
  setInterval(() => {
    for (let i = 0; i < sharedBots.length; i += 1) {
      const fn = sharedBots[i];
      if (fn) {
        try { fn(); } catch (_e) { /* one bot's bug must not stall the rest */ }
      }
    }
  }, 1000).unref();
}
function registerSharedBot(fn) {
  startSharedTick();
  sharedBots.push(fn);
  return sharedBots.length - 1;
}
function unregisterSharedBot(idx) {
  if (idx >= 0 && idx < sharedBots.length) sharedBots[idx] = null;
}

// Per-process lobby cache. With 1500 bots/worker ramping at once, every
// bot was firing 3 `/lobby/<stake>` GETs — ~4500 HTTP round-trips per
// worker just to pick a seat. Coalesce into one in-flight fetch per
// stake and reuse the merged candidate list for ~500ms.
const LOBBY_CACHE_TTL_MS = 500;
const lobbyCache = new Map(); // stake -> { ts, tables }
const lobbyInflight = new Map(); // stake -> Promise<tables>
async function fetchLobby(stake) {
  const now = Date.now();
  const cached = lobbyCache.get(stake);
  if (cached && (now - cached.ts) < LOBBY_CACHE_TTL_MS) return cached.tables;
  const inflight = lobbyInflight.get(stake);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const r = await fetch(`${HTTP}/lobby/${stake}`);
      if (!r.ok) return [];
      const body = await r.json();
      return body.tables || [];
    } catch (_e) {
      return [];
    }
  })().then((tables) => {
    lobbyCache.set(stake, { ts: Date.now(), tables });
    lobbyInflight.delete(stake);
    return tables;
  });
  lobbyInflight.set(stake, p);
  return p;
}

async function pickOpenSeat(excludeTableIds) {
  const exclude = excludeTableIds || new Set();
  if (TARGET_TABLE_ID && TARGET_STAKE) {
    const tables = await fetchLobby(TARGET_STAKE);
    const t = tables.find((x) => x.tableId === TARGET_TABLE_ID && x.openSeats > 0);
    if (t) return { stake: TARGET_STAKE, tableId: t.tableId, maxSeats: t.maxSeats };
    return null;
  }
  // Spread the herd: collect ALL open tables across stakes and pick one
  // at random. Picking the first hit always converges every bot in a wave
  // onto the same table, so only 6 seat-claims win and the rest fail.
  const tablesByStake = await Promise.all(STAKES.map((s) => fetchLobby(s).then((tables) => [s, tables])));
  const candidates = [];
  for (const [stake, tables] of tablesByStake) {
    for (const t of tables) {
      if (t.openSeats > 0 && !exclude.has(t.tableId)) {
        candidates.push({ stake, tableId: t.tableId, maxSeats: t.maxSeats });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function spawnOne(idx) {
  const userId = `${ID_PREFIX}-${String(idx).padStart(5, '0')}`;
  // Outer retry: when a wave of bots converges on the same table, only
  // `maxSeats` claims win — the rest must fall back to a different table.
  // Without this loop those bots silently give up and the swarm never
  // reaches its target.
  const tried = new Set();
  let target = null;
  let claim = null;
  let mySeat = null;
  for (let outer = 0; outer < 8 && !claim; outer += 1) {
    target = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      target = await pickOpenSeat(tried);
      if (target) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (!target) return false;
    tried.add(target.tableId);
    // Randomize seat order so concurrent bots on the same table don't all
    // race for seat 1 → seat 2 → seat 3 in lockstep.
    const seats = [];
    for (let s = 1; s <= target.maxSeats; s += 1) seats.push(s);
    for (let i = seats.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    for (const s of seats) {
      try {
        const headers = { 'content-type': 'application/json' };
        if (ADMIN_TOKEN) headers['x-admin-token'] = ADMIN_TOKEN;
        const cr = await fetch(`${HTTP}/seat-claim`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ stake: target.stake, tableId: target.tableId, seat: s, userId }),
        });
        if (cr.ok) { claim = await cr.json(); mySeat = s; break; }
      } catch (_e) {}
    }
  }
  if (!claim) return false;

  const ws = new WebSocket(
    `${WS}/table/${encodeURIComponent(target.tableId)}?token=${encodeURIComponent(claim.joinToken)}`,
    { perMessageDeflate: false }
  );
  // Let the kernel coalesce the small JSON frames we send (JOIN, ACTION).
  // Disabling Nagle (the default in `ws`) makes 10k bots hammer TCP with
  // tiny PSH packets and pumps RTO/retransmits under load.
  ws.on('open', () => {
    try { ws._socket && ws._socket.setNoDelay(false); } catch (_e) {}
  });
  let game = null;
  let players = [];
  let lastActedKey = '';
  function isBettingStep() {
    if (!game) return false;
    const step = Number(game.handStep);
    if (BETTING_STEPS.has(step)) return true;
    const name = String(game.stepName || '');
    return name.includes('BETTING');
  }
  function maybeAct() {
    if (!game) return;
    if (!isBettingStep()) return;
    if (Number(game.move) !== Number(mySeat)) return;
    const me = (players || []).find((p) => Number(p.seat) === Number(mySeat));
    if (!me || String(me.status) !== '1') return;
    // De-dupe: don't fire twice for the same (gameNo, step, currentBet) tuple.
    const key = `${game.gameNo}:${game.handStep}:${game.currentBet}`;
    if (key === lastActedKey) return;
    if (ws.readyState !== ws.OPEN) return; // wait for OPEN; safety-net interval will retry
    const toCall = Number(game.currentBet || 0) - Number(me.bet || 0);
    const action = toCall > 0 ? 'call' : 'check';
    let sent = false;
    try {
      ws.send(JSON.stringify({ t: C2S.ACTION, tableId: target.tableId, seat: mySeat, action }));
      sent = true;
    } catch (_e) { /* will retry on next tick */ }
    // Only set the dedupe key AFTER a successful send — otherwise a transient
    // send failure permanently strands the bot on this state.
    if (sent) lastActedKey = key;
  }
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: C2S.JOIN, tableId: target.tableId, seat: mySeat, lastSeq: 0, joinToken: claim.joinToken }));
    connected += 1;
    reportConnDelta(1);
  });
  // Pre-built fast-skip needles for raw-string peeking. Avoids decoding
  // and parsing JSON for the ~80% of deltas that are some other seat's
  // move and don't carry a `players[]` array we'd need.
  const mySeatMoveNeedle = `"move":${Number(mySeat)}`;
  ws.on('message', (raw) => {
    const rawStr = typeof raw === 'string' ? raw : raw.toString();
    // Cheap pre-parse triage on deltas: if it's not a snapshot, doesn't
    // mention our seat as the move target, and carries no players[]
    // update we'd need to track, skip the JSON.parse entirely. Snapshot
    // frames are rare (one at JOIN) so let those through.
    if (
      rawStr.indexOf('"s2c.snapshot"') === -1 &&
      rawStr.indexOf(mySeatMoveNeedle) === -1 &&
      rawStr.indexOf('"players"') === -1
    ) {
      return;
    }
    let msg; try { msg = JSON.parse(rawStr); } catch { return; }
    if (msg.t === S2C.SNAPSHOT) {
      game = msg.state?.game; players = msg.state?.players || []; maybeAct();
    } else if (msg.t === S2C.DELTA) {
      const p = msg.payload || {};
      if (p.game) game = p.game;
      else if (game) {
        if (p.to != null) game.handStep = p.to;
        if (p.stepName != null) game.stepName = p.stepName;
        if (p.move != null) game.move = p.move;
        if (p.currentBet != null) game.currentBet = p.currentBet;
        if (p.pot != null) game.pot = p.pot;
        if (p.community != null) game.communityCards = p.community;
        if (p.gameNo != null) game.gameNo = p.gameNo;
      }
      if (p.players) players = p.players;
      maybeAct();
    }
  });
  // Safety net: even if a delta arrives without a recognised payload shape,
  // re-check every second whether it's our turn. The de-dupe in `maybeAct`
  // keeps this idempotent. Shared per-process tick — see `startSharedTick`.
  const sharedSlot = registerSharedBot(maybeAct);
  ws.on('close', () => { unregisterSharedBot(sharedSlot); connected -= 1; reportConnDelta(-1); });
  ws.on('error', () => { /* swallow */ });
  conns.push(ws);
  return true;
}

// Worker → master IPC. Workers buffer connection deltas and flush every
// 250ms so the master can aggregate without one IPC message per bot.
let pendingDelta = 0;
let deltaFlushTimer = null;
function reportConnDelta(d) {
  if (!cluster.isWorker || !process.send) return;
  pendingDelta += d;
  if (deltaFlushTimer) return;
  deltaFlushTimer = setTimeout(() => {
    const delta = pendingDelta;
    pendingDelta = 0;
    deltaFlushTimer = null;
    try { process.send({ type: 'conn', delta }); } catch (_e) {}
  }, 250);
  deltaFlushTimer.unref?.();
}

async function runWorker() {
  const startIdx = Number(process.env.BOT_START_IDX || 0);
  const sliceTarget = Number(process.env.BOT_SLICE_TARGET || TARGET);
  const sliceRamp = Math.max(1, Number(process.env.BOT_SLICE_RAMP || RAMP_PER_SEC));
  let idx = 0;
  let failures = 0;
  while (idx < sliceTarget) {
    const batchSize = Math.min(sliceRamp, sliceTarget - idx);
    const batch = [];
    for (let i = 0; i < batchSize; i += 1) {
      const globalIdx = startIdx + idx;
      batch.push(spawnOne(globalIdx).then((ok) => { if (!ok) failures += 1; }));
      idx += 1;
    }
    await Promise.allSettled(batch);
    await new Promise((r) => setTimeout(r, 1000));
    if (failures > 50 && connected < idx * 0.1) {
      try { process.send?.({ type: 'aborting', failures, connected }); } catch (_e) {}
      break;
    }
  }
  try { process.send?.({ type: 'ramp_complete', connected, spawned: idx }); } catch (_e) {}
  setInterval(() => {}, 1 << 30);
}

function runMaster() {
  console.log(JSON.stringify({ event: 'swarm_start', target: TARGET, ramp: RAMP_PER_SEC, workers: WORKERS }));
  // Divide TARGET as evenly as possible across workers — first
  // `remainder` workers get one extra bot so the slices sum to TARGET
  // exactly. Same shape for the ramp budget.
  const baseTarget = Math.floor(TARGET / WORKERS);
  const remainder = TARGET - baseTarget * WORKERS;
  const baseRamp = Math.max(1, Math.floor(RAMP_PER_SEC / WORKERS));
  let cursor = 0;
  const stats = { connected: 0, spawned: 0 };
  for (let w = 0; w < WORKERS; w += 1) {
    const sliceTarget = baseTarget + (w < remainder ? 1 : 0);
    if (sliceTarget <= 0) continue;
    const env = {
      ...process.env,
      BOT_START_IDX: String(cursor),
      BOT_SLICE_TARGET: String(sliceTarget),
      BOT_SLICE_RAMP: String(baseRamp),
    };
    cursor += sliceTarget;
    const worker = cluster.fork(env);
    worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'conn') stats.connected += Number(msg.delta) || 0;
      else if (msg.type === 'ramp_complete') stats.spawned += Number(msg.spawned) || 0;
    });
    worker.on('exit', (code, signal) => {
      console.log(JSON.stringify({ event: 'swarm_worker_exit', workerId: w, code, signal }));
    });
  }
  setInterval(() => {
    lastReport = Date.now();
    console.log(JSON.stringify({ event: 'swarm_status', connected: stats.connected, target: TARGET, spawned: stats.spawned, workers: WORKERS }));
  }, 5000).unref();

  const shutdown = () => {
    for (const id of Object.keys(cluster.workers || {})) {
      try { cluster.workers[id].kill('SIGTERM'); } catch (_e) {}
    }
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main() {
  if (WORKERS > 1 && cluster.isPrimary) {
    runMaster();
    return;
  }
  // Single-process fallback: directed runs (--tableId), --workers=1, or
  // already inside a forked worker.
  if (cluster.isWorker) {
    process.on('SIGTERM', () => { for (const ws of conns) try { ws.close(); } catch {} process.exit(0); });
    await runWorker();
    return;
  }
  // Single-process inline (no forking).
  process.on('SIGTERM', () => { for (const ws of conns) try { ws.close(); } catch {} process.exit(0); });
  process.on('SIGINT',  () => { for (const ws of conns) try { ws.close(); } catch {} process.exit(0); });
  console.log(JSON.stringify({ event: 'swarm_start', target: TARGET, ramp: RAMP_PER_SEC, workers: 1 }));
  let idx = 0;
  let failures = 0;
  setInterval(() => {
    lastReport = Date.now();
    console.log(JSON.stringify({ event: 'swarm_status', connected, target: TARGET, spawned: idx }));
  }, 5000).unref();
  while (idx < TARGET) {
    const batchSize = Math.min(RAMP_PER_SEC, TARGET - idx);
    const batch = [];
    for (let i = 0; i < batchSize; i += 1) {
      batch.push(spawnOne(idx).then((ok) => { if (!ok) failures += 1; }));
      idx += 1;
    }
    await Promise.allSettled(batch);
    await new Promise((r) => setTimeout(r, 1000));
    if (failures > 50 && connected < idx * 0.1) {
      console.log(JSON.stringify({ event: 'swarm_aborting', failures, connected }));
      break;
    }
  }
  console.log(JSON.stringify({ event: 'swarm_ramp_complete', connected, spawned: idx }));
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => { console.error(err); process.exit(1); });
