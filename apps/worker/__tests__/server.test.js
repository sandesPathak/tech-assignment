'use strict';

/**
 * HTTP /process smoke test — preserves parity with the legacy
 * holdem-processor handler. 16+ POSTs to /process should complete
 * one hand and report `handDone: true`.
 */

const request = require('supertest');
const { createServer } = require('../src/server');
const { makeStore, makeInitialState } = require('./test-helpers');
const { ACTION } = require('@hijack/engine');

describe('HTTP /process', () => {
  let agent;
  let stateStore;
  let server;

  beforeAll(async () => {
    ({ stateStore } = makeStore());
    await stateStore.initTable(1, makeInitialState());
    server = createServer({ stateStore });
    agent = request(server);
  });

  afterAll(() => {
    if (server.listening) server.close();
  });

  it('GET /health responds ok', async () => {
    const res = await agent.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /process drives a hand to completion', async () => {
    let lastBody;
    for (let i = 0; i < 40; i++) {
      let res = await agent.post('/process').send({ tableId: 1 });
      expect(res.status).toBe(200);
      if (res.body.status === 'awaiting_action') {
        // Read state, build action.
        const state = await stateStore.loadTable(1);
        const seat = state.game.move;
        const p = state.players.find((x) => x.seat === seat);
        const owed = state.game.currentBet - (p.bet || 0);
        const action = owed > 0 ? ACTION.CALL : ACTION.CHECK;
        const amount = owed > 0 ? state.game.currentBet : 0;
        res = await agent.post('/process').send({ tableId: 1, seat, action, amount });
        expect(res.status).toBe(200);
      }
      lastBody = res.body;
      if (lastBody.handDone) break;
    }
    expect(lastBody.handDone).toBe(true);
  });

  it('GET /metrics returns footprint', async () => {
    const res = await agent.get('/metrics?tableId=1');
    expect(res.status).toBe(200);
    expect(res.body.bytes).toBeGreaterThan(0);
    expect(res.body.bytes).toBeLessThan(50_000);
  });

  it('POST /process for unknown table returns 404', async () => {
    const res = await agent.post('/process').send({ tableId: 999 });
    expect(res.status).toBe(404);
  });
});
