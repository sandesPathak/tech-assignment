'use strict';

const { advance, getStepName } = require('./engine-runner');
const { GAME_HAND } = require('@hijack/engine');

/**
 * processTable — single advance of the table state machine.
 *
 *   1. Load state from Redis (fall back to snapshot replay if cold).
 *   2. Run one engine step.
 *   3. Write delta back via the state store (pipelined Redis +
 *      durable Neon append).
 *
 * Mirrors the public API of the legacy serverless processTable so
 * existing /process-style tests keep working.
 */
async function processTable(stateStore, tableId, playerAction) {
  const state = await stateStore.loadTable(tableId);
  if (!state) {
    return { status: 'not_found', tableId };
  }

  const before = state.game.handStep;
  const result = advance(state.game, state.players, playerAction);

  if (result.error) {
    return { status: 'error', error: result.error, tableId, step: state.game.handStep };
  }

  if (result.awaiting) {
    // Engine wants a player action but we have none — we still snapshot
    // the read so the loaded state is durable, but we don't bump seq.
    return {
      status: 'awaiting_action',
      tableId,
      step: state.game.handStep,
      stepName: getStepName(state.game.handStep),
      move: state.game.move,
    };
  }

  const handId = `${tableId}:${state.game.gameNo}`;
  const newSeq = await stateStore.applyTick(
    tableId,
    { game: result.game, players: result.players },
    {
      step: result.game.handStep,
      payload: makePayload(before, result),
    },
    handId
  );

  return {
    status: 'processed',
    tableId,
    step: result.game.handStep,
    stepName: getStepName(result.game.handStep),
    seq: newSeq,
    handDone: result.game.handStep === GAME_HAND.RECORD_STATS_AND_NEW_HAND,
  };
}

function makePayload(stepBefore, result) {
  // Hand events should be small + replayable but the canonical
  // recovery path is the snapshot, so payload only records the
  // delta surface area: step transition + key game scalars.
  return {
    from: stepBefore,
    to: result.game.handStep,
    pot: result.game.pot,
    currentBet: result.game.currentBet,
    move: result.game.move,
    community: result.game.communityCards,
    winners: result.game.winners,
  };
}

module.exports = { processTable };
