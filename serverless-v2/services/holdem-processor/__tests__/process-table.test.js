'use strict';

// Mock database and event modules before importing process-table
jest.mock('../lib/table-fetcher', () => ({
  fetchTable: jest.fn(),
  saveGame: jest.fn(),
  savePlayers: jest.fn(),
}));
jest.mock('../lib/event-publisher', () => ({
  publishTableUpdate: jest.fn(),
}));

const {
  gamePrep,
  setupDealer,
  setupSmallBlind,
  setupBigBlind,
  dealCards,
  bettingRound,
  dealFlop,
  dealTurn,
  dealRiver,
  findHandWinners,
  payWinners,
  recordStatsAndNewHand,
} = require('../lib/process-table');
const { GAME_HAND, PLAYER_STATUS, ACTION } = require('../shared/games/common/constants');

/**
 * Drive a betting round to completion by feeding the engine the
 * acting seat's check-or-call action one tick at a time. The
 * `bettingRound` API requires an explicit `playerAction` per call;
 * passing nothing returns `awaiting: true`. This helper hides the
 * polling loop so the full-hand-flow test below stays readable.
 */
function runBettingRound(state, round, max = 12) {
  const { bettingRound: br } = require('../lib/process-table');
  const startStep = state.game.handStep;
  for (let i = 0; i < max; i++) {
    // Has the round already advanced? (engine collapses last action
    // and street-end into one tick).
    if (state.game.handStep !== startStep) return state;
    // Probe with no action — if the round has already ended (e.g. a
    // street with all-ins) we stop immediately.
    const probe = br(state.game, state.players, round);
    if (!probe.awaiting) return probe;
    state = probe;
    const seat = state.game.move;
    const player = state.players.find((p) => p.seat === seat);
    const owed = state.game.currentBet - (player.bet || 0);
    const action = owed > 0 ? ACTION.CALL : ACTION.CHECK;
    const amount = owed > 0 ? state.game.currentBet : 0;
    state = br(state.game, state.players, round, { seat, action, amount });
  }
  throw new Error(`betting round ${round} did not terminate`);
}

/**
 * Helper: create a minimal game state for testing.
 */
function createTestGame(overrides = {}) {
  return {
    id: 1,
    tableId: 1,
    gameNo: 1,
    handStep: GAME_HAND.GAME_PREP,
    dealerSeat: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 0,
    communityCards: [],
    pot: 0,
    currentBet: 0,
    sidePots: [],
    move: 0,
    status: 'in_progress',
    smallBlind: 1,
    bigBlind: 2,
    maxSeats: 6,
    deck: [],
    winners: [],
    ...overrides,
  };
}

/**
 * Helper: create test players.
 */
function createTestPlayers(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    gameId: 1,
    tableId: 1,
    playerId: i + 1,
    guid: `p${i + 1}-uuid`,
    username: `Player${i + 1}`,
    seat: i + 1,
    stack: 100,
    bet: 0,
    totalBet: 0,
    status: PLAYER_STATUS.ACTIVE,
    action: '',
    cards: [],
    handRank: '',
    winnings: 0,
  }));
}

