// Centralized env access — prefer reading from this module so the
// build-time / runtime split stays explicit. Each lookup returns a
// safe default for local dev so the app boots without a populated
// `.env.local`.

export const PUBLIC = {
  /** Gateway WS base URL (e.g. `wss://gateway.fly.dev`). */
  gatewayWs:
    process.env.NEXT_PUBLIC_GATEWAY_WS_URL || 'ws://localhost:3002',
  /** Gateway HTTP base URL (REST endpoints). */
  gatewayHttp:
    process.env.NEXT_PUBLIC_GATEWAY_HTTP_URL || 'http://localhost:3002',
  /** API base used for non-gateway calls. Empty = same-origin. */
  apiBase: process.env.NEXT_PUBLIC_API_BASE || '',
  /** OTel collector — when unset, tracing init is a no-op. */
  otlpEndpoint: process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT || '',
}

/** Server-side only — DO NOT export to the client. */
export const SERVER = {
  jwtSecret(): string {
    return (
      process.env.JWT_SIGNING_SECRET ||
      process.env.GATEWAY_JWT_SECRET ||
      'test-secret-do-not-use-in-prod'
    )
  },
  sessionSecret(): string {
    return process.env.SESSION_SECRET || 'dev-session-secret'
  },
  gatewayHttp(): string {
    return (
      process.env.GATEWAY_HTTP_URL ||
      process.env.NEXT_PUBLIC_GATEWAY_HTTP_URL ||
      'http://localhost:3002'
    )
  },
}
