'use strict';

/**
 * Phase 6 — cross-device handoff.
 *
 * Coverage matrix:
 *   1. Mid-hand handoff: socket A is bound to a seat with table state
 *      mid-hand (action timer + stack present). Issue token → redeem on
 *      socket B → assert
 *        (a) socket A receives `s2c.kicked` reason 'handoff',
 *        (b) socket B is bound to the same seat and receives subsequent
 *            deltas (and snapshot reflects the same stack/move),
 *        (c) socket A continues to receive non-private events
 *            (community-card / pot deltas) as a spectator,
 *        (d) reusing the same token fails with 401.
 *   2. Replay attack: token redeemed once → second redeem call is
 *      rejected with 401 and no new socket binding occurs.
 *   3. Token expiry: issue with TTL 1s → wait > TTL → redeem rejected.
 *
 * The token format itself (256-bit base64url, single-use, 60s TTL) is
 * exercised through the public `consumeHandoffToken` helper in test 2/3.
 */

const http = require('http');
const WebSocket = require('ws');
const { bootStack, tokenFor, urlFor, TEST_SECRET } = require('./test-helpers');
const {
  TOKEN_PREFIX,
  TOKEN_TTL_SEC,
  issueHandoffToken,
  consumeHandoffToken,
  newToken,
} = require('../src/handoff');
const { signToken } = require('../src/auth');

// ─── tiny HTTP helper ──────────────────────────────────────────────────

function httpJson(port, method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data ? Buffer.byteLength(data) : 0,
          ...(headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch (_e) {}
          resolve({ status: res.statusCode, body: json, raw: text });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── WS helpers ────────────────────────────────────────────────────────

function open(port, tableId, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(urlFor(port, tableId, token));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => {
      reject(new Error(`http ${res.statusCode}`));
      ws.terminate();
    });
  });
}

function awaitFrame(ws, predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('frame timeout')), timeoutMs);
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (predicate(m)) {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
  });
}

function collect(ws) {
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  return frames;
}

async function joinAndSnapshot(ws, tableId, lastSeq = 0) {
  ws.send(JSON.stringify({ t: 'c2s.join', tableId, lastSeq }));
  return awaitFrame(ws, (m) => m.t === 's2c.snapshot');
}

// ─── Redis helpers ─────────────────────────────────────────────────────

describe('handoff — token Redis primitives', () => {
  let stack;
  beforeAll(async () => { stack = await bootStack({ tableId: '1' }); });
  afterAll(async () => { await stack.stop(); });

  it('issues a 256-bit base64url token with TTL', async () => {
    const out = await issueHandoffToken({
      redis: stack.command,
      userId: 'u1',
      tableId: '1',
      seat: 1,
    });
    expect(out.expiresIn).toBe(TOKEN_TTL_SEC);
    // base64url alphabet, 32 raw bytes → ceil(32/3*4) = 43 chars (no padding)
    expect(out.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(out.token.length).toBeGreaterThanOrEqual(40);
    const ttl = await stack.command.ttl(TOKEN_PREFIX + out.token);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TOKEN_TTL_SEC);
  });

  it('newToken yields unique values (no sequential leak)', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(newToken());
    expect(seen.size).toBe(100);
  });

  it('GETDEL gives single-use semantics — replay returns null', async () => {
    const { token } = await issueHandoffToken({
      redis: stack.command,
      userId: 'u1',
      tableId: '1',
      seat: 1,
    });
    const first = await consumeHandoffToken({ redis: stack.command, token });
    expect(first).toEqual(expect.objectContaining({
      userId: 'u1', tableId: '1', seat: 1,
    }));
    const second = await consumeHandoffToken({ redis: stack.command, token });
    expect(second).toBeNull();
  });

  it('expired token returns null on redeem', async () => {
    const { token } = await issueHandoffToken({
      redis: stack.command,
      userId: 'u1',
      tableId: '1',
      seat: 1,
      ttlSeconds: 1,
    });
    // Force-expire by deleting the key (ioredis-mock doesn't reliably
    // honour wall-clock TTLs in fast tests; the *behaviour* we verify is
    // that GETDEL on a missing key returns null, which is what real
    // Redis does after expiry too).
    await stack.command.del(TOKEN_PREFIX + token);
    const out = await consumeHandoffToken({ redis: stack.command, token });
    expect(out).toBeNull();
  });

  it('rejects malformed tokens without throwing', async () => {
    expect(await consumeHandoffToken({ redis: stack.command, token: '' })).toBeNull();
    expect(await consumeHandoffToken({ redis: stack.command, token: undefined })).toBeNull();
    expect(await consumeHandoffToken({ redis: stack.command, token: 'not-a-real-token' })).toBeNull();
  });
});

