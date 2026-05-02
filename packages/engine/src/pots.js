'use strict';

const { PLAYER_STATUS } = require('./constants');
const { toMoney } = require('./money');

/**
 * Calculate main pot and side pots from player bets.
 *
 * Side pots occur when a player goes all-in for less than the current bet.
 * Each pot has an amount and list of eligible player seats.
 *
 * @param {Array} players - Players with { seat, totalBet, status }
 * @returns {Array} pots - [{ amount, eligible: [seat1, seat2, ...] }]
 */
function calculatePots(players) {
  // Only players who contributed (totalBet > 0) are considered
  const contributors = players
    .filter((p) => p.totalBet > 0)
    .sort((a, b) => a.totalBet - b.totalBet);

  if (contributors.length === 0) return [];

  const pots = [];
  let previousLevel = 0;

  // Get unique bet levels from all-in players + the max bet
  const betLevels = [...new Set(contributors.map((p) => p.totalBet))].sort(
    (a, b) => a - b
  );

  for (const level of betLevels) {
    const levelAmount = level - previousLevel;
    if (levelAmount <= 0) continue;

    // Eligible players are those who bet at least this level and haven't folded
    const eligible = contributors
      .filter(
        (p) =>
          p.totalBet >= level &&
          p.status !== PLAYER_STATUS.FOLDED
      )
      .map((p) => p.seat);

    // Count all players who contributed at this level (including folded)
    const contributorCount = contributors.filter(
      (p) => p.totalBet >= level
    ).length;

    // Folded players' bets still go into the pot
    const actualContributors = contributors.filter(
      (p) => p.totalBet > previousLevel
    ).length;

    const potAmount = toMoney(levelAmount * actualContributors);

    if (potAmount > 0 && eligible.length > 0) {
      pots.push({ amount: potAmount, eligible });
    }

    previousLevel = level;
  }

  return pots;
}

/**
 * Simple pot calculation: sum all bets into a single pot.
 * Use when no side pots are needed.
 */
function calculateSimplePot(players) {
  return toMoney(players.reduce((sum, p) => sum + (p.totalBet || 0), 0));
}

/**
 * Distribute pot winnings to winners.
 * Handles split pots (multiple winners).
 *
 * @param {Array} pots - [{ amount, eligible }]
 * @param {Array} winnerSeats - Seats that won the hand
 * @returns {Object} payouts - { [seat]: amount }
 */
function distributePots(pots, winnerSeats) {
  const payouts = {};

  for (const pot of pots) {
    // Winners eligible for this pot
    const eligibleWinners = winnerSeats.filter((seat) =>
      pot.eligible.includes(seat)
    );

    if (eligibleWinners.length === 0) continue;

    const share = toMoney(pot.amount / eligibleWinners.length);
    for (const seat of eligibleWinners) {
      payouts[seat] = toMoney((payouts[seat] || 0) + share);
    }
  }

  return payouts;
}

module.exports = {
  calculatePots,
  calculateSimplePot,
  distributePots,
};
