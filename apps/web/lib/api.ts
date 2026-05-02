// Small fetch wrapper that stamps `traceparent` and `Authorization`
// onto every outbound REST call. Keeps callers free of header
// boilerplate.

import { getCurrentTraceparent } from './tracing'

export interface ApiOpts extends RequestInit {
  bearer?: string
  /** Override default JSON body parsing. */
  parseAs?: 'json' | 'text' | 'none'
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T = unknown>(
  url: string,
  opts: ApiOpts = {}
): Promise<T> {
  const headers = new Headers(opts.headers || {})
  headers.set('traceparent', getCurrentTraceparent())
  if (opts.bearer) headers.set('Authorization', `Bearer ${opts.bearer}`)
  if (opts.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, { ...opts, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let body: unknown = text
    try { body = JSON.parse(text) } catch { /* keep text */ }
    throw new ApiError(
      `request failed ${res.status}`,
      res.status,
      body
    )
  }
  if (opts.parseAs === 'none') return undefined as unknown as T
  if (opts.parseAs === 'text') return (await res.text()) as unknown as T
  return (await res.json()) as T
}
