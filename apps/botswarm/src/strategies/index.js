'use strict';

const random = require('./random');
const tight = require('./tight');
const loose = require('./loose');

const PROFILES = Object.freeze({
  random,
  tight,
  loose,
});

function pickProfile(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown bot profile: ${name}`);
  return p;
}

module.exports = { PROFILES, pickProfile };
