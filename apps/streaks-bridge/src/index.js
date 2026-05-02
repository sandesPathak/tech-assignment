'use strict';

/**
 * streaks-bridge — bridges the new real-time poker stack into the
 * legacy Daily Streaks product.
 *
 *   apps/worker  --PUBLISH hand:completed-->  Redis
 *                                              |
 *                                              v
 *                                       streaks-bridge  (this process)
 *                                              |
 *                                  POST /internal/streaks/hand-completed
 *                                              v
 *                                      serverless-v2/streaks-api
 *
 * Contract: the worker publishes
 *   { handId, tableId, gameNo, completedAt, players: [{seat, playerId}] }
 * For each non-bot playerId we POST one streak update. Best-effort —
 * a missed publish only delays the streak; the user can still play
 * another hand.
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const STREAKS_API_URL = process.env.STREAKS_API_URL || 'http://localhost:5001';
const CHANNEL = 'hand:completed';

function isHumanPlayer(playerId) {
  if (!playerId) return false;
  // Bots are minted as `bot-NNNNN` by apps/botswarm/src/runner.js.
  if (playerId.startsWith('bot-')) return false;
  return true;
}

async function postStreakUpdate({ playerId, tableId, handId, completedAt }) {
  const url = `${STREAKS_API_URL}/internal/streaks/hand-completed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, tableId: String(tableId), handId, completedAt }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`streaks-api ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    console.log(JSON.stringify({ event: 'bridge_bad_json', err: err.message }));
    return;
  }
  const { handId, tableId, completedAt, players } = msg;
  if (!Array.isArray(players) || players.length === 0) {
    console.log(JSON.stringify({ event: 'bridge_no_players', handId }));
    return;
  }

  const humans = players.map((p) => p.playerId).filter(isHumanPlayer);
  if (humans.length === 0) {
    console.log(JSON.stringify({ event: 'bridge_skip_all_bots', handId, count: players.length }));
    return;
  }

  await Promise.all(
    humans.map(async (playerId) => {
      try {
        await postStreakUpdate({
          playerId,
          tableId,
          handId,
          completedAt: completedAt || new Date().toISOString(),
        });
        console.log(JSON.stringify({ event: 'bridge_streak_updated', playerId, handId }));
      } catch (err) {
        console.log(JSON.stringify({ event: 'bridge_streak_failed', playerId, handId, err: err.message }));
      }
    })
  );
}

async function main() {
  const sub = new Redis(REDIS_URL);
  await sub.subscribe(CHANNEL);
  sub.on('message', (channel, raw) => {
    if (channel === CHANNEL) handleMessage(raw);
  });
  console.log(JSON.stringify({
    event: 'bridge_started',
    redis: REDIS_URL,
    streaksApi: STREAKS_API_URL,
    channel: CHANNEL,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { handleMessage, isHumanPlayer };
