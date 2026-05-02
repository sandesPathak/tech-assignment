// /api/profile — read + update the signed-in user's profile.
//
// Phase 5 endpoint. Validates input (shape, charset, profanity), checks
// rate-limit / reservation / uniqueness against Redis, writes to Pg,
// then publishes `profile:updated` so the gateway re-broadcasts an
// `s2c.delta` to every seated table.

import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, decodeSession } from '@/lib/auth-shared'
import { validateProfileShape } from '@/lib/profile/validation'
import { writeProfile, readProfile } from '@/lib/profile/store'
import { getRedis, getPg } from '@/lib/profile/clients'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const row = await readProfile(session.userId, { redis: getRedis(), pg: getPg() })
  if (row) return NextResponse.json({ profile: row })
  // No row yet — synthesize a default so the UI has something to render.
  return NextResponse.json({
    profile: {
      userId: session.userId,
      displayName: session.username,
      displayNameLower: session.username.toLowerCase(),
      displayNameChangedAt: null,
      avatarId: '1',
      createdAt: '',
      updatedAt: '',
    },
    synthesized: true,
  })
}

export async function PATCH(req: NextRequest) {
  const session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }) }

  const validated = validateProfileShape(body as any)
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error.code, message: validated.error.message, field: validated.error.field },
      { status: 400 }
    )
  }

  const result = await writeProfile(session.userId, validated.value, {
    redis: getRedis(),
    pg: getPg(),
  })

  if (!result.ok) {
    const status =
      result.code === 'rate_limited' ? 429
      : result.code === 'name_reserved' || result.code === 'name_taken' ? 409
      : 503
    return NextResponse.json(
      { error: result.code, message: result.message, ...('retryAfterSec' in result ? { retryAfterSec: result.retryAfterSec } : {}) },
      { status }
    )
  }

  return NextResponse.json({ profile: result.row })
}
