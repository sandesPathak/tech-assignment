// clients.ts — server-only Redis + Postgres client factories. Lazy +
// memoized so the Next.js dev server doesn't spin up a fresh pool per
// hot reload, and so the build doesn't fail when DATABASE_URL /
// REDIS_URL are absent (we fall back to in-memory shims).
//
// Phase 5 follows the same pattern Phase 4 used in
// `apps/gateway/src/coach-api.js`: lazy-require the optional `pg` /
// `ioredis` modules so the test harness can run without them.

import { MemoryPlayersStore, MemoryRedis, type PgLike, type RedisLike } from './store'

let _redis: RedisLike | null = null
let _pg: PgLike | null = null
let _initLogged = false

export function getRedis(): RedisLike {
  if (_redis) return _redis
  const url = process.env.REDIS_URL
  if (url) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Redis = require('ioredis')
      _redis = new Redis(url) as unknown as RedisLike
      if (!_initLogged) {
        // eslint-disable-next-line no-console
        console.info('[profile] redis client connected')
        _initLogged = true
      }
      return _redis as RedisLike
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[profile] ioredis unavailable, using memory shim:', (err as Error).message)
    }
  }
  _redis = new MemoryRedis()
  return _redis
}

export function getPg(): PgLike | null {
  if (_pg) return _pg
  const url = process.env.DATABASE_URL
  if (url) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Pool } = require('pg')
      const pool = new Pool({ connectionString: url })
      _pg = pool as unknown as PgLike
      return _pg
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[profile] pg unavailable, using memory shim:', (err as Error).message)
    }
  }
  _pg = new MemoryPlayersStore()
  return _pg
}

/** Test seam — replace clients with deterministic doubles. */
export function __setClients(redis: RedisLike | null, pg: PgLike | null) {
  _redis = redis
  _pg = pg
}
