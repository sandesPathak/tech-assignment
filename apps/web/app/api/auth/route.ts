// Sign-in stub. Demo-only — accepts any non-empty username, mints a
// session cookie. Phase 5 (avatar) replaces this with a real provider.

import { NextRequest, NextResponse } from 'next/server'
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  encodeSession,
  decodeSession,
} from '@/lib/auth-shared'

export async function POST(req: NextRequest) {
  let body: { username?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  const username = (body.username || '').trim()
  if (!username) {
    return NextResponse.json({ error: 'username_required' }, { status: 400 })
  }
  // userId is derived from the username to keep the demo deterministic;
  // a real auth provider would issue an opaque id.
  const userId = `u_${Buffer.from(username).toString('base64url').slice(0, 16)}`
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC
  const cookie = encodeSession({ userId, username, exp })

  const res = NextResponse.json({ ok: true, userId, username })
  res.cookies.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SEC,
    path: '/',
  })
  return res
}

export async function GET(req: NextRequest) {
  const session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ session: null }, { status: 401 })
  return NextResponse.json({ session })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
  })
  return res
}
