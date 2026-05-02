// Mints a short-lived gateway JWT bound to (userId, tableId, [seat]).
// The gateway's auth.js verifies HS256 against the shared secret. We
// intentionally cap the TTL low (5m) — clients refresh on reconnect.

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { SESSION_COOKIE, decodeSession } from '@/lib/auth-shared'
import { SERVER } from '@/lib/env'

interface MintRequest {
  tableId?: string
  seat?: number | null
  /** Optional sessionId to correlate this tab — falls back to a
   *  random one. */
  sessionId?: string
}

export async function POST(req: NextRequest) {
  const session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: MintRequest = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  const tableId = (body.tableId || '').toString()
  if (!tableId) {
    return NextResponse.json({ error: 'tableId_required' }, { status: 400 })
  }

  const sessionId =
    (body.sessionId || '').toString() ||
    `${session.userId}_${Date.now().toString(36)}`

  const claims = {
    sub: session.userId,
    tableId,
    seat: body.seat ?? null,
    sessionId,
  }
  const token = jwt.sign(claims, SERVER.jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '5m',
  })
  return NextResponse.json({
    token,
    userId: session.userId,
    sessionId,
    tableId,
    seat: body.seat ?? null,
  })
}
