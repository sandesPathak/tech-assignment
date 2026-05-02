#!/usr/bin/env node
'use strict';

/**
 * seat-bots.js — local-dev convenience launcher.
 *
 * The default bot runner spectates. For an actual hand to start we need
 * seated players. This script:
 *   1. Lists tables for `--stake` (default `1-2`) at the gateway.
 *   2. Calls POST /seat-claim with a fake userId for each bot, claiming
 *      successive seats on the first table with openSeats > 0.
 *   3. Opens a WS using the issued joinToken, sends c2s.join, then drives
 *      a minimal "auto-call/check" strategy so the table keeps running.
 *
 * Usage:
 *   GATEWAY_JWT_SECRET=test-secret-do-not-use-in-prod \
 *   node apps/botswarm/src/seat-bots.js --bots=4 --stake=1-2
 */

const WebSocket = require('ws');
const { C2S, S2C } = require('@hijack/protocol/messages');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function getOpenTable(http, stake) {
  // Retry a few seconds — matchmaker may not have spawned yet on cold start.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const res = await fetch(`${http}/lobby/${encodeURIComponent(stake)}`);
      if (res.ok) {
        const body = await res.json();
        const tables = body.tables || [];
        const open = tables.find((t) => t.openSeats > 0);
        if (open) {
          return { tableId: open.tableId, openSeats: open.openSeats, maxSeats: open.maxSeats };
        }
      }
    } catch (_e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no open table at stake=${stake} after retries`);
}

async function claimSeat(http, { stake, tableId, seat, userId }) {
  const res = await fetch(`${http}/seat-claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stake, tableId, seat, userId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`seat-claim ${res.status} ${body.error || ''}`);
  }
  return body; // { joinToken, reservationToken, ... }
}

function startBot({ wsUrl, joinToken, tableId, seat, botId }) {
  const url = `${wsUrl}/table/${encodeURIComponent(tableId)}?token=${encodeURIComponent(joinToken)}`;
  const ws = new WebSocket(url, { perMessageDeflate: false });
  let mySeat = seat;
  let game = null;
  let players = [];

  // Steps 5/7/9/11 are PRE_FLOP / FLOP / TURN / RIVER betting rounds.
  const BETTING_STEPS = new Set([5, 7, 9, 11]);
  function maybeAct() {
    if (!game) return;
    const step = Number(game.handStep);
    if (!BETTING_STEPS.has(step)) return;
    const acting = Number(game.move);
    if (acting !== Number(mySeat)) return;
    const me = (players || []).find((p) => Number(p.seat) === Number(mySeat));
    if (!me || String(me.status) !== '1') return;
    const toCall = Number(game.currentBet || 0) - Number(me.bet || 0);
    const action = toCall > 0 ? 'call' : 'check';
    try {
      ws.send(JSON.stringify({ t: C2S.ACTION, tableId, seat: mySeat, action }));
    } catch (_e) {}
  }

  ws.on('open', () => {
    ws.send(JSON.stringify({ t: C2S.JOIN, tableId, seat: mySeat, lastSeq: 0, joinToken }));
    console.log(JSON.stringify({ event: 'bot_open', botId, tableId, seat: mySeat }));
  });
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === S2C.SNAPSHOT) {
      game = msg.state?.game;
      players = msg.state?.players || [];
      maybeAct();
    } else if (msg.t === S2C.DELTA) {
      const p = msg.payload || {};
      if (p.game) game = p.game;
      else if (game) {
        // Merge legacy thin delta fields into the existing game.
        if (p.to != null) game.handStep = p.to;
        if (p.move != null) game.move = p.move;
        if (p.pot != null) game.pot = p.pot;
        if (p.currentBet != null) game.currentBet = p.currentBet;
        if (p.community != null) game.communityCards = p.community;
      }
      if (p.players) players = p.players;
      maybeAct();
    }
  });
  ws.on('error', (err) => console.log(JSON.stringify({ event: 'bot_err', botId, err: err.message })));
  ws.on('close', (code) => console.log(JSON.stringify({ event: 'bot_close', botId, code })));
  return ws;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const http = args.http || process.env.GATEWAY_HTTP_URL || 'http://127.0.0.1:3002';
  const wsUrl = args.gateway || process.env.HIJACK_GATEWAY_URL || 'ws://127.0.0.1:3002';
  const stake = args.stake || '1-2';
  const bots = Number(args.bots || 4);
  const idPrefix = args.idPrefix || 'seatbot';

  console.log(JSON.stringify({ event: 'seat_bots_start', http, wsUrl, stake, bots }));

  const table = await getOpenTable(http, stake);
  console.log(JSON.stringify({ event: 'picked_table', ...table }));

  const conns = [];
  for (let i = 0; i < bots; i += 1) {
    const seat = i + 1; // seats are 1-indexed
    if (seat > table.maxSeats) break;
    const botId = `${idPrefix}-${String(i).padStart(3, '0')}`;
    const userId = botId;
    try {
      const claim = await claimSeat(http, { stake, tableId: table.tableId, seat, userId });
      const ws = startBot({ wsUrl, joinToken: claim.joinToken, tableId: table.tableId, seat, botId });
      conns.push(ws);
    } catch (err) {
      console.log(JSON.stringify({ event: 'claim_failed', botId, seat, err: err.message }));
    }
    // small stagger to avoid race on initial deal
    await new Promise((r) => setTimeout(r, 150));
  }

  process.on('SIGINT', () => {
    for (const ws of conns) { try { ws.close(); } catch {} }
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
