'use strict';

const { getAutoFoldDecision } = require('../src/index');

describe('getAutoFoldDecision', () => {
  const base = {
    orphanAutoFoldMs: 6000,
    turnTimeoutMs: 15000,
  };

  it('folds a disconnected bot before the full turn timeout', () => {
    expect(getAutoFoldDecision({
      ...base,
      waitedMs: 6000,
      seatLive: false,
      isBot: true,
    })).toEqual({
      fold: true,
      reason: 'orphan_disconnect',
      shouldLeave: true,
    });
  });

  it('waits for the full turn timeout before folding a human seat', () => {
    expect(getAutoFoldDecision({
      ...base,
      waitedMs: 6000,
      seatLive: true,
      isBot: false,
    })).toEqual({
      fold: false,
      reason: null,
      shouldLeave: false,
    });

    expect(getAutoFoldDecision({
      ...base,
      waitedMs: 15000,
      seatLive: true,
      isBot: false,
    })).toEqual({
      fold: true,
      reason: 'turn_timeout',
      shouldLeave: false,
    });
  });

  it('folds a disconnected human seat once the turn timer fully expires', () => {
    expect(getAutoFoldDecision({
      ...base,
      waitedMs: 15000,
      seatLive: false,
      isBot: false,
    })).toEqual({
      fold: true,
      reason: 'turn_timeout',
      shouldLeave: false,
    });
  });
});
