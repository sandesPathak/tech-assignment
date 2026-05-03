'use strict';

const { sign, verify, SIG_FIELD } = require('@hijack/protocol/sign');

describe('@hijack/protocol/sign', () => {
  const SECRET = 'super-secret-test-key';

  test('sign + verify roundtrip', () => {
    const msg = { t: 's2c.delta', tableId: 't1', seq: 5, payload: { foo: 'bar', n: 42 } };
    sign(msg, SECRET);
    expect(typeof msg[SIG_FIELD]).toBe('string');
    expect(verify(msg, SECRET).ok).toBe(true);
  });

  test('verify rejects tampered payload', () => {
    const msg = { t: 's2c.delta', tableId: 't1', seq: 1, payload: { winner: 'alice' } };
    sign(msg, SECRET);
    msg.payload.winner = 'mallory';
    const r = verify(msg, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch');
  });

  test('verify rejects with wrong key', () => {
    const msg = { t: 's2c.delta', x: 1 };
    sign(msg, SECRET);
    expect(verify(msg, 'different-key').ok).toBe(false);
  });

  test('unsigned message passes when not enforced', () => {
    const msg = { t: 's2c.delta', x: 1 };
    expect(verify(msg, SECRET).ok).toBe(true);
  });

  test('unsigned message fails when enforced', () => {
    const msg = { t: 's2c.delta', x: 1 };
    const r = verify(msg, SECRET, { enforce: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing');
  });

  test('no secret = no enforcement (backwards compat)', () => {
    const msg = { t: 's2c.delta', x: 1 };
    expect(verify(msg, null).ok).toBe(true);
    expect(verify(msg, '').ok).toBe(true);
  });

  test('canonical signing is order-independent', () => {
    const a = { t: 'x', a: 1, b: 2, payload: { z: 9, y: 8 } };
    const b = { payload: { y: 8, z: 9 }, b: 2, a: 1, t: 'x' };
    sign(a, SECRET);
    sign(b, SECRET);
    expect(a[SIG_FIELD]).toBe(b[SIG_FIELD]);
  });

  test('bad sig format is rejected', () => {
    const msg = { t: 's2c.delta', x: 1, [SIG_FIELD]: 'not-a-real-sig' };
    expect(verify(msg, SECRET).ok).toBe(false);
  });
});
