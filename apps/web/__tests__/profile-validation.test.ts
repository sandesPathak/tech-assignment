// profile-validation.test.ts — pure validators for the PATCH /api/profile
// route. Covers length, charset, profanity, and avatar bounds.

import { validateProfileShape } from '../lib/profile/validation'

describe('validateProfileShape', () => {
  test('accepts a clean name + valid avatar', () => {
    const r = validateProfileShape({ displayName: 'Alice_99', avatarId: '7' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.displayName).toBe('Alice_99')
      expect(r.value.avatarId).toBe('7')
    }
  })

  test('trims surrounding whitespace before length check', () => {
    const r = validateProfileShape({ displayName: '  Bob_123  ', avatarId: '1' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.displayName).toBe('Bob_123')
  })

  test('rejects too-short names', () => {
    const r = validateProfileShape({ displayName: 'ab', avatarId: '1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('name_too_short')
  })

  test('rejects too-long names', () => {
    const r = validateProfileShape({ displayName: 'a'.repeat(17), avatarId: '1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('name_too_long')
  })

  test('rejects bad charset (spaces, punctuation, emoji)', () => {
    for (const bad of ['hello world', 'name.with.dots', 'name-dash', 'cool😎']) {
      const r = validateProfileShape({ displayName: bad, avatarId: '1' })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('name_charset')
    }
  })

  test('rejects profanity (bad-words)', () => {
    // bad-words ships with a default dictionary including this one.
    const r = validateProfileShape({ displayName: 'shit_eater', avatarId: '1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('name_profane')
  })

  test('rejects missing displayName', () => {
    const r = validateProfileShape({ avatarId: '1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('name_required')
  })

  test('rejects out-of-range avatar id', () => {
    for (const bad of ['0', '25', '-1', 'abc', '1.5']) {
      const r = validateProfileShape({ displayName: 'Alice_99', avatarId: bad })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('avatar_invalid')
    }
  })
})
