#!/usr/bin/env node
'use strict';
// End-to-end probe: pretend to be the streaks-frontend hero. Hit the
// lobby HTTP, claim a seat, open a WS, and print what the table sends
// us for ~10s.

const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:3002';
const WS = 'ws://127.0.0.1:3002';

(async () => {
  const lobby = await fetch(`${HTTP}/lobby/1-2`).then((r) => r.json());
  const open = (lobby.tables || []).find((t) => t.openSeats > 0);
  if (!open) { console.log('NO OPEN TABLE'); process.exit(1); }
  console.log('PICKED', open.tableId, 'maxSeats=', open.maxSeats, 'open=', open.openSeats);

  let claim = null;
  let mySeat = null;
  for (let s = 1; s <= open.maxSeats; s += 1) {
    const r = await fetch(`${HTTP}/seat-claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stake: '1-2', tableId: open.tableId, seat: s, userId: 'verify_hero' }),
    });
    const j = await r.json();
    if (r.ok) { claim = j; mySeat = s; break; }
  }
  if (!claim) { console.log('NO SEAT CLAIMABLE'); process.exit(1); }
  console.log('CLAIMED seat=', mySeat);

  const url = `${WS}/table/${encodeURIComponent(open.tableId)}?token=${encodeURIComponent(claim.joinToken)}`;
  const ws = new WebSocket(url);
  let snapshotCount = 0;
  let deltaCount = 0;
  let firstHand = null;
  let lastHand = null;
  let sawCommunity = false;
  let sawHole = false;

  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'c2s.join', tableId: open.tableId, seat: mySeat, lastSeq: 0, joinToken: claim.joinToken }));
    console.log('WS OPEN, sent c2s.join');
  });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 's2c.snapshot') {
      snapshotCount += 1;
      const g = m.state?.game || {};
      const ps = m.state?.players || [];
      const me = ps.find((p) => Number(p.seat) === Number(mySeat));
      console.log('SNAPSHOT seq=', m.seq, 'gameNo=', g.gameNo, 'step=', g.handStep, 'players=', ps.length, 'myCards=', me?.cards || '[]');
    } else if (m.t === 's2c.delta') {
      deltaCount += 1;
      const p = m.payload || {};
      const g = p.game;
      const ps = p.players;
      if (g) {
        firstHand = firstHand ?? g.gameNo;
        lastHand = g.gameNo;
        if (Array.isArray(g.communityCards) && g.communityCards.length) sawCommunity = true;
      }
      if (Array.isArray(ps)) {
        const me = ps.find((x) => Number(x.seat) === Number(mySeat));
        if (me && Array.isArray(me.cards) && me.cards.length === 2) sawHole = true;
      }
      if (deltaCount % 30 === 0) {
        console.log('DELTA #' + deltaCount, 'step=', p.to, 'pot=', p.pot, 'community=', (p.community || []).length, 'gameNo=', g?.gameNo);
      }
    } else if (m.t === 's2c.error') {
      console.log('ERROR', m.code, m.message);
    }
  });

  async function cleanup() {
    try { ws.close(); } catch {}
    try {
      await fetch('http://127.0.0.1:3001/leave', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: open.tableId, playerId: 'verify_hero' }),
      });
    } catch {}
  }
  setTimeout(async () => {
    console.log('---SUMMARY---');
    console.log('snapshots=', snapshotCount, 'deltas=', deltaCount);
    console.log('firstHand=', firstHand, 'lastHand=', lastHand, 'handsPlayed≈', (lastHand || 0) - (firstHand || 0));
    console.log('sawCommunityCards=', sawCommunity);
    console.log('sawMyHoleCards=', sawHole);
    await cleanup();
    process.exit(0);
  }, 10000);
  process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
})();
