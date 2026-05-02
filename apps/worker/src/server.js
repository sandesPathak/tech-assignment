'use strict';

const http = require('http');
const { processTable } = require('./tick');

/**
 * Tiny HTTP server — only `/process` and `/health`. We deliberately
 * avoid Express to keep cold-start memory low (this thing runs on a
 * Fly 256MB shared-cpu-1x).
 *
 *   POST /process { tableId, seat?, action?, amount? }
 *   GET  /health
 *   GET  /metrics?tableId=N
 */
function createServer({ stateStore, publisher }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return json(res, 200, { service: 'hijack-worker', status: 'ok' });
      }

      if (req.method === 'GET' && req.url.startsWith('/metrics')) {
        const url = new URL(req.url, 'http://x');
        const tableId = url.searchParams.get('tableId');
        if (!tableId) return json(res, 400, { error: 'tableId required' });
        const bytes = await stateStore.measureFootprint(tableId);
        const tail = await stateStore.eventTailLength(tableId);
        return json(res, 200, { tableId, bytes, eventTail: tail });
      }

      if (req.method === 'POST' && req.url === '/process') {
        const body = await readJson(req);
        const tableId = body.tableId;
        if (!tableId) return json(res, 400, { error: 'tableId required' });
        const playerAction = (body.seat != null && body.action)
          ? { seat: body.seat, action: body.action, amount: body.amount || 0 }
          : undefined;
        const result = await processTable(stateStore, tableId, playerAction, publisher);
        const code = result.status === 'not_found' ? 404
          : result.status === 'error' ? 400
          : 200;
        return json(res, code, result);
      }

      json(res, 404, { error: 'not_found' });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

module.exports = { createServer };
