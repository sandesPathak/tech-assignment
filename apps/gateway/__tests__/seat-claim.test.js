'use strict';

/**
 * Atomic seat claim — the contract test from PHASE-03.
 *
 * 100 concurrent claim attempts target a 6-seat table; exactly the seat
 * count must succeed and the rest must report "taken". This is the only
 * defense against double-seating in production, so any non-atomic
 * regression of the Lua script needs to break this test.
 */

const RedisMock = require('ioredis-mock');
const { SeatClaimer } = require('../src/seat-claim');

const SECRET = 'test-secret-do-not-use-in-prod';
const STAKE = '1-2';
const TABLE_ID = 'demo-table-1';
const MAX_SEATS = 6;

async function bootRedisWithTable(tableId = TABLE_ID) {
  const redis = new RedisMock();
  await redis.flushall();
  await redis.hset(
    `table:${tableId}:meta`,
    'maxSeats', String(MAX_SEATS),
    'stake', STAKE,
    'lastActivityMs', '0',
  );
  await redis.zadd(`lobby:${STAKE}:tables`, MAX_SEATS, tableId);
  return redis;
}

describe('SeatClaimer (Lua atomic claim)', () => {
  test('100 concurrent claims for 6 seats → 6 succeed, 94 fail with "taken"', async () => {
    const redis = await bootRedisWithTable();
    const claimer = new SeatClaimer({ redis, secret: SECRET });
    await claimer.load();

    // 100 concurrent users, each picks a *random* seat in [1..6]. Some
    // pick the same seat — the only way to get exactly 6 winners is for
    // every seat to be claimed at least once. Drive that by giving each
    // seat number to ~17 distinct users so contention is intense.
    const attempts = [];
    for (let i = 0; i < 100; i += 1) {
      const seat = (i % MAX_SEATS) + 1;
      const userId = `u-${i}`;
      attempts.push(
        claimer.claim({
          stake: STAKE,
          tableId: TABLE_ID,
          seat,
          userId,
        })
      );
    }
    const results = await Promise.all(attempts);

    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(MAX_SEATS);
    expect(losses).toHaveLength(100 - MAX_SEATS);

    for (const l of losses) {
      expect(l.reason).toBe('taken');
    }

    // Every seat should be filled by exactly one user.
    const seatsTaken = await redis.hgetall(`table:${TABLE_ID}:seats`);
    expect(Object.keys(seatsTaken)).toHaveLength(MAX_SEATS);
    const userIds = new Set(Object.values(seatsTaken).map((v) => v.split('|')[0]));
    expect(userIds.size).toBe(MAX_SEATS);

    // Lobby ZSET reflects 0 open seats now.
    const open = await redis.zscore(`lobby:${STAKE}:tables`, TABLE_ID);
    expect(Number(open)).toBe(0);
  });

  test('idempotency — same (userId,token) returns success twice without re-claiming', async () => {
    const redis = await bootRedisWithTable();
    const claimer = new SeatClaimer({ redis, secret: SECRET });
    await claimer.load();
    const args = { stake: STAKE, tableId: TABLE_ID, seat: 2, userId: 'u-rep', reservationToken: 'tok-rep' };

    const r1 = await claimer.claim(args);
    expect(r1.ok).toBe(true);
    const r2 = await claimer.claim(args);
    expect(r2.ok).toBe(true);
    // openSeats unchanged between r1 and r2 — idempotency means seat
    // count is computed once.
    expect(r1.openSeats).toBe(r2.openSeats);
    const open = await redis.zscore(`lobby:${STAKE}:tables`, TABLE_ID);
    expect(Number(open)).toBe(MAX_SEATS - 1);
  });

  test('claim against unknown table returns no_table', async () => {
    const redis = new RedisMock();
    const claimer = new SeatClaimer({ redis, secret: SECRET });
    await claimer.load();
    const r = await claimer.claim({ stake: STAKE, tableId: 'nope', seat: 1, userId: 'u' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_table');
  });

  test('claim with bad seat number returns bad_seat', async () => {
    const redis = await bootRedisWithTable();
    const claimer = new SeatClaimer({ redis, secret: SECRET });
    await claimer.load();
    const tooHigh = await claimer.claim({ stake: STAKE, tableId: TABLE_ID, seat: 99, userId: 'u' });
    const zero = await claimer.claim({ stake: STAKE, tableId: TABLE_ID, seat: 0, userId: 'u' });
    expect(tooHigh.reason).toBe('bad_seat');
    expect(zero.reason).toBe('bad_seat');
  });

  test('expired reservation may be re-claimed', async () => {
    const redis = await bootRedisWithTable();
    const claimer = new SeatClaimer({
      redis,
      secret: SECRET,
      reservationTtlMs: 50,
    });
    await claimer.load();
    const r1 = await claimer.claim({ stake: STAKE, tableId: TABLE_ID, seat: 4, userId: 'u-first' });
    expect(r1.ok).toBe(true);
    await new Promise((res) => setTimeout(res, 60));
    const r2 = await claimer.claim({ stake: STAKE, tableId: TABLE_ID, seat: 4, userId: 'u-second' });
    expect(r2.ok).toBe(true);
  });

  test('verifyJoinToken parses the JWT minted by claim()', async () => {
    const redis = await bootRedisWithTable();
    const claimer = new SeatClaimer({ redis, secret: SECRET });
    await claimer.load();
    const r = await claimer.claim({ stake: STAKE, tableId: TABLE_ID, seat: 5, userId: 'u-vt' });
    expect(r.ok).toBe(true);
    const claims = claimer.verifyJoinToken(r.joinToken);
    expect(claims.sub).toBe('u-vt');
    expect(claims.tableId).toBe(TABLE_ID);
    expect(claims.seat).toBe(5);
    expect(claims.reservationToken).toBe(r.reservationToken);
  });
});
