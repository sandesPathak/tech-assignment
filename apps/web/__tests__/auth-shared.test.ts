// auth-shared.test.ts — small sanity tests for the session encode/decode.

import {
  encodeSession,
  decodeSession,
  type SessionPayload,
} from '../lib/auth-shared'

describe('session encode/decode', () => {
  test('round-trips', () => {
    const p: SessionPayload = {
      userId: 'u_test',
      username: 'tester',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const enc = encodeSession(p)
    const dec = decodeSession(enc)
    expect(dec).toEqual(p)
  })

  test('rejects expired sessions', () => {
    const p: SessionPayload = {
      userId: 'u_test',
      username: 'tester',
      exp: Math.floor(Date.now() / 1000) - 60,
    }
    expect(decodeSession(encodeSession(p))).toBeNull()
  })

  test('rejects garbage', () => {
    expect(decodeSession('zzz')).toBeNull()
    expect(decodeSession(undefined)).toBeNull()
    expect(decodeSession('')).toBeNull()
  })
})
