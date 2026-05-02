'use strict';

/**
 * Runtime mirror of the discriminated unions defined in `index.ts`.
 *
 * The gateway and worker are JS (CommonJS) — the TS file is the source of
 * truth for the schema, and this file exposes the same `t` constants and a
 * pair of light validators so non-TS code never has to stringly-type the
 * message kinds. Browser/bot consumers (TS) import from `index.ts` instead.
 */

// `t` field constants — keep these in lock-step with index.ts.
const C2S = Object.freeze({
  JOIN: 'c2s.join',
  ACTION: 'c2s.action',
  LEAVE: 'c2s.leave',
  HANDOFF_REDEEM: 'c2s.handoff_redeem',
});

// Reason strings used by the gateway when emitting `s2c.kicked`. The
// protocol allows arbitrary strings so consumers stay forward-compat,
// but these are the values Phase 6 (handoff) actually emits.
const KICK_REASON = Object.freeze({
  HANDOFF: 'handoff',
  REPLACED: 'replaced_by_other_session',
  BACKPRESSURE: 'backpressure_resync',
  AUTH: 'auth',
  TABLE_CLOSED: 'table_closed',
});

const S2C = Object.freeze({
  SNAPSHOT: 's2c.snapshot',
  DELTA: 's2c.delta',
  ERROR: 's2c.error',
  KICKED: 's2c.kicked',
});

const ACTIONS = Object.freeze({
  FOLD: 'fold',
  CHECK: 'check',
  CALL: 'call',
  BET: 'bet',
  RAISE: 'raise',
  ALL_IN: 'all_in',
});

const ALL_C2S = new Set(Object.values(C2S));
const ALL_S2C = new Set(Object.values(S2C));

function isClientMessage(x) {
  return !!x && typeof x === 'object' && ALL_C2S.has(x.t);
}

function isServerMessage(x) {
  return !!x && typeof x === 'object' && ALL_S2C.has(x.t);
}

// ─── Builders — small but they centralise the field names so refactors
//     don't leave stale string literals scattered across services. ───

function snapshot(tableId, seq, state) {
  return { t: S2C.SNAPSHOT, tableId, seq, state };
}

function delta(tableId, seq, step, payload) {
  return { t: S2C.DELTA, tableId, seq, step, payload };
}

function error(code, message, tableId) {
  const m = { t: S2C.ERROR, code, message };
  if (tableId != null) m.tableId = tableId;
  return m;
}

function kicked(reason, opts = {}) {
  const m = { t: S2C.KICKED, reason };
  if (opts.replacedBy) m.replacedBy = opts.replacedBy;
  return m;
}

module.exports = {
  C2S,
  S2C,
  ACTIONS,
  KICK_REASON,
  isClientMessage,
  isServerMessage,
  snapshot,
  delta,
  error,
  kicked,
};
