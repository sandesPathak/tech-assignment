#!/usr/bin/env bash
# Stop everything started by scripts/play.sh.
set -u
cd "$(dirname "$0")/.."

echo "[stop] killing node processes"
# kill the concurrently parent and its descendants
if [ -f .logs/dev.pid ]; then
  pid="$(cat .logs/dev.pid)"
  # negative PID = whole process group
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
fi
if [ -f .logs/bots.pid ]; then
  pid="$(cat .logs/bots.pid)"
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
fi
pkill -f "node_modules/.bin/concurrently" 2>/dev/null || true
pkill -f "apps/worker/src/index.js" 2>/dev/null || true
pkill -f "apps/gateway/src/index.js" 2>/dev/null || true
pkill -f "apps/coach/src/index.js" 2>/dev/null || true
pkill -f "streaks-bridge/src/index.js" 2>/dev/null || true
pkill -f "next dev -p 3010" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "botswarm/src/seat-bots.js" 2>/dev/null || true
pkill -f "botswarm/src/runner.js" 2>/dev/null || true
sleep 1
# nuclear fallback for any survivors
for port in 3001 3002 3010; do
  pids="$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "[stop]   force-killing :$port → $pids"
    kill -9 $pids 2>/dev/null || true
  fi
done
rm -f .logs/dev.pid .logs/bots.pid 2>/dev/null || true

echo "[stop] stopping docker compose stack"
docker compose --profile streaks down 2>/dev/null || true

echo "[stop] stopping hp-redis / hp-pg"
docker stop hp-redis 2>/dev/null || true
docker stop hp-pg 2>/dev/null || true

echo "[stop] done."
