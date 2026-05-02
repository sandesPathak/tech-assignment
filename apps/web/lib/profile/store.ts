// store.ts — server-side profile read/write with rate limit, reservation,
// uniqueness, and Redis pub/sub fan-out.
//
// Storage decision: **Postgres (Neon)**. We already have a `pg`
// connection pattern in apps/coach + apps/gateway/coach-api, and
// the profile data joins naturally with `hand_analysis` (both keyed by
// userId). DynamoDB was the alternative — but the streaks-api Dynamo
// layer is in `serverless-v2/`, a separate runtime with its own
// session env vars, and adding a third storage system for ~3 columns
// would inflate the deploy surface for no win. See
// `infra/neon/003_players.sql` for the schema.
//
// Redis primitives (same client as the gateway uses):
//   * profile:<userId>:lastChange   — string, EXPIRE 7d (rate limit)
//   * name:reserved:<lower>         — string, EXPIRE 30d (old-name hold)
//   * name:taken:<lower>            — string set to userId (uniqueness)
//
// Pub/sub channel: `profile:updated` — we publish `{ userId, displayName,
// avatarId }`; the gateway subscribes and re-broadcasts an `s2c.delta`
// with `payload.kind = 'player_updated'` to every socket bound to a
// table where that user is seated.

import type { ValidatedProfileInput } from './validation'

export interface ProfileRow {
  userId: string
  displayName: string
  displayNameLower: string
  displayNameChangedAt: string | null
  avatarId: string
  createdAt: string
  updatedAt: string
}

export type WriteRejection =
  | { ok: false; code: 'rate_limited'; retryAfterSec: number; message: string }
  | { ok: false; code: 'name_reserved'; message: string }
  | { ok: false; code: 'name_taken'; message: string }
  | { ok: false; code: 'store_unavailable'; message: string }

export type WriteOk = { ok: true; row: ProfileRow }

export type WriteResult = WriteOk | WriteRejection

export interface RedisLike {
  get(key: string): Promise<string | null>
  set(
    key: string,
    value: string,
    ...args: any[]
  ): Promise<unknown>
  del(...keys: string[]): Promise<number>
  publish(channel: string, message: string): Promise<number>
  ttl(key: string): Promise<number>
}

export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>
}

export interface ProfileStoreDeps {
  redis: RedisLike
  pg: PgLike | null
  /** Test seam — current epoch ms. */
  now?: () => number
  /** Test seam — pub/sub channel override. */
  channel?: string
}

export const RATE_LIMIT_KEY = (userId: string) => `profile:${userId}:lastChange`
export const RESERVED_KEY = (lower: string) => `name:reserved:${lower}`
export const TAKEN_KEY = (lower: string) => `name:taken:${lower}`
export const PROFILE_UPDATED_CHANNEL = 'profile:updated'

const RATE_LIMIT_SECONDS = 7 * 24 * 60 * 60
const RESERVED_SECONDS = 30 * 24 * 60 * 60

/**
 * Read a profile, or return a default profile shape for users who
 * haven't written one yet. Read order: Pg first, fall back to a
 * synthesized default keyed off the userId. We never invent a
 * displayName — callers pass the session username when they need a
 * fallback to render.
 */
