-- Hijack Poker — hand analysis (post-hand AI coach output).
--
-- One row per (hand_id, hero). Findings are the structured EV-analysis
-- output; prose is the Claude-Haiku-generated coaching language.
-- token_usage records cache hits/writes for cost tracking.
--
-- Run once against a fresh Neon database:
--   psql "$DATABASE_URL" -f infra/neon/002_hand_analysis.sql

CREATE TABLE IF NOT EXISTS hand_analysis (
  hand_id        TEXT NOT NULL,
  hero           TEXT NOT NULL,
  situation_hash TEXT NOT NULL,
  findings       JSONB NOT NULL,
  prose          JSONB NOT NULL,
  token_usage    JSONB,
  cache_hit      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, hero)
);

-- Coach panel reads by `(hero, created_at DESC)` to show most recent
-- analyses; situation_hash powers cross-hand "spots like this" lookup.
CREATE INDEX IF NOT EXISTS hand_analysis_hero_idx
  ON hand_analysis (hero, created_at DESC);

CREATE INDEX IF NOT EXISTS hand_analysis_situation_idx
  ON hand_analysis (situation_hash);
