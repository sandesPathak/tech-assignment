'use strict';

/**
 * repo.js — persistence for `hand_analysis`.
 *
 * Production target: Neon Postgres. Local/test fallback: in-memory.
 * Schema mirrors `infra/neon/002_hand_analysis.sql`.
 */

class PgAnalysisStore {
  constructor(pool) { this.pool = pool; }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS hand_analysis (
        hand_id     TEXT NOT NULL,
        hero        TEXT NOT NULL,
        situation_hash TEXT NOT NULL,
        findings    JSONB NOT NULL,
        prose       JSONB NOT NULL,
        token_usage JSONB,
        cache_hit   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (hand_id, hero)
      )
    `);
  }

  async insert(row) {
    await this.pool.query(
      `INSERT INTO hand_analysis (hand_id, hero, situation_hash, findings, prose, token_usage, cache_hit)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (hand_id, hero) DO UPDATE
         SET findings    = EXCLUDED.findings,
             prose       = EXCLUDED.prose,
             token_usage = EXCLUDED.token_usage,
             cache_hit   = EXCLUDED.cache_hit`,
      [row.hand_id, row.hero, row.situation_hash, row.findings, row.prose, row.token_usage || null, !!row.cache_hit]
    );
  }

  async get(handId, hero) {
    const { rows } = await this.pool.query(
      `SELECT * FROM hand_analysis WHERE hand_id = $1 AND hero = $2`,
      [handId, hero]
    );
    return rows[0] || null;
  }

  async close() { await this.pool.end(); }
}

class MemoryAnalysisStore {
  constructor() { this.rows = new Map(); }
  async init() {}
  async insert(row) {
    this.rows.set(`${row.hand_id}|${row.hero}`, { ...row });
  }
  async get(handId, hero) {
    return this.rows.get(`${handId}|${hero}`) || null;
  }
  async close() {}
}

async function createAnalysisStore(opts = {}) {
  if (opts.driver === 'pg' || (opts.driver == null && process.env.DATABASE_URL)) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const pool = opts.pool || new Pool({
      connectionString: opts.connectionString || process.env.DATABASE_URL,
    });
    const store = new PgAnalysisStore(pool);
    await store.init();
    return store;
  }
  const store = new MemoryAnalysisStore();
  await store.init();
  return store;
}

module.exports = {
  PgAnalysisStore,
  MemoryAnalysisStore,
  createAnalysisStore,
};
