// avatars.test.ts — smoke test that the bundled avatar set is present
// and that helpers reject out-of-range ids.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AVATAR_COUNT,
  avatarIds,
  avatarUrl,
  defaultAvatarId,
  normalizeAvatarId,
} from '../lib/profile/avatars'

const PUBLIC_AVATARS = resolve(__dirname, '..', 'public', 'avatars')

describe('bundled avatar set', () => {
  test(`exposes ${24} ids`, () => {
    expect(AVATAR_COUNT).toBe(24)
    expect(avatarIds().length).toBe(24)
    expect(avatarIds()[0]).toBe('1')
    expect(avatarIds()[23]).toBe('24')
  })

  test('every id has a corresponding SVG on disk', () => {
    for (const id of avatarIds()) {
      const path = resolve(PUBLIC_AVATARS, `${id}.svg`)
      expect(existsSync(path)).toBe(true)
      const head = readFileSync(path, 'utf8').slice(0, 80)
      expect(head).toMatch(/^<svg /)
    }
  })

  test('manifest.json describes the set', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(PUBLIC_AVATARS, 'manifest.json'), 'utf8')
    )
    expect(manifest.count).toBe(24)
    expect(manifest.style).toBe('bottts-neutral')
    expect(manifest.avatars.length).toBe(24)
  })

  test('normalizeAvatarId rejects junk + accepts in-range numbers', () => {
    expect(normalizeAvatarId('1')).toBe('1')
    expect(normalizeAvatarId(7)).toBe('7')
    expect(normalizeAvatarId('24')).toBe('24')
    expect(normalizeAvatarId('25')).toBeNull()
    expect(normalizeAvatarId('0')).toBeNull()
    expect(normalizeAvatarId('abc')).toBeNull()
    expect(normalizeAvatarId(null)).toBeNull()
  })

  test('avatarUrl falls back to defaultAvatarId on bad input', () => {
    expect(avatarUrl('5')).toBe('/avatars/5.svg')
    expect(avatarUrl('999')).toBe(`/avatars/${defaultAvatarId}.svg`)
    expect(avatarUrl(null)).toBe(`/avatars/${defaultAvatarId}.svg`)
  })
})
