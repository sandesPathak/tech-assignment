'use strict';

/**
 * Hand progression steps. Each game hand advances through these stages sequentially.
 * The processor reads the current step and executes the corresponding logic.
 */
const GAME_HAND = {
  GAME_NOT_STARTED: '',
  GAME_PREP: 0,
  SETUP_DEALER: 1,
  SETUP_SMALL_BLIND: 2,
  SETUP_BIG_BLIND: 3,
  DEAL_CARDS: 4,
  PRE_FLOP_BETTING_ROUND: 5,
  DEAL_FLOP: 6,
  FLOP_BETTING_ROUND: 7,
  DEAL_TURN: 8,
  TURN_BETTING_ROUND: 9,
  DEAL_RIVER: 10,
  RIVER_BETTING_ROUND: 11,
  AFTER_RIVER_BETTING_ROUND: 12,
  FIND_WINNERS: 13,
  PAY_WINNERS: 14,
  RECORD_STATS_AND_NEW_HAND: 15,
  ADD_ONS_AND_CHARGING: 16,
};

/**
 * Player status codes. Stored as strings in the database.
 */
const PLAYER_STATUS = {
  ACTIVE: '1',
  SITTING_OUT: '2',
  LEAVING: '3',
  SHOW_CARDS: '4',
  POST_BLIND: '5',
  WAIT_FOR_BB: '6',
  FOR_CHARGING: '7',
  BUSTED: '8',
  EXIT_TABLE: '9',
  MUCK_CARDS: '10',
  FOLDED: '11',
  ALL_IN: '12',
};

/**
 * Player actions during a betting round.
 */
const ACTION = {
  CALL: 'call',
  CHECK: 'check',
  BET: 'bet',
  RAISE: 'raise',
  FOLD: 'fold',
  ALLIN: 'allin',
};

/**
 * Pre-action selections (auto-action on player's turn).
 */
const PRE_ACTION = {
  CALL_ANY: 'call_any',
  CHECK_OR_FOLD: 'check_or_fold',
  FOLD: 'fold',
  ALLIN: 'allin',
};

/**
 * Table types: cash game, sit-n-go, multi-table tournament.
 */
const TABLE_TYPE = {
  CASH_GAME: 's',
  SNG: 't',
  MTT: 'm',
};

/**
 * Transaction types for the ledger.
 */
const TRANSACTION_TYPE = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  BUY_IN: 'buy_in',
  CASH_OUT: 'cash_out',
  WINNINGS: 'winnings',
  CHARGE: 'charge',
};

/**
 * Game variants.
 */
const GAME = {
  TEXAS: 'texas',
  OMAHA: 'omaha',
};

/**
 * Broadcast delay tiers (ms).
 */
const BROADCAST_DELAY = {
  LOW: 3000,
  MED: 2000,
  HIGH: 1000,
};

module.exports = {
  GAME_HAND,
  PLAYER_STATUS,
  ACTION,
  PRE_ACTION,
  TABLE_TYPE,
  TRANSACTION_TYPE,
  GAME,
  BROADCAST_DELAY,
};
