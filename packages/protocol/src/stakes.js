'use strict';

/**
 * Stake-level table metadata.
 *
 * Keep this list short — the demo runs three stakes. Cash-game blinds are
 * in chips; min/max buy-in are expressed as multiples of the big blind so
 * adding a stake is a one-line change.
 *
 * `id`           short kebab id used in lobby Redis keys (`lobby:{id}:tables`)
 * `name`         display name for the lobby UI
 * `smallBlind`   chips
 * `bigBlind`     chips
 * `maxSeats`     hard ceiling on seats per table (engine enforces too)
 * `minBuyIn`     chips (40 BB by default)
 * `maxBuyIn`     chips (200 BB by default)
 */
const STAKES = Object.freeze([
  Object.freeze({
    id: '1-2',
    name: 'Micro $1/$2',
    smallBlind: 1,
    bigBlind: 2,
    maxSeats: 6,
    minBuyIn: 80,
    maxBuyIn: 400,
  }),
  Object.freeze({
    id: '5-10',
    name: 'Low $5/$10',
    smallBlind: 5,
    bigBlind: 10,
    maxSeats: 6,
    minBuyIn: 400,
    maxBuyIn: 2000,
  }),
  Object.freeze({
    id: '25-50',
    name: 'Mid $25/$50',
    smallBlind: 25,
    bigBlind: 50,
    maxSeats: 9,
    minBuyIn: 2000,
    maxBuyIn: 10000,
  }),
]);

const STAKES_BY_ID = Object.freeze(
  STAKES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {})
);

function getStake(stakeId) {
  return STAKES_BY_ID[stakeId] || null;
}

function listStakes() {
  return STAKES;
}

module.exports = { STAKES, STAKES_BY_ID, getStake, listStakes };