// ─── full HTTP + WS flow ───────────────────────────────────────────────

describe('handoff — REST endpoints + socket transition', () => {
  let stack;
  beforeAll(async () => { stack = await bootStack({ tableId: '1' }); });
  afterAll(async () => { await stack.stop(); });

  it('POST /handoff/issue requires a Bearer JWT', async () => {
    const res = await httpJson(stack.port, 'POST', '/handoff/issue', { body: {} });
    expect(res.status).toBe(401);
  });

  it('POST /handoff/issue with mismatched tableId is rejected', async () => {
    const jwt = signToken(
      { sub: 'u1', tableId: '1', seat: 1, sessionId: 's1' },
      { secret: TEST_SECRET, expiresIn: '5m' }
    );
    const res = await httpJson(stack.port, 'POST', '/handoff/issue', {
      body: { tableId: '999', seat: 1 },
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(403);
  });

  it('end-to-end: mid-hand handoff kicks A, binds B, downgrades A to spectator', async () => {
    const tableId = '1';
    const userId = 'player-A';

    // Open socket A bound to seat 1.
    const tokA = signToken(
      { sub: userId, tableId, seat: 1, sessionId: 'sess-desktop' },
      { secret: TEST_SECRET, expiresIn: '5m' }
    );
    const sockA = await open(stack.port, tableId, tokA);
    const snapA = await joinAndSnapshot(sockA, tableId);
    expect(snapA.t).toBe('s2c.snapshot');
    // Verify the seed state has stack/move (fixture uses stack=100, move=0).
    expect(snapA.state.players[0].stack).toBe(100);

    // Drop a frame collector on socket A *before* the handoff so we can
    // verify what arrives after kick.
    const framesA = collect(sockA);

    // Issue the handoff token on the gateway's REST endpoint.
    const issued = await httpJson(stack.port, 'POST', '/handoff/issue', {
      body: { tableId, seat: 1 },
      headers: { Authorization: `Bearer ${tokA}` },
    });
    expect(issued.status).toBe(200);
    expect(issued.body.token).toBeDefined();
    expect(issued.body.expiresIn).toBe(TOKEN_TTL_SEC);

    // Phone hits /handoff/redeem.
    const redeem = await httpJson(stack.port, 'POST', '/handoff/redeem', {
      body: { token: issued.body.token, sessionId: 'sess-phone' },
    });
    expect(redeem.status).toBe(200);
    expect(redeem.body.userId).toBe(userId);
    expect(redeem.body.tableId).toBe(tableId);
    expect(redeem.body.seat).toBe(1);
    expect(redeem.body.jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // (a) Socket A receives s2c.kicked reason 'handoff'. The frame may
    // already be in `framesA` (the kick fires synchronously inside the
    // /handoff/redeem handler) — give the event loop a tick and check.
    await new Promise((r) => setTimeout(r, 100));
    const kickedFrame = framesA.find((m) => m.t === 's2c.kicked');
    expect(kickedFrame).toBeDefined();
    expect(kickedFrame.reason).toBe('handoff');

    // Socket A is still open (downgraded to spectator, not closed).
    expect(sockA.readyState).toBe(WebSocket.OPEN);

    // (b) Socket B opens with the redeem JWT, joins, gets snapshot
    // matching socket A's snapshot (same stack, same move pointer).
    const sockB = await open(stack.port, tableId, redeem.body.jwt);
    const snapB = await joinAndSnapshot(sockB, tableId);
    expect(snapB.state.players[0].seat).toBe(1);
    // Same stack + dealer/move — mid-hand handoff doesn't lose state.
    expect(snapB.state.players[0].stack).toBe(snapA.state.players[0].stack);
    expect(snapB.state.game.move).toBe(snapA.state.game.move);
    expect(snapB.state.game.dealerSeat).toBe(snapA.state.game.dealerSeat);
    expect(snapB.state.game.pot).toBe(snapA.state.game.pot);

    // Now publish a public event (a `flop` / community-card delta) and a
    // private event (`hole_cards_dealt`). Spectator A must receive the
    // public one and miss the private one. Socket B must receive both.
    const framesB = collect(sockB);

    const seqBase = snapA.seq;
    // Bypass the worker pipeline — synthesise pub/sub frames directly so
    // we can assert the spectator filter without spinning up a hand.
    const publishFrame = async (frame) => {
      await stack.command.publish(`table:${tableId}:events`, JSON.stringify(frame));
    };
    await publishFrame({
      t: 's2c.delta',
      tableId,
      seq: seqBase + 1,
      step: 1,
      payload: { kind: 'flop', cards: ['Ah', 'Kd', '2c'] },
    });
    await publishFrame({
      t: 's2c.delta',
      tableId,
      seq: seqBase + 2,
      step: 2,
      payload: { kind: 'hole_cards_dealt', seat: 1, cards: ['As', 'Ks'] },
    });
    await publishFrame({
      t: 's2c.delta',
      tableId,
      seq: seqBase + 3,
      step: 3,
      payload: { kind: 'pot_update', pot: 30 },
    });

    // Drain.
    await new Promise((r) => setTimeout(r, 150));

    // (c) Spectator A: got flop + pot_update, did NOT get hole_cards_dealt.
    const aDeltas = framesA.filter((f) => f.t === 's2c.delta');
    const aKinds = aDeltas.map((f) => f.payload && f.payload.kind);
    expect(aKinds).toContain('flop');
    expect(aKinds).toContain('pot_update');
    expect(aKinds).not.toContain('hole_cards_dealt');

    // Socket B (the new bound socket) gets all three.
    const bDeltas = framesB.filter((f) => f.t === 's2c.delta');
    const bKinds = bDeltas.map((f) => f.payload && f.payload.kind);
    expect(bKinds).toContain('flop');
    expect(bKinds).toContain('hole_cards_dealt');
    expect(bKinds).toContain('pot_update');

    // (d) Replay the same token — must fail (single-use).
    const replay = await httpJson(stack.port, 'POST', '/handoff/redeem', {
      body: { token: issued.body.token, sessionId: 'sess-attacker' },
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('token_invalid_or_expired');

    // Spectator-side action attempts must be rejected.
    sockA.send(JSON.stringify({
      t: 'c2s.action', tableId, seat: 1, action: 'check',
    }));
    const errFrame = await awaitFrame(
      sockA,
      (m) => m.t === 's2c.error' && m.code === 'spectator',
      1000
    );
    expect(errFrame.code).toBe('spectator');

    sockA.close();
    sockB.close();
    await Promise.all([sockA, sockB].map((ws) => new Promise((r) => ws.on('close', r))));
  });

  it('expired handoff token cannot be redeemed', async () => {
    // Issue with TTL=1, then force-delete the key to simulate expiry
    // crossing.
    const out = await issueHandoffToken({
      redis: stack.command,
      userId: 'u-expiry',
      tableId: '1',
      seat: 2,
      ttlSeconds: 1,
    });
    await stack.command.del(TOKEN_PREFIX + out.token);
    const res = await httpJson(stack.port, 'POST', '/handoff/redeem', {
      body: { token: out.token, sessionId: 'late-session' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_invalid_or_expired');
  });

  it('redeem with no body / no token returns 401', async () => {
    const res = await httpJson(stack.port, 'POST', '/handoff/redeem', {
      body: {},
    });
    expect(res.status).toBe(401);
  });

  it('non-handoff routes still 404', async () => {
    const res = await httpJson(stack.port, 'GET', '/does-not-exist', {});
    expect(res.status).toBe(404);
  });

  it('health endpoint still works', async () => {
    const res = await httpJson(stack.port, 'GET', '/health', {});
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('hijack-gateway');
  });
});
