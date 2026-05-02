'use strict';

const {
  cardToInt,
  intToCard,
  cardsToInts,
  intsToCards,
  encodeTableState,
  decodeTableState,
} = require('../src/codec');

const { GAME_HAND, PLAYER_STATUS, createDeck } = require('@hijack/engine');

describe('codec — card encoding', () => {
  it('round-trips every card', () => {
    for (const card of createDeck()) {
      expect(intToCard(cardToInt(card))).toBe(card);
    }
  });

  it('rejects unknown cards', () => {
    expect(() => cardToInt('XX')).toThrow();
    expect(() => intToCard(999)).toThrow();
  });

  it('round-trips a deck via CSV ints', () => {
    const deck = createDeck();
    expect(intsToCards(cardsToInts(deck))).toEqual(deck);
  });

  it('handles empty deck', () => {
    expect(cardsToInts([])).toBe('');
    expect(intsToCards('')).toEqual([]);
  });
});

describe('codec — table state', () => {
  const sample = () => ({
    game: {
      id: 1, tableId: 1, gameNo: 1,
      handStep: GAME_HAND.PRE_FLOP_BETTING_ROUND,
      dealerSeat: 1, smallBlindSeat: 2, bigBlindSeat: 3,
      move: 4, pot: 6, currentBet: 2, lastRaiseSize: 2,
      smallBlind: 1, bigBlind: 2, maxSeats: 6,
      status: 'in_progress',
      deck: ['AH', '10D', '2C'],
      communityCards: ['KH', 'QD'],
      sidePots: [],
      winners: [],
    },
    players: [
      { id: 1, gameId: 1, tableId: 1, playerId: 1, guid: 'g1', username: 'A',
        seat: 1, stack: 99, bet: 1, totalBet: 1,
        status: PLAYER_STATUS.ACTIVE, action: '', cards: ['AH', 'KD'],
        handRank: '', winnings: 0 },
    ],
  });

  it('encodes to all-string hash and decodes back', () => {
    const s = sample();
    const enc = encodeTableState(s);
    for (const v of Object.values(enc)) {
      expect(typeof v).toBe('string');
    }
    const dec = decodeTableState(enc);
    expect(dec.game.handStep).toBe(GAME_HAND.PRE_FLOP_BETTING_ROUND);
    expect(dec.game.deck).toEqual(s.game.deck);
    expect(dec.game.communityCards).toEqual(s.game.communityCards);
    expect(dec.players[0].cards).toEqual(s.players[0].cards);
    expect(dec.players[0].stack).toBe(99);
  });

  it('decodes empty hash to null', () => {
    expect(decodeTableState({})).toBeNull();
    expect(decodeTableState(null)).toBeNull();
  });
});
