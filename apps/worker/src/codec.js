'use strict';

/**
 * Lean card encoding.
 *
 * The engine represents cards as strings like "AH", "10D", "2C" — five
 * characters max each. For hot state in Redis we encode each card as a
 * single integer 0..51 using `suit * 13 + rank`. Suits are H=0, D=1,
 * C=2, S=3 (matches packages/engine/src/cards.js SUITS order). Ranks
 * are 0='2' through 12='A'.
 *
 * A 52-card deck encoded as ints stored as a comma-joined string fits
 * in ~150 bytes; a single hole-card pair fits in <8. Compared with
 * JSON-encoded ["AH","10D",...] this is roughly a 5x reduction. With
 * 8 seats per table that means a hot state hash for one table is a
 * few KB instead of tens of KB — well under the < 50 KB budget set
 * by the phase doc.
 */

const SUITS = ['H', 'D', 'C', 'S'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const CARD_TO_INT = (() => {
  const out = Object.create(null);
  for (let s = 0; s < SUITS.length; s++) {
    for (let r = 0; r < RANKS.length; r++) {
      out[RANKS[r] + SUITS[s]] = s * 13 + r;
    }
  }
  return out;
})();

const INT_TO_CARD = (() => {
  const out = new Array(52);
  for (let s = 0; s < SUITS.length; s++) {
    for (let r = 0; r < RANKS.length; r++) {
      out[s * 13 + r] = RANKS[r] + SUITS[s];
    }
  }
  return out;
})();

function cardToInt(card) {
  const v = CARD_TO_INT[card];
  if (v === undefined) throw new Error(`unknown card: ${card}`);
  return v;
}

function intToCard(n) {
  const c = INT_TO_CARD[n];
  if (c === undefined) throw new Error(`bad card int: ${n}`);
  return c;
}

function cardsToInts(cards) {
  if (!cards || !cards.length) return '';
  return cards.map(cardToInt).join(',');
}

function intsToCards(s) {
  if (!s) return [];
  return s.split(',').map((n) => intToCard(parseInt(n, 10)));
}

/**
 * Serialize the engine's mutable game record into a flat string-map
 * suitable for `HSET table:{id} ...`. Cards / decks become int CSV;
 * scalars become strings. Players ride along as a single JSON blob
 * keyed `players` because they are small (<= 8) and varied; encoding
 * each field separately gains nothing on a per-table-hash basis.
 */
function encodeTableState(state) {
  const { game, players } = state;
  return {
    gameId: String(game.id),
    tableId: String(game.tableId),
    gameNo: String(game.gameNo),
    handStep: String(game.handStep),
    dealerSeat: String(game.dealerSeat || 0),
    smallBlindSeat: String(game.smallBlindSeat || 0),
    bigBlindSeat: String(game.bigBlindSeat || 0),
    move: String(game.move || 0),
    pot: String(game.pot || 0),
    currentBet: String(game.currentBet || 0),
    lastRaiseSize: String(game.lastRaiseSize || 0),
    smallBlind: String(game.smallBlind),
    bigBlind: String(game.bigBlind),
    maxSeats: String(game.maxSeats),
    status: String(game.status || 'in_progress'),
    deck: cardsToInts(game.deck || []),
    communityCards: cardsToInts(game.communityCards || []),
    sidePots: JSON.stringify(game.sidePots || []),
    winners: JSON.stringify(game.winners || []),
    players: JSON.stringify(players.map(encodePlayer)),
    seq: String(state.seq || 0),
  };
}

function encodePlayer(p) {
  return {
    id: p.id,
    gameId: p.gameId,
    tableId: p.tableId,
    playerId: p.playerId,
    guid: p.guid,
    username: p.username,
    seat: p.seat,
    stack: p.stack,
    bet: p.bet,
    totalBet: p.totalBet,
    status: p.status,
    action: p.action,
    cards: cardsToInts(p.cards || []),
    handRank: p.handRank,
    winnings: p.winnings,
  };
}

function decodeTableState(hash) {
  if (!hash || !Object.keys(hash).length) return null;
  const game = {
    id: parseIntOr(hash.gameId, 0),
    tableId: parseIntOr(hash.tableId, 0),
    gameNo: parseIntOr(hash.gameNo, 1),
    handStep: parseIntOr(hash.handStep, 0),
    dealerSeat: parseIntOr(hash.dealerSeat, 0),
    smallBlindSeat: parseIntOr(hash.smallBlindSeat, 0),
    bigBlindSeat: parseIntOr(hash.bigBlindSeat, 0),
    move: parseIntOr(hash.move, 0),
    pot: parseFloatOr(hash.pot, 0),
    currentBet: parseFloatOr(hash.currentBet, 0),
    lastRaiseSize: parseFloatOr(hash.lastRaiseSize, 0),
    smallBlind: parseFloatOr(hash.smallBlind, 1),
    bigBlind: parseFloatOr(hash.bigBlind, 2),
    maxSeats: parseIntOr(hash.maxSeats, 6),
    status: hash.status || 'in_progress',
    deck: intsToCards(hash.deck || ''),
    communityCards: intsToCards(hash.communityCards || ''),
    sidePots: JSON.parse(hash.sidePots || '[]'),
    winners: JSON.parse(hash.winners || '[]'),
  };
  const players = JSON.parse(hash.players || '[]').map(decodePlayer);
  const seq = parseIntOr(hash.seq, 0);
  return { game, players, seq };
}

function decodePlayer(p) {
  return {
    ...p,
    cards: typeof p.cards === 'string' ? intsToCards(p.cards) : p.cards || [],
  };
}

function parseIntOr(v, def) {
  if (v == null || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}
function parseFloatOr(v, def) {
  if (v == null || v === '') return def;
  const n = parseFloat(v);
  return Number.isNaN(n) ? def : n;
}

module.exports = {
  cardToInt,
  intToCard,
  cardsToInts,
  intsToCards,
  encodeTableState,
  decodeTableState,
};
