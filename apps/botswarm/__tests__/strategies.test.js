'use strict';

/**
 * Strategy unit tests.
 *
 * Two invariants per profile:
 *   1. `decide` always returns a legal action for the given state — i.e.
 *      no `fold` when there's nothing to call (would be rejected by the
 *      engine and waste a roundtrip), and no `check` when there is.
 *   2. Over many calls the profile produces SOME diversity of actions
 *      (otherwise the table softlocks). We test "no single action covers
 *      100% of decisions" across 500 random states.
 */

const { ACTIONS } = require('@hijack/protocol/messages');
const { PROFILES } = require('../src/strategies');
const { makeRng } = require('../src/bot');

const rng = makeRng(42);
function randomState() {
  const cur = Math.floor(rng() * 30);
  const myBet = Math.floor(rng() * (cur + 1));
  return {
    currentBet: cur,
    myBet,
    myStack: 50 + Math.floor(rng() * 100),
    bigBlind: 2,
    isMyTurn: true,
  };
}

describe('strategy profiles', () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    describe(name, () => {
      test('always returns a legal action across 500 states', () => {
        const ctx = { rng: makeRng(name.length + 99) };
        const seen = new Set();
        for (let i = 0; i < 500; i += 1) {
          const s = randomState();
          const decision = profile.decide(s, ctx);
          expect(decision).toBeTruthy();
          expect(typeof decision.action).toBe('string');
          const toCall = Math.max(0, s.currentBet - s.myBet);
          if (toCall === 0) {
            // Engine doesn't accept FOLD when checking is free.
            expect(decision.action).not.toBe(ACTIONS.FOLD);
            expect([ACTIONS.CHECK, ACTIONS.RAISE, ACTIONS.ALL_IN, ACTIONS.BET])
              .toContain(decision.action);
          } else {
            // Engine doesn't accept CHECK when there is a bet outstanding.
            expect(decision.action).not.toBe(ACTIONS.CHECK);
          }
          if (decision.action === ACTIONS.RAISE || decision.action === ACTIONS.BET) {
            expect(typeof decision.amount).toBe('number');
            expect(decision.amount).toBeGreaterThan(0);
          }
          seen.add(decision.action);
        }
        // No single action dominates 100% of outcomes.
        expect(seen.size).toBeGreaterThanOrEqual(2);
      });
    });
  }
});
