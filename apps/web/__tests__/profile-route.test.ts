// profile-route.test.ts — integration tests for PATCH /api/profile.
// We invoke the Next.js route handler with a constructed NextRequest
// so the full validation → store → response chain runs against the
// in-memory shims.

import { PATCH, GET } from '../app/api/profile/route'
import { __setClients } from '../lib/profile/clients'
import {
  MemoryPlayersStore,
  MemoryRedis,
} from '../lib/profile/store'
import { encodeSession, SESSION_COOKIE } from '../lib/auth-shared'

type AnyHeaders = Record<string, string>

function makeReq(
  method: 'PATCH' | 'GET',
  body: unknown,
  cookieValue: string | null
): any {
  const url = 'http://localhost/api/profile'
  const headers: AnyHeaders = { 'content-type': 'application/json' }
  if (cookieValue) headers.cookie = `${SESSION_COOKIE}=${cookieValue}`
  // NextRequest is constructible from a URL + init in 14.x. We stub
  // the cookies API to match what the route handler reads.
  const req: any = new Request(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })
  req.cookies = {
    get: (name: string) => {
      if (cookieValue && name === SESSION_COOKIE) return { value: cookieValue }
      return undefined
    },
  }
  return req
}

function freshSessionCookie(userId: string, username: string): string {
  return encodeSession({
    userId,
    username,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
}

beforeEach(() => {
  __setClients(new MemoryRedis(), new MemoryPlayersStore())
})

afterAll(() => {
  __setClients(null, null)
})

describe('PATCH /api/profile', () => {
  test('rejects unauthenticated requests with 401', async () => {
    const res = await PATCH(makeReq('PATCH', { displayName: 'Alice', avatarId: '1' }, null))
    expect(res.status).toBe(401)
  })

  test('rejects bad JSON with 400', async () => {
    const cookie = freshSessionCookie('u_a', 'Alice')
    // Build a request with an invalid body so req.json() throws.
    const url = 'http://localhost/api/profile'
    const req: any = new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${cookie}` },
      body: 'not-json',
    })
    req.cookies = { get: () => ({ value: cookie }) }
    const res = await PATCH(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('bad_json')
  })

  test('rejects invalid display name (charset) with 400', async () => {
    const cookie = freshSessionCookie('u_a', 'Alice')
    const res = await PATCH(makeReq('PATCH', { displayName: 'has space', avatarId: '1' }, cookie))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('name_charset')
  })

  test('rejects profanity with 400', async () => {
    const cookie = freshSessionCookie('u_a', 'Alice')
    const res = await PATCH(makeReq('PATCH', { displayName: 'shit_eater', avatarId: '1' }, cookie))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('name_profane')
  })

  test('happy path — first write returns 200 with the row', async () => {
    const cookie = freshSessionCookie('u_a', 'Alice')
    const res = await PATCH(makeReq('PATCH', { displayName: 'Alice_99', avatarId: '5' }, cookie))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.profile.displayName).toBe('Alice_99')
    expect(data.profile.avatarId).toBe('5')
  })

  test('rate-limit returns 429 on rapid second write', async () => {
    const cookie = freshSessionCookie('u_a', 'Alice')
    await PATCH(makeReq('PATCH', { displayName: 'Alice_99', avatarId: '5' }, cookie))
    // Touch the rate-limit clock by writing a real change.
    await PATCH(makeReq('PATCH', { displayName: 'Alice_99', avatarId: '6' }, cookie))
    const blocked = await PATCH(makeReq('PATCH', { displayName: 'Alice_99', avatarId: '7' }, cookie))
    expect(blocked.status).toBe(429)
    const data = await blocked.json()
    expect(data.error).toBe('rate_limited')
    expect(data.retryAfterSec).toBeGreaterThan(0)
  })

  test('uniqueness returns 409 when another user holds the name', async () => {
    const a = freshSessionCookie('u_a', 'Alice')
    const b = freshSessionCookie('u_b', 'Bob')
    await PATCH(makeReq('PATCH', { displayName: 'OnlyOne', avatarId: '1' }, a))
    const collision = await PATCH(makeReq('PATCH', { displayName: 'OnlyOne', avatarId: '2' }, b))
    expect(collision.status).toBe(409)
    const data = await collision.json()
    expect(data.error).toBe('name_taken')
  })
})

describe('GET /api/profile', () => {
  test('returns synthesized default for new users', async () => {
    const cookie = freshSessionCookie('u_a', 'Alice')
    const res = await GET(makeReq('GET', null, cookie))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.profile.userId).toBe('u_a')
    expect(data.profile.avatarId).toBe('1')
    expect(data.synthesized).toBe(true)
  })

  test('returns persisted row after a write', async () => {
    const cookie = freshSessionCookie('u_a', 'Alice')
    await PATCH(makeReq('PATCH', { displayName: 'Alice_99', avatarId: '5' }, cookie))
    const res = await GET(makeReq('GET', null, cookie))
    const data = await res.json()
    expect(data.profile.displayName).toBe('Alice_99')
    expect(data.profile.avatarId).toBe('5')
    expect(data.synthesized).toBeUndefined()
  })

  test('returns 401 without session', async () => {
    const res = await GET(makeReq('GET', null, null))
    expect(res.status).toBe(401)
  })
})
