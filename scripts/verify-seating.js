#!/usr/bin/env node
// Independently verify dealer / SB / BB rotation + visual layout.
const Redis = require('ioredis');

const ORDERED_POSITIONS = [
  '0:bottom-center (HERO)',
  '1:bottom-right',
  '2:right',
  '3:top-right',
  '4:top-left',
  '5:left',
];

(async () => {
  const r = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const keys = await r.keys('table:*:snapshot');
  const active = [];
  for (const k of keys) {
    const tableId = k.replace('table:', '').replace(':snapshot', '');
    const raw = await r.get(k);
    if (!raw) continue;
    try {
      const d = JSON.parse(raw);
      if (!d.players || d.players.length < 3) continue;
      active.push({ tableId, ...d });
    } catch {}
  }
  if (!active.length) { console.log('no active tables'); process.exit(1); }

  for (const t of active.slice(0, 4)) {
    const g = t.game;
    console.log('\n=== table', t.tableId, '— gameNo', g.gameNo, 'step', g.handStep, '===');
    const seats = t.players.map((p) => p.seat).sort((a, b) => a - b);
    console.log('  seated', seats.join(','));
    console.log('  D=', g.dealerSeat, 'SB=', g.smallBlindSeat, 'BB=', g.bigBlindSeat);

    // Engine correctness checks
    const distinct = new Set([g.dealerSeat, g.smallBlindSeat, g.bigBlindSeat]).size === 3;
    const dealerOK = seats.includes(g.dealerSeat);
    const sbOK = seats.includes(g.smallBlindSeat);
    const bbOK = seats.includes(g.bigBlindSeat);
    console.log('  ✓ engine: D/SB/BB distinct=', distinct, 'all-occupied=', dealerOK && sbOK && bbOK);

    // Clockwise check: SB should be next-active-seat AFTER D, BB next AFTER SB.
    function nextActive(from) {
      const max = g.maxSeats || 6;
      for (let i = 1; i <= max; i += 1) {
        const cand = ((from - 1 + i) % max) + 1;
        if (seats.includes(cand)) return cand;
      }
      return -1;
    }
    const expectedSB = nextActive(g.dealerSeat);
    const expectedBB = nextActive(expectedSB);
    const cwOK = expectedSB === g.smallBlindSeat && expectedBB === g.bigBlindSeat;
    console.log('  ✓ clockwise: expected D→', expectedSB, '→', expectedBB, '— matches=', cwOK);

    // Visual rotation simulation — pick each player, compute their visual position
    console.log('  visual layout if HERO=seatX:');
    for (const heroSeat of seats) {
      const max = g.maxSeats || 6;
      const slots = [];
      for (let i = 0; i < 6; i += 1) {
        const s = ((heroSeat - 1 + i) % max) + 1;
        const occ = seats.includes(s);
        let label = `seat ${s}${occ ? '' : '(empty)'}`;
        if (s === g.dealerSeat) label += ' D';
        if (s === g.smallBlindSeat) label += ' SB';
        if (s === g.bigBlindSeat) label += ' BB';
        slots.push(`${ORDERED_POSITIONS[i]}=${label}`);
      }
      console.log(`    hero=${heroSeat}: ` + slots.join(' | '));
    }
  }
  await r.quit();
})();
