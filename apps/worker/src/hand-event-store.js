'use strict';

/**
 * HandEventStore — the durable append-only stream of hand events.
 *
 * Production target: Neon Postgres. Local dev / unit tests use a
 * pure in-memory store so the worker can run with no external
 * dependencies.
 *
 *   appendEvent({ handId, seq, step, payload })
 *   loadEvents(handId, fromSeq) -> [{ handId, seq, step, payload, createdAt }]
 *   close()
 *
 * Decision: in-memory is the dev fallback rather than sqlite. Reason:
 * `better-sqlite3` requires native compilation (node-gyp + Xcode CLT)
 * which is fragile in CI and the dev macOS toolchain. Postgres is the
 * production path; tests don't need durability across processes
 * because the restart-correctness test seeds Redis (snapshot) and
 * the in-memory store before the second boot. Real Neon migration is
 * idempotent and tested manually.
 */

class PgHandEventStore {
  constructor(pool) {
    this.pool = pool;
  }

  async init() {
    // Idempotent — table is normally created by the Neon migration.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS hand_events (
        hand_id     TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        step        INTEGER NOT NULL,
        payload     JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (hand_id, seq)
      )
    `);
  }

  async appendEvent(ev) {
    await this.pool.query(
      `INSERT INTO hand_events (hand_id, seq, step, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (hand_id, seq) DO NOTHING`,
      [ev.handId, ev.seq, ev.step, ev.payload]
    );
  }

  async loadEvents(handId, fromSeq = 0) {
    const { rows } = await this.pool.query(
      `SELECT hand_id, seq, step, payload, created_at
         FROM hand_events
        WHERE hand_id = $1 AND seq >= $2
        ORDER BY seq ASC`,
      [handId, fromSeq]
    );
    return rows.map((r) => ({
      handId: r.hand_id,
      seq: r.seq,
      step: r.step,
      payload: r.payload,
      createdAt: r.created_at,
    }));
  }

  async close() {
    await this.pool.end();
  }
}

class MemoryHandEventStore {
  constructor() {
    /** @type {Map<string, Map<number, object>>} */
    this.byHand = new Map();
  }

  async init() {}

  async appendEvent(ev) {
    let m = this.byHand.get(ev.handId);
    if (!m) {
      m = new Map();
      this.byHand.set(ev.handId, m);
    }
    if (!m.has(ev.seq)) {
      m.set(ev.seq, {
        handId: ev.handId,
        seq: ev.seq,
        step: ev.step,
        payload: ev.payload,
        createdAt: new Date().toISOString(),
      });
    }
  }

  async loadEvents(handId, fromSeq = 0) {
    const m = this.byHand.get(handId);
    if (!m) return [];
    return [...m.values()]
      .filter((e) => e.seq >= fromSeq)
      .sort((a, b) => a.seq - b.seq);
  }

  async close() {}
}

/**
 * Factory: choose driver by environment.
 *   DATABASE_URL set    -> Postgres
 *   otherwise           -> in-memory (test default)
 */
async function createHandEventStore(opts = {}) {
  if (opts.driver === 'pg' || (opts.driver == null && process.env.DATABASE_URL)) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const pool = opts.pool || new Pool({
      connectionString: opts.connectionString || process.env.DATABASE_URL,
    });
    const store = new PgHandEventStore(pool);
    await store.init();
    return store;
  }
  const store = new MemoryHandEventStore();
  await store.init();
  return store;
}

module.exports = {
  PgHandEventStore,
  MemoryHandEventStore,
  createHandEventStore,
};
