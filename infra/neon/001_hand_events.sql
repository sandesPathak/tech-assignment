-- Hijack Poker — hand events (durable append-only stream).
--
-- Every state-machine tick that mutates a hand writes one row.
-- (hand_id, seq) is the natural composite primary key; replay,
-- coach analysis, spectator catch-up, and clip features all read
-- from this table.
--
-- hand_id format: `${tableId}:${gameNo}` (ASCII, short).
-- payload schema is owned by the worker, intentionally JSONB for
-- forward-compat as the engine grows side-pot, run-it-twice, etc.
--
-- Run once against a fresh Neon database:
--   psql "$DATABASE_URL" -f infra/neon/001_hand_events.sql

CREATE TABLE IF NOT EXISTS hand_events (
  hand_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  step        INTEGER NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, seq)
);

-- Coach + replay tools usually want the latest hands by table; we
-- index by (hand_id, created_at) under the assumption the caller
-- already knows which table/hand they want.
CREATE INDEX IF NOT EXISTS hand_events_hand_idx
  ON hand_events (hand_id, seq);