export async function readProfile(
  userId: string,
  deps: ProfileStoreDeps
): Promise<ProfileRow | null> {
  if (!deps.pg) return null
  try {
    const { rows } = await deps.pg.query(
      `SELECT user_id, display_name, display_name_lower,
              display_name_changed_at, avatar_id, created_at, updated_at
         FROM players
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    )
    const r = rows[0]
    if (!r) return null
    return rowFromPg(r)
  } catch {
    return null
  }
}

/**
 * Write a profile update. Runs rate-limit / reservation / uniqueness
 * checks in Redis, then writes the new row to Pg, then publishes
 * `profile:updated`. Returns the canonical row on success.
 *
 * Caller is responsible for input validation (see ./validation.ts).
 */
export async function writeProfile(
  userId: string,
  input: ValidatedProfileInput,
  deps: ProfileStoreDeps
): Promise<WriteResult> {
  const now = deps.now ? deps.now() : Date.now()
  const channel = deps.channel || PROFILE_UPDATED_CHANNEL
  const lower = input.displayName.toLowerCase()

  // 5. rate limit — 1 change / 7 days. Skipped for the FIRST write
  // (no existing profile), so brand-new users can pick a name.
  const existing = deps.pg ? await readProfile(userId, deps) : null

  if (existing) {
    const lastChangeRaw = await deps.redis.get(RATE_LIMIT_KEY(userId))
    if (lastChangeRaw) {
      const ttl = await deps.redis.ttl(RATE_LIMIT_KEY(userId))
      const retryAfter = Math.max(60, ttl)
      return {
        ok: false,
        code: 'rate_limited',
        retryAfterSec: retryAfter,
        message: `You can change your display name once every 7 days. Try again in about ${Math.ceil(
          retryAfter / 86400
        )} day(s).`,
      }
    }
  }

  // 6. reservation — old name is held for 30d after a rename. The
  // person who released it is the one allowed to take it back, so
  // we treat the reservation key as an opaque bag of `userId`s.
  if (!existing || existing.displayNameLower !== lower) {
    const reservedBy = await deps.redis.get(RESERVED_KEY(lower))
    if (reservedBy && reservedBy !== userId) {
      return {
        ok: false,
        code: 'name_reserved',
        message:
          'That display name was used recently and is reserved. Try again in a few weeks.',
      }
    }
  }

  // 7. uniqueness — the Redis sentinel is the fast path. If it's set
  // to a different userId we reject. We also defend in Pg via the
  // unique index, so a race resulting in a Pg unique violation is
  // re-mapped to `name_taken` below.
  const takenBy = await deps.redis.get(TAKEN_KEY(lower))
  if (takenBy && takenBy !== userId) {
    return {
      ok: false,
      code: 'name_taken',
      message: 'That display name is already in use. Pick another.',
    }
  }

  // ── Write path ──────────────────────────────────────────────────
  if (!deps.pg) {
    return {
      ok: false,
      code: 'store_unavailable',
      message: 'Profile storage is unavailable right now.',
    }
  }

  let row: ProfileRow
  try {
    const isoNow = new Date(now).toISOString()
    const { rows } = await deps.pg.query(
      `INSERT INTO players (user_id, display_name, display_name_lower,
                            display_name_changed_at, avatar_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             display_name_lower = EXCLUDED.display_name_lower,
             display_name_changed_at = CASE
               WHEN players.display_name_lower IS DISTINCT FROM EXCLUDED.display_name_lower
                 THEN EXCLUDED.display_name_changed_at
               ELSE players.display_name_changed_at
             END,
             avatar_id = EXCLUDED.avatar_id,
             updated_at = EXCLUDED.updated_at
       RETURNING user_id, display_name, display_name_lower,
                 display_name_changed_at, avatar_id, created_at, updated_at`,
      [userId, input.displayName, lower, isoNow, input.avatarId, isoNow]
    )
    row = rowFromPg(rows[0])
  } catch (err) {
    const m = (err as Error).message || ''
    if (/players_display_name_lower_uk/.test(m) || /unique constraint/i.test(m)) {
      return {
        ok: false,
        code: 'name_taken',
        message: 'That display name is already in use. Pick another.',
      }
    }
    return { ok: false, code: 'store_unavailable', message: m }
  }

  // ── Post-write Redis bookkeeping ────────────────────────────────
  // Mark new name taken, release the old one, set the rate-limit
  // sentinel, and reserve the old name for 30 days.
  const oldLower = existing ? existing.displayNameLower : null
  await deps.redis.set(TAKEN_KEY(lower), userId)
  if (existing) {
    // Only stamp the rate-limit clock when the user actually changed
    // something visible (name or avatar). A no-op write doesn't burn
    // their once-per-week budget.
    const changed =
      existing.displayNameLower !== lower || existing.avatarId !== input.avatarId
    if (changed) {
      await deps.redis.set(RATE_LIMIT_KEY(userId), String(now), 'EX', RATE_LIMIT_SECONDS)
    }
  }
  if (oldLower && oldLower !== lower) {
    await deps.redis.del(TAKEN_KEY(oldLower))
    await deps.redis.set(RESERVED_KEY(oldLower), userId, 'EX', RESERVED_SECONDS)
  }

  // ── Pub/sub fan-out ─────────────────────────────────────────────
  // The gateway subscribes to this channel and re-broadcasts an
  // s2c.delta with payload.kind='player_updated' to every socket
  // bound to a table where this user is seated.
  await deps.redis.publish(
    channel,
    JSON.stringify({
      userId,
      displayName: row.displayName,
      avatarId: row.avatarId,
      ts: now,
    })
  )

  return { ok: true, row }
}

function rowFromPg(r: any): ProfileRow {
  return {
    userId: r.user_id,
    displayName: r.display_name,
    displayNameLower: r.display_name_lower,
    displayNameChangedAt: r.display_name_changed_at
      ? new Date(r.display_name_changed_at).toISOString()
      : null,
    avatarId: r.avatar_id || '1',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
  }
}

/**
 * In-memory `PgLike` shim — used by the dev API route when DATABASE_URL
 * is unset, and by tests. Survives a single Node process; data is lost
 * across restarts (which is fine for a demo).
 */
export class MemoryPlayersStore implements PgLike {
  private byUser = new Map<string, ProfileRow>()
  private byLower = new Map<string, string>() // lower -> userId

  async query(text: string, values: unknown[] = []): Promise<{ rows: any[] }> {
    const v = values as any[]
    if (/SELECT[\s\S]+FROM players[\s\S]+WHERE user_id/i.test(text)) {
      const r = this.byUser.get(String(v[0]))
      return { rows: r ? [toPgShape(r)] : [] }
    }
    if (/INSERT INTO players/i.test(text)) {
      const [userId, displayName, lower, changedAt, avatarId, updatedAt] = v as [
        string, string, string, string, string, string
      ]
      const existing = this.byUser.get(userId)
      // Uniqueness — mimic the unique index.
      const ownerOfLower = this.byLower.get(lower)
      if (ownerOfLower && ownerOfLower !== userId) {
        const err = new Error('duplicate key value violates unique constraint "players_display_name_lower_uk"') as any
        err.code = '23505'
        throw err
      }
      const row: ProfileRow = {
        userId,
        displayName,
        displayNameLower: lower,
        displayNameChangedAt:
          existing && existing.displayNameLower === lower
            ? existing.displayNameChangedAt
            : changedAt,
        avatarId,
        createdAt: existing ? existing.createdAt : updatedAt,
        updatedAt,
      }
      if (existing && existing.displayNameLower !== lower) {
        this.byLower.delete(existing.displayNameLower)
      }
      this.byUser.set(userId, row)
      this.byLower.set(lower, userId)
      return { rows: [toPgShape(row)] }
    }
    throw new Error(`MemoryPlayersStore: unsupported query: ${text.slice(0, 80)}`)
  }
}

function toPgShape(r: ProfileRow) {
  return {
    user_id: r.userId,
    display_name: r.displayName,
    display_name_lower: r.displayNameLower,
    display_name_changed_at: r.displayNameChangedAt,
    avatar_id: r.avatarId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

/**
 * In-memory `RedisLike` shim — used by tests. Implements get/set/del/
 * publish/ttl with EX-second TTLs.
 */
export class MemoryRedis implements RedisLike {
  private data = new Map<string, { value: string; expiresAt: number | null }>()
  public published: Array<{ channel: string; message: string }> = []
  private nowFn: () => number

  constructor(nowFn?: () => number) {
    this.nowFn = nowFn || (() => Date.now())
  }

  private fresh(key: string) {
    const e = this.data.get(key)
    if (!e) return null
    if (e.expiresAt != null && this.nowFn() >= e.expiresAt) {
      this.data.delete(key)
      return null
    }
    return e
  }

  async get(key: string): Promise<string | null> {
    return this.fresh(key)?.value ?? null
  }
  async set(key: string, value: string, ...args: any[]): Promise<unknown> {
    let expiresAt: number | null = null
    for (let i = 0; i < args.length; i += 1) {
      if (String(args[i]).toUpperCase() === 'EX') {
        const sec = Number(args[i + 1])
        if (Number.isFinite(sec)) expiresAt = this.nowFn() + sec * 1000
      }
    }
    this.data.set(key, { value, expiresAt })
    return 'OK'
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0
    for (const k of keys) {
      if (this.data.delete(k)) n += 1
    }
    return n
  }
  async ttl(key: string): Promise<number> {
    const e = this.fresh(key)
    if (!e) return -2
    if (e.expiresAt == null) return -1
    return Math.max(0, Math.ceil((e.expiresAt - this.nowFn()) / 1000))
  }
  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message })
    return 1
  }
}
