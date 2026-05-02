// Proxy → gateway's /api/coach/:handId/:hero (which reads from Neon
// `hand_analysis`). Living on the Next.js side keeps the browser
// origin same-origin and lets us rely on the existing session cookie
// for auth instead of a CORS-friendly bearer.

import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, decodeSession } from '@/lib/auth-shared'
import { SERVER } from '@/lib/env'

export async function GET(
  req: NextRequest,
  { params }: { params: { handId: string; hero: string } }
) {
  const session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { handId, hero } = params
  if (!handId || !hero) {
    return NextResponse.json({ error: 'bad_params' }, { status: 400 })
  }

  const url = `${SERVER.gatewayHttp().replace(/\/$/, '')}/api/coach/${encodeURIComponent(
    handId
  )}/${encodeURIComponent(hero)}`

  const tp = req.headers.get('traceparent')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (tp) headers['traceparent'] = tp

  try {
    const upstream = await fetch(url, { headers })
    const text = await upstream.text()
    if (!upstream.ok) {
      return new NextResponse(text || '{}', {
        status: upstream.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new NextResponse(text, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: (err as Error).message },
      { status: 502 }
    )
  }
}
