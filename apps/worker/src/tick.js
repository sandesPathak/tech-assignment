'use strict';

const { advance, getStepName } = require('./engine-runner');
const { GAME_HAND } = require('@hijack/engine');
const { NullPublisher } = require('./publish');
const { withSpan } = require('@hijack/observability/tracing');

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
  return withSpan(
    'worker.processTable',
    { 'hijack.table_id': String(tableId), 'hijack.action': playerAction?.action },
    () => _processTableInner(stateStore, tableId, playerAction, publisher)
  );
}

async function _processTableInner(stateStore, tableId, playerAction, publisher) {
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

  // Hand is done when we just executed step 15 (RECORD_STATS_AND_NEW_HAND).
  // The engine auto-rotates back to GAME_PREP within the same advance, so
  // we detect "before" rather than "after" — `result.game.handStep` may
  // already be 0 (GAME_PREP) for the next hand.
  const handDone =
    before === GAME_HAND.RECORD_STATS_AND_NEW_HAND
    || result.game.handStep === GAME_HAND.RECORD_STATS_AND_NEW_HAND;

  // Phase 7: notify the coach worker. Fired exactly once per hand,
  // after step 16 (RECORD_STATS_AND_NEW_HAND). The coach reads the
  // durable hand-event range to reconstruct decisions and produce
  // EV analysis. Best-effort like `publishTick` — coach can be
  // replayed off the durable store if pub/sub drops the message.
  if (handDone) {
    const seatedPlayers = (result.players || [])
      .filter((p) => p && p.playerId)
      .map((p) => ({ seat: p.seat, playerId: String(p.playerId) }));
    await pub.publishHandCompleted({
      handId,
      tableId,
      gameNo: result.game.gameNo,
      lastSeq: newSeq,
      players: seatedPlayers,
    });
  }

  return {
    status: 'processed',
    tableId,
    step: result.game.handStep,
    stepName: getStepName(result.game.handStep),
    seq: newSeq,
    handDone,
  };
}

function makePayload(stepBefore, result) {
  // Fat delta: ship the full game + players each tick so clients can
  // render without an out-of-band fetch. ~1-2 KB on the wire is fine
  // for a single-shard demo; production would split this.
  return {
    from: stepBefore,
    to: result.game.handStep,
    pot: result.game.pot,
    currentBet: result.game.currentBet,
    move: result.game.move,
    community: result.game.communityCards,
    winners: result.game.winners,
    game: result.game,
    players: result.players,
  };
}

module.exports = { processTable };
