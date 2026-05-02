'use strict';

/**
 * auth.js — JWT verification for WS upgrades.
 *
 * Phase 4 (Next.js) will mint these tokens after the user signs in. For
 * now the secret is read from `GATEWAY_JWT_SECRET` (env). HS256 is fine —
 * Next.js and the gateway run in the same trust boundary, no need for
 * key-pair overhead.
 *
 * Expected token claims:
 *   sub        userId (string)
 *   tableId    string
 *   seat       integer | null
 *   sessionId  short-lived per-tab id (used for `replaced_by_other_session`)
 *   exp        standard JWT expiry
 *
 * The token travels in the `?token=` query string at upgrade time. We
 * deliberately don't accept it in a header — browser WS APIs can't set
 * custom headers, and we want one path that works for browsers and bots.
 */

const jwt = require('jsonwebtoken');

const DEFAULT_SECRET_ENV = 'GATEWAY_JWT_SECRET';

class AuthError extends Error {
  constructor(message, code = 'unauthorized') {
    super(message);
    this.code = code;
  }
}

/**
 * Verify a JWT and return its claims, throwing AuthError on any failure.
 * @param {string} token
 * @param {object} [opts]
 * @param {string} [opts.secret]  override secret (test injection)
 * @returns {{ userId: string, tableId: string, seat?: number, sessionId: string, exp: number }}
 */
function verifyToken(token, opts = {}) {
  const secret = opts.secret || process.env[DEFAULT_SECRET_ENV];
  if (!secret) {
    throw new AuthError('gateway secret not configured', 'misconfigured');
  }
  if (!token) {
    throw new AuthError('missing token');
  }
  let claims;
  try {
    claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    throw new AuthError(`token verify failed: ${err.message}`);
  }
  if (!claims || typeof claims !== 'object') {
    throw new AuthError('token has no claims');
  }
  if (!claims.sub) throw new AuthError('token missing sub');
  if (!claims.tableId) throw new AuthError('token missing tableId');
  if (!claims.sessionId) throw new AuthError('token missing sessionId');
  return {
    userId: String(claims.sub),
    tableId: String(claims.tableId),
    seat: claims.seat != null ? Number(claims.seat) : undefined,
    sessionId: String(claims.sessionId),
    exp: claims.exp,
  };
}

/**
 * Sign a token — used by the test suite (and, eventually, by Next.js).
 */
function signToken(claims, opts = {}) {
  const secret = opts.secret || process.env[DEFAULT_SECRET_ENV];
  if (!secret) throw new AuthError('gateway secret not configured', 'misconfigured');
  const ttl = opts.expiresIn || '5m';
  return jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: ttl });
}

/**
 * Pull token out of an upgrade request URL: `/table/:id?token=...`.
 * Returns null if missing/invalid URL shape — caller decides whether to
 * 401 or fall back.
 */
function extractToken(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, 'http://_');
    return parsed.searchParams.get('token');
  } catch (_e) {
    return null;
  }
}

/**
 * Pull `:id` out of `/table/:id`. Returns null if the path doesn't match.
 */
function extractTableId(url) {
  if (!url) return null;
  const path = url.split('?')[0];
  const m = path.match(/^\/table\/([^/]+)$/);
  return m ? m[1] : null;
}

module.exports = {
  AuthError,
  verifyToken,
  signToken,
  extractToken,
  extractTableId,
  DEFAULT_SECRET_ENV,
};
