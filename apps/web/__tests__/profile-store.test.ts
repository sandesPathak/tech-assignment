// profile-store.test.ts — exercises the rate-limit / reservation /
// uniqueness chain and the post-write Redis bookkeeping. Uses the
// MemoryRedis + MemoryPlayersStore shims so tests run without a live
// backend.

import {
  writeProfile,
  readProfile,
  MemoryPlayersStore,
  MemoryRedis,
  PROFILE_UPDATED_CHANNEL,
  RATE_LIMIT_KEY,
  RESERVED_KEY,
  TAKEN_KEY,
} from '../lib/profile/store'

function makeDeps(now = () => Date.now()) {
  return {
    redis: new MemoryRedis(now),
    pg: new MemoryPlayersStore(),
    now,
  }
}

describe('writeProfile', () => {
  test('first write succeeds + publishes profile:updated', async () => {
    const deps = makeDeps()
    const result = await writeProfile(
      'u_alice',
      { displayName: 'Alice', avatarId: '3' },
      deps
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.row.displayName).toBe('Alice')
    expect(result.row.avatarId).toBe('3')

    expect(deps.redis.published.length).toBe(1)
    const ev = deps.redis.published[0]
    expect(ev.channel).toBe(PROFILE_UPDATED_CHANNEL)
    const parsed = JSON.parse(ev.message)
    expect(parsed.userId).toBe('u_alice')
    expect(parsed.displayName).toBe('Alice')
    expect(parsed.avatarId).toBe('3')

    // Uniqueness sentinel set.
    expect(await deps.redis.get(TAKEN_KEY('alice'))).toBe('u_alice')
    // First write does NOT burn the rate-limit budget — the user has
    // never picked a name before.
    expect(await deps.redis.get(RATE_LIMIT_KEY('u_alice'))).toBeNull()
  })

  test('third write within 7 days is rate-limited', async () => {
    // Initial setup is free; the SECOND write (the first real change)
    // burns the user's once-per-7-days budget; a THIRD attempt within
    // that window is rejected.
    let t = 1700000000000
    const deps = makeDeps(() => t)
    await writeProfile('u_alice', { displayName: 'Alice', avatarId: '3' }, deps)
    t += 60_000
    const r2 = await writeProfile(
      'u_alice',
      { displayName: 'Alice2', avatarId: '4' },
      deps
    )
    expect(r2.ok).toBe(true)
    t += 60_000
    const r3 = await writeProfile(
      'u_alice',
      { displayName: 'Alice3', avatarId: '5' },
      deps
    )
    expect(r3.ok).toBe(false)
    if (!r3.ok && r3.code === 'rate_limited') {
      expect(r3.retryAfterSec).toBeGreaterThan(0)
    } else if (!r3.ok) {
      throw new Error(`expected rate_limited, got ${r3.code}`)
    }
  })

  test('rate-limit key expires after 7d, allowing the next change', async () => {
    let t = 1700000000000
    const deps = makeDeps(() => t)
    await writeProfile('u_alice', { displayName: 'Alice', avatarId: '3' }, deps)
    t += 60_000
    // Bump the user once to set the rate-limit clock.
    await writeProfile('u_alice', { displayName: 'Alice', avatarId: '5' }, deps)
    t += 60_000
    const blocked = await writeProfile(
      'u_alice',
      { displayName: 'Alice', avatarId: '6' },
      deps
    )
    expect(blocked.ok).toBe(false)
    // Advance past 7 days.
    t += 7 * 86400 * 1000 + 1000
    const allowed = await writeProfile(
      'u_alice',
      { displayName: 'Alice', avatarId: '6' },
      deps
    )
    expect(allowed.ok).toBe(true)
  })

  test('uniqueness — different user cannot take a taken name', async () => {
    const deps = makeDeps()
    const a = await writeProfile(
      'u_alice',
      { displayName: 'Champ', avatarId: '1' },
      deps
    )
    expect(a.ok).toBe(true)
    const b = await writeProfile(
      'u_bob',
      { displayName: 'CHAMP', avatarId: '2' },
      deps
    )
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.code).toBe('name_taken')
  })

  test('reservation — old name is held for 30d after a rename', async () => {
    let t = 1700000000000
    const deps = makeDeps(() => t)
    await writeProfile('u_alice', { displayName: 'Champ', avatarId: '1' }, deps)
    t += 60_000
    // Wait past the 7d rate-limit before renaming.
    t += 7 * 86400 * 1000 + 1000
    const renamed = await writeProfile(
      'u_alice',
      { displayName: 'NewName', avatarId: '1' },
      deps
    )
    expect(renamed.ok).toBe(true)
    // The old name should now be reserved.
    expect(await deps.redis.get(RESERVED_KEY('champ'))).toBe('u_alice')
    // A different user can't take it.
    const bobAttempt = await writeProfile(
      'u_bob',
      { displayName: 'Champ', avatarId: '2' },
      deps
    )
    expect(bobAttempt.ok).toBe(false)
    if (!bobAttempt.ok) expect(bobAttempt.code).toBe('name_reserved')
    // Past 30 days, the reservation expires and bob can take it.
    t += 30 * 86400 * 1000 + 1000
    const bobLater = await writeProfile(
      'u_bob',
      { displayName: 'Champ', avatarId: '2' },
      deps
    )
    expect(bobLater.ok).toBe(true)
  })

  test('user can take their OWN reserved name back', async () => {
    let t = 1700000000000
    const deps = makeDeps(() => t)
    await writeProfile('u_alice', { displayName: 'Champ', avatarId: '1' }, deps)
    t += 7 * 86400 * 1000 + 1000
    await writeProfile('u_alice', { displayName: 'NewName', avatarId: '1' }, deps)
    t += 7 * 86400 * 1000 + 1000
    const back = await writeProfile(
      'u_alice',
      { displayName: 'Champ', avatarId: '1' },
      deps
    )
    expect(back.ok).toBe(true)
  })

  test('readProfile returns null when no row exists', async () => {
    const deps = makeDeps()
    expect(await readProfile('u_nobody', deps)).toBeNull()
  })

  test('readProfile returns the latest row after a write', async () => {
    const deps = makeDeps()
    await writeProfile('u_alice', { displayName: 'Alice', avatarId: '3' }, deps)
    const got = await readProfile('u_alice', deps)
    expect(got?.displayName).toBe('Alice')
    expect(got?.avatarId).toBe('3')
  })
})
