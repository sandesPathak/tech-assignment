'use strict';

/**
 * sign.js — HMAC envelope for worker → gateway pub/sub messages.
 *
 * When `WORKER_PUBLISH_SECRET` is configured on both the worker and the
 * gateway, every published delta is signed and verified on receipt. If
 * Redis credentials leak, an attacker still can't inject fake state
 * frames ("you won, pay this address") because they don't have the
 * signing key.
 *
 * If the env var is unset on either side the helpers no-op so existing
 * deployments keep working unchanged. This is intentional — security
 * is opt-in for dev, mandatory for prod via env config.
 */

const crypto = require('crypto');

const SIG_FIELD = '_sig';
const SIG_VERSION = 'v1';

function canonicalize(obj) {
  // Stable stringify excluding the signature field itself. We sort keys
  // at every level so signing/verifying are byte-identical regardless of
  // JSON key insertion order across runtimes.
  const stable = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stable);
    const out = {};
    const keys = Object.keys(v).filter((k) => k !== SIG_FIELD).sort();
    for (const k of keys) out[k] = stable(v[k]);
    return out;
  };
  return JSON.stringify(stable(obj));
}

/**
 * Sign a message in-place. Mutates and returns the input. No-op if no
 * secret is supplied (so callers don't need to branch).
 */
function sign(msg, secret) {
  if (!secret || !msg || typeof msg !== 'object') return msg;
  const mac = crypto
    .createHmac('sha256', secret)
    .update(canonicalize(msg))
    .digest('base64');
  msg[SIG_FIELD] = `${SIG_VERSION}:${mac}`;
  return msg;
}

/**
 * Verify a signed message. Returns one of:
 *   { ok: true }                            — sig present and matches
 *   { ok: true, unsigned: true }            — no sig, secret not enforced
 *   { ok: false, reason: 'missing' }        — secret set but no sig field
 *   { ok: false, reason: 'bad_format' }     — sig field unparseable
 *   { ok: false, reason: 'mismatch' }       — sig present but doesn't match
 *   { ok: false, reason: 'unknown_version' }
 *
 * `enforce` controls behavior when the message is unsigned:
 *   - false (default): unsigned messages pass — useful when rolling out.
 *   - true: unsigned messages are rejected.
 */
function verify(msg, secret, opts = {}) {
  const enforce = !!opts.enforce;
  if (!secret) return { ok: true, unsigned: true };
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'bad_format' };
  const sig = msg[SIG_FIELD];
  if (!sig) {
    return enforce ? { ok: false, reason: 'missing' } : { ok: true, unsigned: true };
  }
  const idx = sig.indexOf(':');
  if (idx <= 0) return { ok: false, reason: 'bad_format' };
  const version = sig.slice(0, idx);
  const mac = sig.slice(idx + 1);
  if (version !== SIG_VERSION) return { ok: false, reason: 'unknown_version' };
  const expected = crypto
    .createHmac('sha256', secret)
    .update(canonicalize(msg))
    .digest('base64');
  // timingSafeEqual requires equal-length buffers.
  let macBuf;
  let expBuf;
  try {
    macBuf = Buffer.from(mac, 'base64');
    expBuf = Buffer.from(expected, 'base64');
  } catch (_e) { return { ok: false, reason: 'bad_format' }; }
  if (macBuf.length !== expBuf.length) return { ok: false, reason: 'mismatch' };
  if (!crypto.timingSafeEqual(macBuf, expBuf)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

module.exports = { sign, verify, SIG_FIELD, SIG_VERSION };
