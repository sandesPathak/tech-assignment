'use strict';

/**
 * Auth: sign + verify happy path, missing claims, wrong secret, expiry.
 */

const { signToken, verifyToken, AuthError, extractTableId, extractToken } = require('../src/auth');

const SECRET = 'unit-secret';

describe('auth.verifyToken', () => {
  it('round-trips a valid token', () => {
    const tok = signToken(
      { sub: 'u1', tableId: '7', sessionId: 's1', seat: 3 },
      { secret: SECRET, expiresIn: '60s' }
    );
    const claims = verifyToken(tok, { secret: SECRET });
    expect(claims.userId).toBe('u1');
    expect(claims.tableId).toBe('7');
    expect(claims.sessionId).toBe('s1');
    expect(claims.seat).toBe(3);
  });

  it('rejects missing token', () => {
    expect(() => verifyToken(undefined, { secret: SECRET })).toThrow(AuthError);
  });

  it('rejects mismatched secret', () => {
    const tok = signToken({ sub: 'u1', tableId: '1', sessionId: 's1' }, { secret: SECRET });
    expect(() => verifyToken(tok, { secret: 'WRONG' })).toThrow(AuthError);
  });

  it('rejects token with no required claims', () => {
    const tok = signToken({ sub: 'u1' }, { secret: SECRET });
    expect(() => verifyToken(tok, { secret: SECRET })).toThrow(/missing tableId/);
  });

  it('errors when secret env var is unset and no override', () => {
    const old = process.env.GATEWAY_JWT_SECRET;
    delete process.env.GATEWAY_JWT_SECRET;
    try {
      expect(() => verifyToken('x')).toThrow(/not configured/);
    } finally {
      if (old) process.env.GATEWAY_JWT_SECRET = old;
    }
  });
});

describe('URL parsing', () => {
  it('extracts tableId and token', () => {
    expect(extractTableId('/table/abc?token=xyz')).toBe('abc');
    expect(extractToken('/table/abc?token=xyz')).toBe('xyz');
  });

  it('returns null for non-table paths', () => {
    expect(extractTableId('/foo/bar')).toBe(null);
    expect(extractToken('')).toBe(null);
  });
});
