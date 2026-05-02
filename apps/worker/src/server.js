'use strict';

const http = require('http');
const { processTable } = require('./tick');

/**
 * Tiny HTTP server — only `/process` and `/health`. We deliberately
 * avoid Express to keep cold-start memory low (this thing runs on a
 * Fly 256MB shared-cpu-1x).
 *
 *   POST /process { tableId, seat?, action?, amount? }
 *   GET  /health
 *   GET  /metrics?tableId=N
 */
function createServer({ stateStore, publisher }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return json(res, 200, { service: 'hijack-worker', status: 'ok' });
      }

      if (req.method === 'GET' && req.url.startsWith('/metrics')) {
        const url = new URL(req.url, 'http://x');
        const tableId = url.searchParams.get('tableId');
        if (!tableId) return json(res, 400, { error: 'tableId required' });
        const bytes = await stateStore.measureFootprint(tableId);
        const tail = await stateStore.eventTailLength(tableId);
        return json(res, 200, { tableId, bytes, eventTail: tail });
      }

      if (req.method === 'POST' && req.url === '/leave') {
        const body = await readJson(req);
        const { tableId, playerId } = body;
        if (!tableId || !playerId) return json(res, 400, { error: 'tableId, playerId required' });
        const state = await stateStore.loadTable(tableId);
        if (!state) return json(res, 404, { error: 'table_not_found' });
        const remaining = (state.players || []).filter((p) => String(p.playerId) !== String(playerId));
        await stateStore.redis.hset(`table:${tableId}`, 'players', JSON.stringify(
          remaining.map((p) => ({
            ...p,
            cards: Array.isArray(p.cards)
              ? p.cards.map((c) => {
                  const SUITS = ['H','D','C','S'];
                  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
                  const r = RANKS.indexOf(String(c).slice(0, -1));
                  const s = SUITS.indexOf(String(c).slice(-1));
                  return r >= 0 && s >= 0 ? s * 13 + r : null;
                }).filter((n) => n != null).join(',')
              : (p.cards || ''),
          }))
        ));
        // also free their seat reservation
        const seat = (state.players || []).find((p) => String(p.playerId) === String(playerId))?.seat;
        if (seat != null) {
          await stateStore.redis.hdel(`table:${tableId}:seats`, String(seat));
        }
        return json(res, 200, { ok: true, removed: state.players.length - remaining.length });
      }

      if (req.method === 'POST' && req.url === '/sit') {
        const body = await readJson(req);
        const { tableId, seat, playerId, username, stack } = body;
        if (!tableId || seat == null || !playerId) {
          return json(res, 400, { error: 'tableId, seat, playerId required' });
        }
        const state = await stateStore.loadTable(tableId);
        if (!state) return json(res, 404, { error: 'table_not_found' });
        const players = Array.isArray(state.players) ? [...state.players] : [];

        // Idempotent: if this playerId is ALREADY seated (anywhere), do
        // nothing. This neutralizes React StrictMode double-mount and
        // bot reconnects from creating duplicate seats.
        const alreadySeated = players.find((p) => String(p.playerId) === String(playerId));
        if (alreadySeated) {
          return json(res, 200, { ok: true, seat: alreadySeated.seat, idempotent: true });
        }

        // If a different player already holds this seat: only allow
        // replacement if the seat-claim has already expired upstream
        // (we trust the gateway here) AND the occupant isn't holding
        // cards mid-hand. Otherwise refuse rather than clobber.
        const occupantIdx = players.findIndex((p) => Number(p.seat) === Number(seat));
        if (occupantIdx >= 0) {
          const occ = players[occupantIdx];
          const hasCards = Array.isArray(occ.cards) ? occ.cards.length > 0 : Boolean(occ.cards);
          if (hasCards) {
            return json(res, 409, { error: 'seat_in_hand', occupant: occ.playerId });
          }
          // safe to evict (between hands, no cards held)
          players.splice(occupantIdx, 1);
        }

        const buyIn = Number(stack) > 0 ? Number(stack)
          : Number(state.game?.bigBlind || 0) * 100 || 200;
        players.push({
          id: `p_${seat}_${Date.now()}`,
          gameId: state.game?.id,
          tableId: String(tableId),
          playerId: String(playerId),
          guid: String(playerId),
          username: username || String(playerId),
          seat: Number(seat),
          stack: buyIn,
          bet: 0,
          totalBet: 0,
          status: '1',
          action: null,
          cards: [],
          handRank: null,
          winnings: 0,
        });

        // Targeted write: only update the `players` field so we don't
        // race the engine's applyTick on game/deck/cards.
        await stateStore.redis.hset(`table:${tableId}`, 'players', JSON.stringify(
          players.map((p) => ({
            ...p,
            // Re-encode cards as int CSV to match codec.encodePlayer.
            cards: Array.isArray(p.cards)
              ? p.cards.map((c) => {
                  const SUITS = ['H','D','C','S'];
                  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
                  const r = RANKS.indexOf(String(c).slice(0, -1));
                  const s = SUITS.indexOf(String(c).slice(-1));
                  return r >= 0 && s >= 0 ? s * 13 + r : null;
                }).filter((n) => n != null).join(',')
              : (p.cards || ''),
          }))
        ));
        return json(res, 200, { ok: true, seat: Number(seat), seated: players.length });
      }

      if (req.method === 'POST' && req.url === '/process') {
        const body = await readJson(req);
        const tableId = body.tableId;
        if (!tableId) return json(res, 400, { error: 'tableId required' });
        const playerAction = (body.seat != null && body.action)
          ? { seat: body.seat, action: body.action, amount: body.amount || 0 }
          : undefined;
        const result = await processTable(stateStore, tableId, playerAction, publisher);
        const code = result.status === 'not_found' ? 404
          : result.status === 'error' ? 400
          : 200;
        return json(res, code, result);
      }

      json(res, 404, { error: 'not_found' });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

module.exports = { createServer };