describe('Process Table — Hand State Machine', () => {
  describe('gamePrep', () => {
    it('should reset player states and create a shuffled deck', () => {
      const game = createTestGame();
      const players = createTestPlayers();

      const result = gamePrep(game, players);

      expect(result.game.handStep).toBe(GAME_HAND.SETUP_DEALER);
      expect(result.game.deck).toHaveLength(52);
      expect(result.game.pot).toBe(0);
      expect(result.game.communityCards).toEqual([]);
      result.players.forEach((p) => {
        expect(p.bet).toBe(0);
        expect(p.action).toBe('');
        expect(p.cards).toEqual([]);
      });
    });
  });

  describe('setupDealer', () => {
    it('should assign dealer and advance to small blind', () => {
      const game = createTestGame({ handStep: GAME_HAND.SETUP_DEALER, dealerSeat: 0 });
      const players = createTestPlayers();

      const result = setupDealer(game, players);

      expect(result.game.dealerSeat).toBeGreaterThan(0);
      expect(result.game.handStep).toBe(GAME_HAND.SETUP_SMALL_BLIND);
    });

    it('should skip hand if fewer than 2 players', () => {
      const game = createTestGame({ handStep: GAME_HAND.SETUP_DEALER });
      const players = createTestPlayers(1);

      const result = setupDealer(game, players);

      expect(result.game.handStep).toBe(GAME_HAND.RECORD_STATS_AND_NEW_HAND);
    });
  });

  describe('setupSmallBlind', () => {
    it('should deduct small blind from the correct player', () => {
      const game = createTestGame({
        handStep: GAME_HAND.SETUP_SMALL_BLIND,
        dealerSeat: 1,
        maxSeats: 6,
      });
      const players = createTestPlayers();

      const result = setupSmallBlind(game, players);

      expect(result.game.handStep).toBe(GAME_HAND.SETUP_BIG_BLIND);
      // At least one player should have posted the small blind
      const posted = result.players.filter((p) => p.bet > 0);
      expect(posted).toHaveLength(1);
      expect(posted[0].bet).toBe(1);
      expect(posted[0].stack).toBe(99);
    });
  });

  describe('setupBigBlind', () => {
    it('should deduct big blind and set current bet', () => {
      const game = createTestGame({
        handStep: GAME_HAND.SETUP_BIG_BLIND,
        dealerSeat: 1,
        smallBlindSeat: 2,
        maxSeats: 6,
      });
      const players = createTestPlayers();
      // SB already posted
      players[1].bet = 1;
      players[1].totalBet = 1;
      players[1].stack = 99;

      const result = setupBigBlind(game, players);

      expect(result.game.handStep).toBe(GAME_HAND.DEAL_CARDS);
      expect(result.game.currentBet).toBe(2);
      const bbPlayer = result.players.find((p) => p.seat === result.game.bigBlindSeat);
      expect(bbPlayer.bet).toBe(2);
    });
  });

  describe('dealCards', () => {
    it('should deal 2 cards to each active player', () => {
      const game = createTestGame({
        handStep: GAME_HAND.DEAL_CARDS,
        bigBlindSeat: 3,
        maxSeats: 6,
      });
      game.deck = require('../shared/games/common/cards').shuffle(
        require('../shared/games/common/cards').createDeck()
      );
      const players = createTestPlayers();

      const result = dealCards(game, players);

      expect(result.game.handStep).toBe(GAME_HAND.PRE_FLOP_BETTING_ROUND);
      result.players.forEach((p) => {
        expect(p.cards).toHaveLength(2);
      });
      // 52 - 6 cards dealt = 46
      expect(result.game.deck).toHaveLength(46);
    });
  });

  describe('dealFlop', () => {
    it('should deal 3 community cards', () => {
      const game = createTestGame({
        handStep: GAME_HAND.DEAL_FLOP,
        dealerSeat: 1,
        maxSeats: 6,
      });
      game.deck = require('../shared/games/common/cards').shuffle(
        require('../shared/games/common/cards').createDeck()
      );
      const players = createTestPlayers();

      const result = dealFlop(game, players);

      expect(result.game.communityCards).toHaveLength(3);
      expect(result.game.handStep).toBe(GAME_HAND.FLOP_BETTING_ROUND);
    });
  });

  describe('dealTurn', () => {
    it('should add 1 community card', () => {
      const game = createTestGame({
        handStep: GAME_HAND.DEAL_TURN,
        communityCards: ['AH', 'KD', 'QS'],
        dealerSeat: 1,
        maxSeats: 6,
      });
      game.deck = require('../shared/games/common/cards').shuffle(
        require('../shared/games/common/cards').createDeck()
      );
      const players = createTestPlayers();

      const result = dealTurn(game, players);

      expect(result.game.communityCards).toHaveLength(4);
      expect(result.game.handStep).toBe(GAME_HAND.TURN_BETTING_ROUND);
    });
  });

  describe('dealRiver', () => {
    it('should add 1 community card', () => {
      const game = createTestGame({
        handStep: GAME_HAND.DEAL_RIVER,
        communityCards: ['AH', 'KD', 'QS', 'JC'],
        dealerSeat: 1,
        maxSeats: 6,
      });
      game.deck = require('../shared/games/common/cards').shuffle(
        require('../shared/games/common/cards').createDeck()
      );
      const players = createTestPlayers();

      const result = dealRiver(game, players);

      expect(result.game.communityCards).toHaveLength(5);
      expect(result.game.handStep).toBe(GAME_HAND.RIVER_BETTING_ROUND);
    });
  });

  describe('findHandWinners', () => {
    it('should find winner when only one player remains', () => {
      const game = createTestGame({
        handStep: GAME_HAND.FIND_WINNERS,
        communityCards: ['AH', 'KD', 'QS', 'JC', '10H'],
      });
      const players = createTestPlayers();
      players[0].status = PLAYER_STATUS.FOLDED;
      players[1].status = PLAYER_STATUS.FOLDED;
      players[2].cards = ['9D', '8D'];

      const result = findHandWinners(game, players);

      expect(result.game.winners).toHaveLength(1);
      expect(result.game.winners[0].seat).toBe(3);
      expect(result.game.handStep).toBe(GAME_HAND.PAY_WINNERS);
    });

    it('should evaluate hands and find best hand', () => {
      const game = createTestGame({
        handStep: GAME_HAND.FIND_WINNERS,
        communityCards: ['2H', '7D', 'QS', 'JC', '3H'],
      });
      const players = createTestPlayers(2);
      players[0].cards = ['AH', 'AD']; // Pair of Aces
      players[1].cards = ['KH', '9D']; // King high

      const result = findHandWinners(game, players);

      expect(result.game.winners).toHaveLength(1);
      expect(result.game.winners[0].seat).toBe(1); // Player 1 with pair of Aces
    });
  });

  describe('payWinners', () => {
    it('should pay the pot to the winner', () => {
      const game = createTestGame({
        handStep: GAME_HAND.PAY_WINNERS,
        pot: 50,
        winners: [{ seat: 1, playerId: 1 }],
      });
      const players = createTestPlayers();

      const result = payWinners(game, players);

      expect(result.players[0].stack).toBe(150); // 100 + 50 pot
      expect(result.players[0].winnings).toBe(50);
      expect(result.game.pot).toBe(0);
      expect(result.game.handStep).toBe(GAME_HAND.RECORD_STATS_AND_NEW_HAND);
    });

    it('should split pot between multiple winners', () => {
      const game = createTestGame({
        handStep: GAME_HAND.PAY_WINNERS,
        pot: 60,
        winners: [{ seat: 1, playerId: 1 }, { seat: 2, playerId: 2 }],
      });
      const players = createTestPlayers();

      const result = payWinners(game, players);

      expect(result.players[0].winnings).toBe(30);
      expect(result.players[1].winnings).toBe(30);
    });
  });

  describe('Full hand flow', () => {
    it('should process a complete hand from prep to completion', () => {
      const game = createTestGame();
      const players = createTestPlayers(3);

      // Step through the entire hand
      let state = gamePrep(game, players);
      expect(state.game.handStep).toBe(GAME_HAND.SETUP_DEALER);

      state = setupDealer(state.game, state.players);
      expect(state.game.handStep).toBe(GAME_HAND.SETUP_SMALL_BLIND);

      state = setupSmallBlind(state.game, state.players);
      expect(state.game.handStep).toBe(GAME_HAND.SETUP_BIG_BLIND);

      state = setupBigBlind(state.game, state.players);
      expect(state.game.handStep).toBe(GAME_HAND.DEAL_CARDS);

      state = dealCards(state.game, state.players);
      expect(state.game.handStep).toBe(GAME_HAND.PRE_FLOP_BETTING_ROUND);
      state.players.forEach((p) => expect(p.cards).toHaveLength(2));

      state = runBettingRound(state, 'preflop');
      expect(state.game.handStep).toBe(GAME_HAND.DEAL_FLOP);

      state = dealFlop(state.game, state.players);
      expect(state.game.communityCards).toHaveLength(3);

      state = runBettingRound(state, 'flop');
      expect(state.game.handStep).toBe(GAME_HAND.DEAL_TURN);

      state = dealTurn(state.game, state.players);
      expect(state.game.communityCards).toHaveLength(4);

      state = runBettingRound(state, 'turn');
      expect(state.game.handStep).toBe(GAME_HAND.DEAL_RIVER);

      state = dealRiver(state.game, state.players);
      expect(state.game.communityCards).toHaveLength(5);

      state = runBettingRound(state, 'river');
      expect(state.game.handStep).toBe(GAME_HAND.AFTER_RIVER_BETTING_ROUND);

      // After river -> find winners
      state.game.handStep = GAME_HAND.FIND_WINNERS;
      state = findHandWinners(state.game, state.players);
      expect(state.game.winners.length).toBeGreaterThanOrEqual(1);

      state = payWinners(state.game, state.players);
      expect(state.game.handStep).toBe(GAME_HAND.RECORD_STATS_AND_NEW_HAND);

      state = recordStatsAndNewHand(state.game, state.players);
      expect(state.game.gameNo).toBe(1); // gameNo stays; new game gets next number
      expect(state.game.status).toBe('completed');
    });
  });
});
