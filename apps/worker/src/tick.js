'use strict';

const { advance, getStepName } = require('./engine-runner');
const { GAME_HAND } = require('@hijack/engine');
const { NullPublisher } = require('./publish');

/**
 * processTable — single advance of the table state machine.
 *
 *   1. Load state from Redis (fall back to snapshot replay if cold).
 *   2. Run one engine step.
 *   3. Write delta back via the state store (pipelined Redis +
 *      durable Neon append).
 *   4. Publish to `table:{id}:events` so the gateway can fan out.
 *
 * Mirrors the public API of the legacy serverless processTable so
 * existing /process-style tests keep working.
 */
async function processTable(stateStore, tableId, playerAction, publisher) {
  const pub = publisher || new NullPublisher();
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
    return {
      status: 'awaiting_action',
      tableId,
      step: state.game.handStep,
      stepName: getStepName(state.game.handStep),
      move: state.game.move,
    };
  }

  const handId = `${tableId}:${state.game.gameNo}`;
  const payload = makePayload(before, result);
  const newSeq = await stateStore.applyTick(
    tableId,
    { game: result.game, players: result.players },
    {
      step: result.game.handStep,
      payload,
    },
    handId
  );

  // Fan-out to gateway subscribers. Best-effort — durable record is in
  // the event store and clients can resume from `lastSeq`.
  await pub.publishTick(tableId, {
    handId,
    seq: newSeq,
    step: result.game.handStep,
    payload,
  });

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
