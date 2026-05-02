'use strict';

const { Hand } = require('pokersolver');

const SUITS = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/**
 * Build a standard 52-card deck. Cards are strings like "AH", "10D", "2C".
 */
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle — returns a new shuffled array.
 */
function shuffle(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Deal `count` cards from the top of the deck (mutates deck).
 */
function deal(deck, count) {
  return deck.splice(0, count);
}

/**
 * Convert our card format ("AH") to pokersolver format ("Ah").
 */
function toPokersolver(card) {
  const suit = card.slice(-1).toLowerCase();
  const rank = card.slice(0, -1);
  return rank + suit;
}

/**
 * Evaluate a hand using pokersolver. Returns { descr, rank, cards }.
 * `cards` is an array of 5-7 cards in our format (e.g. ["AH", "KD", ...]).
 */
function evaluateHand(cards) {
  const converted = cards.map(toPokersolver);
  const solved = Hand.solve(converted);
  return {
    descr: solved.descr,
    rank: solved.rank,
    name: solved.name,
    cards: solved.cards.map((c) => c.toString()),
  };
}

/**
 * Compare multiple hands. Each entry: { playerId, cards: [...] }.
 * Returns array of winners (may be multiple for split pots).
 */
function findWinners(hands) {
  if (!hands.length) return [];

  const solved = hands.map((h) => ({
    ...h,
    solved: Hand.solve(h.cards.map(toPokersolver)),
  }));

  const winners = Hand.winners(solved.map((s) => s.solved));
  const winnerSet = new Set(winners);

  return solved
    .filter((s) => winnerSet.has(s.solved))
    .map((s) => ({
      playerId: s.playerId,
      seat: s.seat,
      descr: s.solved.descr,
      rank: s.solved.rank,
      name: s.solved.name,
    }));
}

/**
 * Get the best 5-card hand from hole cards + community cards.
 */
function getBestHand(holeCards, communityCards) {
  const allCards = [...holeCards, ...communityCards];
  return evaluateHand(allCards);
}

module.exports = {
  SUITS,
  RANKS,
  createDeck,
  shuffle,
  deal,
  evaluateHand,
  findWinners,
  getBestHand,
  toPokersolver,
};
