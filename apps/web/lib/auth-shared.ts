// Tiny session helpers used by /api/auth and /api/jwt. The session
// cookie is intentionally minimal — userId + display name. The JWT we
// hand to the gateway carries the seat binding.

export interface SessionPayload {
  userId: string
  username: string
  /** epoch seconds */
  exp: number
}

export const SESSION_COOKIE = 'hijack_session'
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7 // 7 days

export function encodeSession(p: SessionPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url')
}

export function decodeSession(raw: string | undefined | null): SessionPayload | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as SessionPayload
    if (!parsed.userId || !parsed.exp) return null
    if (Date.now() / 1000 > parsed.exp) return null
    return parsed
  } catch {
    return null
  }
}
