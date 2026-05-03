export interface GameState {
  handStep: number;
  stepName: string;
  gameNo: number;
  pot: number;
  communityCards: string[];
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  move: number;
  currentBet: number;
  status: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  tableName: string;
  lastRaiseSize: number;
  winners: { seat: number; playerId: number | string }[];
}

export interface Player {
  playerId: number | string;
  username: string;
  seat: number;
  stack: number;
  bet: number;
  totalBet: number;
  status: string;
  action: string;
  cards: string[];
  handRank: string;
  winnings: number;
}

export interface TableState {
  game: GameState;
  players: Player[];
}

export interface ProcessResult {
  success: boolean;
  result: {
    status: string;
    tableId: number;
    step: number;
    stepName: string;
  };
}

export type CardSuit = 'H' | 'D' | 'C' | 'S';

export const SUIT_SYMBOLS: Record<CardSuit, string> = {
  H: '\u2665',
  D: '\u2666',
  C: '\u2663',
  S: '\u2660',
};

export const SUIT_COLORS: Record<CardSuit, string> = {
  H: '#e53935',
  D: '#e53935',
  C: '#212121',
  S: '#212121',
};

export const PHASE_LABELS: Record<string, string> = {
  GAME_PREP: 'Preparing Hand',
  SETUP_DEALER: 'Setting Dealer',
  SETUP_SMALL_BLIND: 'Posting Small Blind',
  SETUP_BIG_BLIND: 'Posting Big Blind',
  DEAL_CARDS: 'Dealing Cards',
  PRE_FLOP_BETTING_ROUND: 'Pre-Flop Betting',
  DEAL_FLOP: 'Dealing Flop',
  FLOP_BETTING_ROUND: 'Flop Betting',
  DEAL_TURN: 'Dealing Turn',
  TURN_BETTING_ROUND: 'Turn Betting',
  DEAL_RIVER: 'Dealing River',
  RIVER_BETTING_ROUND: 'River Betting',
  AFTER_RIVER_BETTING_ROUND: 'Showdown',
  FIND_WINNERS: 'Finding Winners',
  PAY_WINNERS: 'Paying Winners',
  RECORD_STATS_AND_NEW_HAND: 'Hand Complete',
};

export const SHOWDOWN_STEPS = [
  'AFTER_RIVER_BETTING_ROUND',
  'FIND_WINNERS',
  'PAY_WINNERS',
  'RECORD_STATS_AND_NEW_HAND',
];

export function parseCard(card: string): { rank: string; suit: CardSuit } {
  return {
    rank: card.slice(0, -1),
    suit: card.slice(-1) as CardSuit,
  };
}
