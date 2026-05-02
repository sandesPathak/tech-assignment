'use strict';

/**
 * Format a decimal amount to 2 places.
 * Inlined into @hijack/engine so the engine has no dependencies outside its package.
 */
function toMoney(amount) {
  return Math.round(amount * 100) / 100;
}

module.exports = { toMoney };
