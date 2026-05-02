'use strict';

const { PLAYER_STATUS } = require('./constants');

/**
 * Check if a player is active in the current hand (not folded, not sitting out, not busted).
 */
function isActive(player) {
  return (
    player.status === PLAYER_STATUS.ACTIVE ||
    player.status === PLAYER_STATUS.ALL_IN
  );
}

/**
 * Check if a player has folded.
 */
function isFolded(player) {
  return player.status === PLAYER_STATUS.FOLDED;
}

/**
 * Check if a player is all-in.
 */
function isAllIn(player) {
  return player.status === PLAYER_STATUS.ALL_IN;
}

/**
 * Check if a player is sitting out.
 */
function isSittingOut(player) {
  return player.status === PLAYER_STATUS.SITTING_OUT;
}

/**
 * Check if a player is busted (zero stack and out).
 */
function isBusted(player) {
  return player.status === PLAYER_STATUS.BUSTED;
}

/**
 * Get all active players (not folded, not sitting out).
 */
function getActivePlayers(players) {
  return players.filter(isActive);
}

/**
 * Get players still in the hand (active or all-in, not folded).
 */
function getPlayersInHand(players) {
  return players.filter(
    (p) =>
      p.status === PLAYER_STATUS.ACTIVE ||
      p.status === PLAYER_STATUS.ALL_IN
  );
}

/**
 * Get the number of players who can still act (active, not all-in).
 */
function getActingPlayerCount(players) {
  return players.filter((p) => p.status === PLAYER_STATUS.ACTIVE).length;
}

/**
 * Get the player at a specific seat.
 */
function getPlayerBySeat(players, seat) {
  return players.find((p) => p.seat === seat) || null;
}

/**
 * Get the next occupied seat after the given seat (wrapping around).
 */
function getNextSeat(players, currentSeat, maxSeats) {
  const activePlayers = getPlayersInHand(players);
  if (activePlayers.length === 0) return -1;

  for (let i = 1; i <= maxSeats; i++) {
    const nextSeat = ((currentSeat - 1 + i) % maxSeats) + 1;
    const player = activePlayers.find((p) => p.seat === nextSeat);
    if (player && player.status === PLAYER_STATUS.ACTIVE) {
      return nextSeat;
    }
  }
  return -1;
}

module.exports = {
  isActive,
  isFolded,
  isAllIn,
  isSittingOut,
  isBusted,
  getActivePlayers,
  getPlayersInHand,
  getActingPlayerCount,
  getPlayerBySeat,
  getNextSeat,
};
