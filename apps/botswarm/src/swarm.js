#!/usr/bin/env node
'use strict';
// swarm.js — keep seating bots across all stakes until N total are
// connected. Hops to new tables as the matchmaker spawns them. Each
// bot opens its own WS and runs the auto-call/check strategy from
// seat-bots.js (re-imported via a small inline module).

const WebSocket = require('ws');
const { C2S, S2C } = require('@hijack/protocol/messages');

const HTTP = process.env.GATEWAY_HTTP_URL || 'http://127.0.0.1:3002';
const WS  = process.env.HIJACK_GATEWAY_URL || 'ws://127.0.0.1:3002';
const STAKES = ['1-2', '5-10', '25-50'];
const BETTING_STEPS = new Set([5, 7, 9, 11]);

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const TARGET = Number(arg('total', 10000));
const RAMP_PER_SEC = Number(arg('ramp', 50));
const ID_PREFIX = arg('idPrefix', 'bot-swarm');

let connected = 0;
let lastReport = Date.now();
const conns = [];

async function pickOpenSeat() {
  // round-robin across stakes
  for (const stake of STAKES) {
    try {
      const r = await fetch(`${HTTP}/lobby/${stake}`);
      if (!r.ok) continue;
      const body = await r.json();
      const t = (body.tables || []).find((x) => x.openSeats > 0);
      if (t) return { stake, tableId: t.tableId, maxSeats: t.maxSeats };
    } catch (_e) {}
  }
  return null;
}

async function spawnOne(idx) {
  const target = await pickOpenSeat();
  if (!target) return false;
  const userId = `${ID_PREFIX}-${String(idx).padStart(5, '0')}`;
  let claim = null;
  let mySeat = null;
  for (let s = 1; s <= target.maxSeats; s += 1) {
    try {
      const cr = await fetch(`${HTTP}/seat-claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stake: target.stake, tableId: target.tableId, seat: s, userId }),
      });
      if (cr.ok) { claim = await cr.json(); mySeat = s; break; }
    } catch (_e) {}
  }
  if (!claim) return false;

  const ws = new WebSocket(
    `${WS}/table/${encodeURIComponent(target.tableId)}?token=${encodeURIComponent(claim.joinToken)}`,
    { perMessageDeflate: false }
  );
  let game = null;
  let players = [];
  function maybeAct() {
    if (!game) return;
    const step = Number(game.handStep);
    if (!BETTING_STEPS.has(step)) return;
    if (Number(game.move) !== Number(mySeat)) return;
    const me = (players || []).find((p) => Number(p.seat) === Number(mySeat));
    if (!me || String(me.status) !== '1') return;
    const toCall = Number(game.currentBet || 0) - Number(me.bet || 0);
    const action = toCall > 0 ? 'call' : 'check';
    try { ws.send(JSON.stringify({ t: C2S.ACTION, tableId: target.tableId, seat: mySeat, action })); } catch (_e) {}
  }
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: C2S.JOIN, tableId: target.tableId, seat: mySeat, lastSeq: 0, joinToken: claim.joinToken }));
    connected += 1;
  });
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === S2C.SNAPSHOT) {
      game = msg.state?.game; players = msg.state?.players || []; maybeAct();
    } else if (msg.t === S2C.DELTA) {
      const p = msg.payload || {};
      if (p.game) game = p.game;
      else if (game) {
        if (p.to != null) game.handStep = p.to;
        if (p.move != null) game.move = p.move;
        if (p.currentBet != null) game.currentBet = p.currentBet;
        if (p.pot != null) game.pot = p.pot;
        if (p.community != null) game.communityCards = p.community;
      }
      if (p.players) players = p.players;
      maybeAct();
    }
  });
  ws.on('close', () => { connected -= 1; });
  ws.on('error', () => { /* swallow */ });
  conns.push(ws);
  return true;
}

async function main() {
  console.log(JSON.stringify({ event: 'swarm_start', target: TARGET, ramp: RAMP_PER_SEC }));
  let idx = 0;
  let failures = 0;
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastReport) / 1000;
    lastReport = now;
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
    // 1-second tick between waves to stay under the gateway thundering-herd guard
    await new Promise((r) => setTimeout(r, 1000));
    if (failures > 50 && connected < idx * 0.1) {
      console.log(JSON.stringify({ event: 'swarm_aborting', failures, connected }));
      break;
    }
  }
  console.log(JSON.stringify({ event: 'swarm_ramp_complete', connected, spawned: idx }));
  // keep process alive
  setInterval(() => {}, 1 << 30);
}

process.on('SIGTERM', () => { for (const ws of conns) try { ws.close(); } catch {} process.exit(0); });
process.on('SIGINT',  () => { for (const ws of conns) try { ws.close(); } catch {} process.exit(0); });

main().catch((err) => { console.error(err); process.exit(1); });
