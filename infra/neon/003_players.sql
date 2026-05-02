-- Hijack Poker — players profile table.
--
-- Stores the small slice of profile data we need to render seat plates
-- and the /profile page: avatar id (1..24, refs apps/web/public/avatars),
-- display name, and the last-changed timestamp used to enforce the
-- "1 change per 7 days" rate limit. The server-side rate limit is
-- enforced via Redis (low-latency); this column is for audit + a
-- defence-in-depth check when Redis is cold.
--
-- Uniqueness on `display_name_lower` is the durable constraint. Phase 5
-- also keeps a Redis sentinel `name:taken:<lower>` for fast checks
-- without a DB round-trip, but Postgres is the source of truth.
--
-- Run once against a fresh Neon database:
--   psql "$DATABASE_URL" -f infra/neon/003_players.sql

CREATE TABLE IF NOT EXISTS players (
  user_id                   TEXT PRIMARY KEY,
  display_name              TEXT NOT NULL,
  display_name_lower        TEXT NOT NULL,
  display_name_changed_at   TIMESTAMPTZ,
  avatar_id                 TEXT NOT NULL DEFAULT '1',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on display_name. Two users can't share
-- the same handle even with different casing.
CREATE UNIQUE INDEX IF NOT EXISTS players_display_name_lower_uk
  ON players (display_name_lower);

-- Touch updated_at on every UPDATE so we can audit recent profile churn.
CREATE OR REPLACE FUNCTION players_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS players_touch_trigger ON players;
CREATE TRIGGER players_touch_trigger
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION players_touch_updated_at();
