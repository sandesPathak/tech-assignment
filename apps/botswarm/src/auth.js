'use strict';

/**
 * auth.js — synthesize bot JWTs.
 *
 * The swarm doesn't run a real signup. We mint a JWT directly using the
 * shared `GATEWAY_JWT_SECRET` env var (same secret the gateway verifies
 * with). Bots therefore look indistinguishable to the gateway from real
 * Next.js-issued tokens, while costing zero HTTP calls in the hot loop.
 *
 * The token shape mirrors what `apps/gateway/src/auth.js` expects:
 *   sub        botId  (string, e.g. "bot-0001")
 *   tableId    string (must equal the URL path's :id)
 *   sessionId  short-lived per-bot id
 *   seat       optional numeric seat hint
 *   exp        standard expiry
 */

const jwt = require('jsonwebtoken');

const DEFAULT_SECRET_ENV = 'GATEWAY_JWT_SECRET';
const DEFAULT_TTL = '30m';

class BotAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BotAuthError';
  }
}

/**
 * Mint a bot token.
 *
 * @param {object} args
 * @param {string} args.botId
 * @param {string} args.tableId
 * @param {string} [args.sessionId]
 * @param {number} [args.seat]
 * @param {string} [args.secret]      override (tests)
 * @param {string} [args.expiresIn]   default '30m'
 * @returns {string} signed JWT
 */
function mintBotToken({ botId, tableId, sessionId, seat, secret, expiresIn } = {}) {
  if (!botId) throw new BotAuthError('botId required');
  if (!tableId) throw new BotAuthError('tableId required');
  const key = secret || process.env[DEFAULT_SECRET_ENV];
  if (!key) {
    throw new BotAuthError(
      `gateway secret not configured — set ${DEFAULT_SECRET_ENV}`
    );
  }
  const claims = {
    sub: String(botId),
    tableId: String(tableId),
    sessionId: sessionId || `${botId}-${Date.now().toString(36)}`,
  };
  if (seat != null) claims.seat = Number(seat);
  return jwt.sign(claims, key, {
    algorithm: 'HS256',
    expiresIn: expiresIn || DEFAULT_TTL,
  });
}

/** Build the WS URL the bot should dial. */
function botUrl({ gatewayUrl, tableId, token }) {
  const base = gatewayUrl.replace(/\/+$/, '');
  return `${base}/table/${encodeURIComponent(tableId)}?token=${encodeURIComponent(token)}`;
}

module.exports = {
  BotAuthError,
  DEFAULT_SECRET_ENV,
  mintBotToken,
  botUrl,
};
