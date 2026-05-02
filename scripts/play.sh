#!/usr/bin/env bash
# One-command launcher: brings up all infra (docker), runs migrations,
# starts the new poker stack, and seats bots so a hand actually deals.
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Sane defaults if the .env is missing values
export GATEWAY_JWT_SECRET="${GATEWAY_JWT_SECRET:-test-secret-do-not-use-in-prod}"
export JWT_SIGNING_SECRET="${JWT_SIGNING_SECRET:-$GATEWAY_JWT_SECRET}"
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:dev@localhost:5432/hijack}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export STREAKS_API_URL="${STREAKS_API_URL:-http://localhost:5001}"
export GATEWAY_SATURATION_PCT="${GATEWAY_SATURATION_PCT:-99}"
export MYSQL_EXTERNAL_PORT="${MYSQL_EXTERNAL_PORT:-3307}"
export STAKE="${STAKE:-1-2}"
export BOTS="${BOTS:-3}"

mkdir -p .logs

echo "[play] killing previous node processes (worker / gateway / coach / web / bridge / bots)"
pkill -f "apps/worker/src/index.js" 2>/dev/null || true
pkill -f "apps/gateway/src/index.js" 2>/dev/null || true
pkill -f "apps/coach/src/index.js" 2>/dev/null || true
pkill -f "streaks-bridge" 2>/dev/null || true
pkill -f "next dev -p 3010" 2>/dev/null || true
pkill -f "botswarm" 2>/dev/null || true
pkill -f "seat-bots" 2>/dev/null || true
sleep 1

# ── 1. infra: redis + postgres (lightweight, raw docker run) ─────────────
echo "[play] ensuring redis (hp-redis) and postgres (hp-pg) are up"
if ! docker ps --format '{{.Names}}' | grep -q '^hp-redis$'; then
  docker run -d --rm --name hp-redis -p 6379:6379 redis:7-alpine >/dev/null
fi
if ! docker ps --format '{{.Names}}' | grep -q '^hp-pg$'; then
  docker run -d --rm --name hp-pg -p 5432:5432 \
    -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=hijack \
    postgres:16-alpine >/dev/null
fi

echo "[play] waiting for postgres to accept connections"
for _ in $(seq 1 30); do
  if docker exec hp-pg pg_isready -U postgres -d hijack >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "[play] running neon migrations (idempotent)"
for f in infra/neon/001_hand_events.sql infra/neon/002_hand_analysis.sql infra/neon/003_players.sql; do
  if [ -f "$f" ]; then
    docker exec -i hp-pg psql -U postgres -d hijack < "$f" >/dev/null 2>&1 || \
    docker exec -i hp-pg psql -U postgres -d hijack < "$f" || true
  fi
done

# ── 2. legacy streaks stack (compose: streaks-api + dynamodb) ─────────────
echo "[play] bringing up streaks-api + dynamodb (docker compose --profile streaks)"
# kill the compose-managed redis to avoid 6379 conflict with hp-redis
docker compose --profile streaks up -d streaks-api streaks-frontend dynamodb-local dynamodb-init >/dev/null 2>&1 || \
docker compose --profile streaks up -d >/dev/null 2>&1 || true

echo "[play] flushing redis (clear stale lobby/seats from prior runs)"
docker exec -i hp-redis redis-cli FLUSHALL >/dev/null 2>&1 || true

# ── 3. dev stack ──────────────────────────────────────────────────────────
echo "[play] launching dev stack (logs in .logs/dev.log)"
nohup npm run dev > .logs/dev.log 2>&1 &
echo "$!" > .logs/dev.pid

echo "[play] waiting for gateway :3002 ..."
for _ in $(seq 1 60); do
  if lsof -nP -iTCP:3002 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "[play] waiting for web :3010 ..."
for _ in $(seq 1 60); do
  if lsof -nP -iTCP:3010 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  sleep 1
done

# ── 4. seat bots so hands actually deal ──────────────────────────────────
echo "[play] seating $BOTS bots at stake=$STAKE (your hero takes the last seat)"
nohup node apps/botswarm/src/seat-bots.js \
  --http=http://127.0.0.1:3002 \
  --gateway=ws://127.0.0.1:3002 \
  --stake="$STAKE" \
  --bots="$BOTS" \
  --idPrefix=bot-12 \
  > .logs/bots.log 2>&1 &
echo "$!" > .logs/bots.pid

# Spectator-only tables: fill 5-10 and 25-50 with bots so the lobby
# has live tables to watch even when you're not playing.
echo "[play] seating bots at 5-10 + 25-50 (for spectating)"
(
  sleep 2
  node apps/botswarm/src/seat-bots.js \
    --http=http://127.0.0.1:3002 --gateway=ws://127.0.0.1:3002 \
    --stake=5-10 --bots=5 --idPrefix=bot-510 \
  || true
) > .logs/bots-510.log 2>&1 &
(
  sleep 4
  node apps/botswarm/src/seat-bots.js \
    --http=http://127.0.0.1:3002 --gateway=ws://127.0.0.1:3002 \
    --stake=25-50 --bots=6 --idPrefix=bot-2550 \
  || true
) > .logs/bots-2550.log 2>&1 &

cat <<EOF

[play] up.
  Streaks dashboard:  http://localhost:4001         (login → Play)
  New poker (direct): http://localhost:3010
  Streaks API:        http://localhost:5001/api/v1/health

  dev log:   tail -f .logs/dev.log
  bots log:  tail -f .logs/bots.log

  stop with:  npm run stop:play

EOF
