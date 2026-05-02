// ─────────────────────────────────────────────────────────────────────────
// tracing.ts — OpenTelemetry sdk-web bootstrap.
//
// Initialised once on mount (see app/providers.tsx). When
// `NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT` is unset, this is a no-op:
// matches the worker / gateway fail-open semantics from Phase 9.
//
// Propagation strategy:
//   - HTTP calls (`/api/jwt`, `/api/coach/...`, `/handoff/issue`, etc.):
//     `getCurrentTraceparent()` is read by `lib/api.ts` and stamped onto
//     the `traceparent` request header. Standard W3C HTTP propagation —
//     the gateway's pino logger (Phase 9) extracts it.
//   - WebSocket upgrade: browsers can't set headers on `new WebSocket`,
//     so we inject `?traceparent=<value>` into the upgrade URL. The
//     worker's pub/sub already stamps a per-tick `traceparent` onto
//     each `s2c.delta`, so the trace continues through the gateway.
// ─────────────────────────────────────────────────────────────────────────

import { PUBLIC } from './env'

let initialized = false
let currentTraceparent: string | null = null

/** Initialise the sdk-web tracer. Idempotent. Returns true if tracing
 *  was actually wired up; false if the OTLP endpoint is unset. */
export async function initWebTracing(): Promise<boolean> {
  if (initialized) return Boolean(currentTraceparent)
  if (!PUBLIC.otlpEndpoint) {
    initialized = true
    return false
  }
  if (typeof window === 'undefined') return false
  try {
    // Defer-import the SDK so the bundle stays small when tracing is off.
    const [{ WebTracerProvider }, { ZoneContextManager }, otlp, instrFetch] =
      await Promise.all([
        import('@opentelemetry/sdk-trace-web'),
        import('@opentelemetry/context-zone'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/instrumentation-fetch').catch(() => null),
      ])

    const provider = new WebTracerProvider()
    const exporter = new otlp.OTLPTraceExporter({ url: PUBLIC.otlpEndpoint })
    // Lazy require so we don't hard-pin SDK version in our types.
    const sdkBase = await import('@opentelemetry/sdk-trace-web')
    const proc = new sdkBase.SimpleSpanProcessor(exporter)
    provider.addSpanProcessor(proc)
    provider.register({ contextManager: new ZoneContextManager() })

    if (instrFetch) {
      const { registerInstrumentations } = await import(
        '@opentelemetry/instrumentation'
      )
      registerInstrumentations({
        instrumentations: [new instrFetch.FetchInstrumentation()],
      })
    }
    initialized = true
    return true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[tracing] init failed, continuing without OTel:', err)
    initialized = true
    return false
  }
}

/** Best-effort current traceparent — pulled from the active span when
 *  the SDK is loaded, else generated as a fresh W3C string. Used for
 *  WS upgrade query injection where a `fetch` interceptor can't reach. */
export function getCurrentTraceparent(): string {
  if (currentTraceparent) return currentTraceparent
  // Lazy: try to read from `@opentelemetry/api` if available.
  try {
    // Optional dependency — wrapped in try/catch so the app boots even
    // when the OTel packages aren't installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const api = require('@opentelemetry/api')
    const span = api.trace.getActiveSpan?.()
    if (span) {
      const ctx = span.spanContext()
      const flag = ctx.traceFlags.toString(16).padStart(2, '0')
      const tp = `00-${ctx.traceId}-${ctx.spanId}-${flag}`
      currentTraceparent = tp
      return tp
    }
  } catch {
    /* fall through */
  }
  currentTraceparent = randomTraceparent()
  return currentTraceparent
}

/** Reset between page navigations. */
export function rotateTraceparent(): string {
  currentTraceparent = randomTraceparent()
  return currentTraceparent
}

function randomTraceparent(): string {
  const traceId = randomHex(32)
  const spanId = randomHex(16)
  return `00-${traceId}-${spanId}-01`
}

function randomHex(n: number): string {
  // Browsers always have crypto.getRandomValues; in tests we may not.
  const buf = new Uint8Array(n / 2)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (let i = 0; i < buf.length; i += 1) out += buf[i].toString(16).padStart(2, '0')
  return out
}
