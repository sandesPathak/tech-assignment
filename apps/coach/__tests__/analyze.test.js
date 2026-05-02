'use strict';

const { analyzeHand, evaluateDecision, positionFor, comboForClass } = require('../src/analyze');
const { GAME_HAND, ACTION } = require('@hijack/engine');
const { classify } = require('../src/hand-class');

describe('hand-class.classify', () => {
  it('classifies AKs', () => {
    expect(classify(['AH', 'KH'])).toBe('AKs');
  });
  it('classifies AKo', () => {
    expect(classify(['AH', 'KS'])).toBe('AKo');
  });
  it('classifies AA', () => {
    expect(classify(['AH', 'AS'])).toBe('AA');
  });
});

describe('positionFor', () => {
  it('heads-up: dealer = SB', () => {
    expect(positionFor(1, 1, 2, 2)).toBe('SB');
    expect(positionFor(2, 1, 2, 2)).toBe('BB');
  });
});

describe('evaluateDecision (preflop)', () => {
  it('AA on the BTN raises is on_chart', () => {
    const finding = evaluateDecision({
      street: 'preflop',
      position: 'BTN',
      hole_class: 'AA',
      action_taken: 'raise',
      amount_taken: 3,
      pot_before: 1.5,
      to_call: 2,
      stack_bb: 100,
      board: [],
      action_history: [],
    });
    expect(finding.tag).toBe('on_chart');
    expect(finding.best_action).toBe('raise');
    expect(finding.mistake_bb).toBeLessThanOrEqual(0.1);
  });

  it('72o under the gun folding is on_chart', () => {
    const finding = evaluateDecision({
      street: 'preflop',
      position: 'UTG',
      hole_class: '72o',
      action_taken: 'fold',
      amount_taken: 0,
      pot_before: 1.5,
      to_call: 2,
      stack_bb: 100,
      board: [],
      action_history: [],
    });
    expect(['on_chart', 'minor_deviation']).toContain(finding.tag);
    expect(finding.best_action).toBe('fold');
  });

  it('AA folding to a min-raise UTG is a spew (mistake_bb > 0)', () => {
    const finding = evaluateDecision({
      street: 'preflop',
      position: 'UTG',
      hole_class: 'AA',
      action_taken: 'fold',
      amount_taken: 0,
      pot_before: 1.5,
      to_call: 2,
      stack_bb: 100,
      board: [],
      action_history: [],
    });
    expect(finding.best_action).toBe('raise');
    expect(finding.mistake_bb).toBeGreaterThan(1);
    expect(['overfold', 'minor_deviation']).toContain(finding.tag);
  });
});

describe('analyzeHand integration', () => {
  it('produces findings from a synthetic event sequence', () => {
    // Two-player, hero raises preflop with AKs from BTN(=SB), villain calls,
    // hero c-bets flop, villain folds. We hand-build the events with the
    // worker payload shape augmented with the actor/action fields the
    // coach extracts (in production these come from a side-channel).
    const events = [
      { step: GAME_HAND.PRE_FLOP_BETTING_ROUND, payload: { pot: 5, currentBet: 3, move: 1, community: [] }, actorSeat: 1, actionTaken: 'raise', actionAmount: 3 },
      { step: GAME_HAND.PRE_FLOP_BETTING_ROUND, payload: { pot: 6, currentBet: 3, move: 2, community: [] }, actorSeat: 2, actionTaken: 'call', actionAmount: 3 },
      { step: GAME_HAND.DEAL_FLOP, payload: { pot: 6, currentBet: 0, move: 1, community: ['AH', 'KD', '7C'] } },
      { step: GAME_HAND.FLOP_BETTING_ROUND, payload: { pot: 10, currentBet: 4, move: 1, community: ['AH', 'KD', '7C'] }, actorSeat: 1, actionTaken: 'bet', actionAmount: 4 },
      { step: GAME_HAND.FLOP_BETTING_ROUND, payload: { pot: 10, currentBet: 4, move: 2, community: ['AH', 'KD', '7C'] }, actorSeat: 2, actionTaken: 'fold', actionAmount: 0 },
    ];

    const result = analyzeHand({
      handId: 't1:1',
      events,
      hero: 'p1',
      players: [
        { playerId: 'p1', seat: 1, cards: ['AS', 'KS'], stack: 200, bet: 0 },
        { playerId: 'p2', seat: 2, cards: ['9D', '8D'], stack: 200, bet: 0 },
      ],
      dealerSeat: 1,
      bigBlindSeat: 2,
      bigBlind: 2,
    });

    expect(result.handId).toBe('t1:1');
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    // First decision is preflop AKs raise — should be a positive call.
    const preflop = result.findings.find((f) => f.street === 'preflop');
    expect(preflop).toBeDefined();
    expect(['on_chart', 'minor_deviation']).toContain(preflop.tag);
  });
});

describe('comboForClass', () => {
  it('returns a 2-card array for a pair class', () => {
    const c = comboForClass('AA');
    expect(c).toHaveLength(2);
  });
  it('returns suited combo for s class', () => {
    const c = comboForClass('AKs');
    expect(c[0].slice(-1)).toBe(c[1].slice(-1));
  });
  it('returns offsuit combo for o class', () => {
    const c = comboForClass('AKo');
    expect(c[0].slice(-1)).not.toBe(c[1].slice(-1));
  });
});
