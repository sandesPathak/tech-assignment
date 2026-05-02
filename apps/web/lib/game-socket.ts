// ─────────────────────────────────────────────────────────────────────────
// game-socket.ts — TRANSPORT-AGNOSTIC interface for the table socket.
//
// The headline piece of the architecture pitch: React components NEVER
// touch raw WebSockets. They depend on `IGameSocket`. Today the only
// concrete is `WebSocketGameSocket`; tomorrow we can swap it for
// WebTransport, polyfilled WS, mock harness, or a server-rendered
// snapshot — the components don't change.
//
// All inbound frames flow through `on('message', cb)` which receives the
// already-parsed `ServerMessage` from `@hijack/protocol`. The store
// (lib/store.ts) is the only consumer.
// ─────────────────────────────────────────────────────────────────────────

import type { ClientMessage, ServerMessage } from '@hijack/protocol'

export type GameSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'error'

export interface GameSocketEventMap {
  state: GameSocketState
  message: ServerMessage
  /** Low-level error (transport / parse). Recoverable issues are sent as
   *  `s2c.error` server messages and arrive on `message`. */
  error: Error
  /** Raised when the underlying transport closes. The store reacts by
   *  scheduling reconnects with the last applied seq. */
  close: { code: number; reason: string }
}

export type GameSocketHandler<K extends keyof GameSocketEventMap> = (
  payload: GameSocketEventMap[K]
) => void

export interface IGameSocket {
  /** Lifecycle. */
  connect(): Promise<void>
  disconnect(code?: number, reason?: string): void
  /** Current state — useful for HUD indicators. */
  readonly state: GameSocketState
  /** Send a typed client frame. Returns true if it was queued, false if
   *  the socket isn't open. */
  send(msg: ClientMessage): boolean
  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof GameSocketEventMap>(
    event: K,
    handler: GameSocketHandler<K>
  ): () => void
}

// ─── Tiny pub-sub helper ───────────────────────────────────────────────

class Emitter {
  private listeners = new Map<string, Set<(payload: unknown) => void>>()
  on(evt: string, cb: (payload: unknown) => void): () => void {
    let set = this.listeners.get(evt)
    if (!set) {
      set = new Set()
      this.listeners.set(evt, set)
    }
    set.add(cb)
    return () => {
      set!.delete(cb)
    }
  }
  emit(evt: string, payload: unknown): void {
    const set = this.listeners.get(evt)
    if (!set) return
    for (const cb of [...set]) {
      try {
        cb(payload)
      } catch (e) {
        // Listeners must not crash the emitter.
        // eslint-disable-next-line no-console
        console.error('[game-socket] listener threw', e)
      }
    }
  }
  clear(): void {
    this.listeners.clear()
  }
}

// ─── WebSocket implementation ──────────────────────────────────────────

export interface WebSocketGameSocketOpts {
  url: string
  /** Optional W3C traceparent string injected on the upgrade query. */
  traceparent?: string
  /** Window injection (lets tests pass a mock WebSocket constructor). */
  WebSocketImpl?: typeof WebSocket
}

/** Concrete `IGameSocket` backed by the browser `WebSocket` API. */
export class WebSocketGameSocket implements IGameSocket {
  private ws: WebSocket | null = null
  private emitter = new Emitter()
  private _state: GameSocketState = 'idle'
  private opts: WebSocketGameSocketOpts

  constructor(opts: WebSocketGameSocketOpts) {
    this.opts = opts
  }

  get state(): GameSocketState {
    return this._state
  }

  private setState(s: GameSocketState): void {
    if (this._state === s) return
    this._state = s
    this.emitter.emit('state', s)
  }

  connect(): Promise<void> {
    if (this._state === 'open' || this._state === 'connecting') {
      return Promise.resolve()
    }
    this.setState('connecting')

    const Ctor =
      this.opts.WebSocketImpl ??
      (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
    if (!Ctor) {
      const err = new Error('WebSocket constructor unavailable in this env')
      this.setState('error')
      this.emitter.emit('error', err)
      return Promise.reject(err)
    }

    const url = this.injectTraceparent(this.opts.url, this.opts.traceparent)
    const ws = new Ctor(url)
    this.ws = ws

    return new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onErr)
        this.setState('open')
        resolve()
      }
      const onErr = (e: Event) => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onErr)
        const err = new Error('websocket error')
        this.setState('error')
        this.emitter.emit('error', err)
        reject(err)
        ;(void e)
      }
      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onErr)

      ws.addEventListener('message', (ev) => this.handleMessage(ev))
      ws.addEventListener('close', (ev) => this.handleClose(ev))
    })
  }

  disconnect(code = 1000, reason = 'client_close'): void {
    if (!this.ws) return
    this.setState('closing')
    try {
      this.ws.close(code, reason)
    } catch {
      /* swallow */
    }
  }

  send(msg: ClientMessage): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== ws.OPEN) return false
    try {
      ws.send(JSON.stringify(msg))
      return true
    } catch (err) {
      this.emitter.emit('error', err as Error)
      return false
    }
  }

  on<K extends keyof GameSocketEventMap>(
    event: K,
    handler: GameSocketHandler<K>
  ): () => void {
    return this.emitter.on(event, handler as (p: unknown) => void)
  }

  // ─── private ─────────────────────────────────────────────────────────

  private handleMessage(ev: MessageEvent): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
    } catch (err) {
      this.emitter.emit('error', err as Error)
      return
    }
    if (!parsed || typeof parsed !== 'object' || !('t' in (parsed as object))) {
      this.emitter.emit('error', new Error('frame missing t'))
      return
    }
    this.emitter.emit('message', parsed as ServerMessage)
  }

  private handleClose(ev: CloseEvent): void {
    this.setState('closed')
    this.emitter.emit('close', { code: ev.code, reason: ev.reason })
    this.ws = null
  }

  private injectTraceparent(url: string, tp?: string): string {
    if (!tp) return url
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}traceparent=${encodeURIComponent(tp)}`
  }
}

// ─── Factory ───────────────────────────────────────────────────────────

/** Build a `WebSocketGameSocket` for a table. */
export function createTableSocket(opts: {
  baseWsUrl: string
  tableId: string
  jwt: string
  traceparent?: string
}): IGameSocket {
  const url = `${opts.baseWsUrl.replace(/\/$/, '')}/table/${encodeURIComponent(
    opts.tableId
  )}?token=${encodeURIComponent(opts.jwt)}`
  return new WebSocketGameSocket({ url, traceparent: opts.traceparent })
}

/** Build a `WebSocketGameSocket` for the lobby topic. */
export function createLobbySocket(opts: {
  baseWsUrl: string
  jwt?: string
  traceparent?: string
}): IGameSocket {
  const tokenQs = opts.jwt ? `?token=${encodeURIComponent(opts.jwt)}` : ''
  const url = `${opts.baseWsUrl.replace(/\/$/, '')}/lobby${tokenQs}`
  return new WebSocketGameSocket({ url, traceparent: opts.traceparent })
}
