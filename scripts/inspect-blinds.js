#!/usr/bin/env node
const Redis = require('ioredis');
const r = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
(async () => {
  const keys = await r.keys('table:*:snapshot');
  for (const k of keys) {
    const tableId = k.replace('table:', '').replace(':snapshot', '');
    const raw = await r.get(k);
    if (!raw) continue;
    try {
      const d = JSON.parse(raw);
      const g = d.game;
      const flag = g.smallBlindSeat === g.bigBlindSeat ? '***DUP***' : '';
      console.log(tableId, 'gameNo', g.gameNo, 'step', g.handStep, 'D', g.dealerSeat, 'SB', g.smallBlindSeat, 'BB', g.bigBlindSeat, 'players', d.players.length, flag);
      if (flag) {
        for (const p of d.players) console.log('  ', p.seat, p.playerId, 'status', p.status);
      }
    } catch {}
  }
  await r.quit();
})();
