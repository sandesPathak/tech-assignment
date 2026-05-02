// game-socket.test.ts — interface conformance for the GameSocket layer.
//
// We exercise the WebSocketGameSocket against a JS WebSocket polyfill
// (a minimal mock) so the test runs in Node without a real network.
// The point is to lock down the interface contract — connect/send/on/
// disconnect — and to prove components can swap implementations.

import {
  WebSocketGameSocket,
  type IGameSocket,
  type GameSocketState,
} from '../lib/game-socket'

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  url: string
  readyState = MockWebSocket.CONNECTING
  OPEN = MockWebSocket.OPEN
  // Captured frames from `send`.
  sent: string[] = []
  private listeners: Record<string, Array<(ev: any) => void>> = {}
  constructor(url: string) {
    this.url = url
    // Open async to mimic browser behaviour.
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.emit('open', {})
    }, 0)
  }
  addEventListener(evt: string, cb: (ev: any) => void) {
    ;(this.listeners[evt] ||= []).push(cb)
  }
  removeEventListener(evt: string, cb: (ev: any) => void) {
    const set = this.listeners[evt]
    if (!set) return
    this.listeners[evt] = set.filter((f) => f !== cb)
  }
  send(s: string) { this.sent.push(s) }
  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', { code, reason })
  }
  // Test helpers.
  emit(evt: string, payload: any) {
    for (const cb of this.listeners[evt] || []) cb(payload)
  }
  fakeMessage(data: unknown) {
    this.emit('message', { data: JSON.stringify(data) })
  }
}

describe('IGameSocket — WebSocketGameSocket conformance', () => {
  function makeSocket(): { socket: IGameSocket; mock: MockWebSocket } {
    let mock: MockWebSocket | null = null
    const socket = new WebSocketGameSocket({
      url: 'ws://test/table/t1',
      WebSocketImpl: function (url: string) {
        mock = new MockWebSocket(url)
        return mock as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    // hack: connect immediately so callers can invoke
    return { socket, mock: mock as unknown as MockWebSocket }
  }

  test('connect resolves once underlying ws emits open', async () => {
    let captured: MockWebSocket | null = null
    const socket = new WebSocketGameSocket({
      url: 'ws://test/table/t1',
      WebSocketImpl: function (url: string) {
        captured = new MockWebSocket(url)
        return captured as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    expect(socket.state).toBe('idle')
    await socket.connect()
    expect(socket.state).toBe('open')
    expect(captured).toBeTruthy()
  })

  test('send enqueues frames as JSON', async () => {
    let captured: MockWebSocket | null = null
    const socket = new WebSocketGameSocket({
      url: 'ws://test/table/t1',
      WebSocketImpl: function (url: string) {
        captured = new MockWebSocket(url)
        return captured as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    await socket.connect()
    const ok = socket.send({ t: 'c2s.join', tableId: 't1' } as any)
    expect(ok).toBe(true)
    expect(captured!.sent.length).toBe(1)
    expect(JSON.parse(captured!.sent[0])).toEqual({ t: 'c2s.join', tableId: 't1' })
  })

  test('on("message") receives parsed server frames', async () => {
    let captured: MockWebSocket | null = null
    const socket = new WebSocketGameSocket({
      url: 'ws://test/table/t1',
      WebSocketImpl: function (url: string) {
        captured = new MockWebSocket(url)
        return captured as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    await socket.connect()
    const messages: unknown[] = []
    socket.on('message', (m) => messages.push(m))
    captured!.fakeMessage({ t: 's2c.snapshot', tableId: 't1', seq: 5, state: { ok: 1 } })
    expect(messages).toHaveLength(1)
    expect((messages[0] as any).t).toBe('s2c.snapshot')
  })

  test('on("state") fires for the lifecycle transitions', async () => {
    let captured: MockWebSocket | null = null
    const socket = new WebSocketGameSocket({
      url: 'ws://test/table/t1',
      WebSocketImpl: function (url: string) {
        captured = new MockWebSocket(url)
        return captured as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    const states: GameSocketState[] = []
    socket.on('state', (s) => states.push(s))
    await socket.connect()
    expect(states).toContain('connecting')
    expect(states).toContain('open')
  })

  test('disconnect emits close', async () => {
    let captured: MockWebSocket | null = null
    const socket = new WebSocketGameSocket({
      url: 'ws://test/table/t1',
      WebSocketImpl: function (url: string) {
        captured = new MockWebSocket(url)
        return captured as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    await socket.connect()
    const closes: unknown[] = []
    socket.on('close', (c) => closes.push(c))
    socket.disconnect()
    expect(closes).toHaveLength(1)
    expect((closes[0] as any).code).toBe(1000)
  })

  test('traceparent option appended to URL', () => {
    let urlSeen = ''
    const socket = new WebSocketGameSocket({
      url: 'ws://test/table/t1?token=abc',
      traceparent: '00-aaaa-bbbb-01',
      WebSocketImpl: function (url: string) {
        urlSeen = url
        return new MockWebSocket(url) as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    socket.connect()
    expect(urlSeen).toContain('traceparent=')
    expect(urlSeen).toContain('token=abc')
  })

  test('exposes IGameSocket-shaped interface (interface check)', () => {
    const s = new WebSocketGameSocket({ url: 'ws://x/' })
    const i: IGameSocket = s
    // Interface members exist.
    expect(typeof i.connect).toBe('function')
    expect(typeof i.disconnect).toBe('function')
    expect(typeof i.send).toBe('function')
    expect(typeof i.on).toBe('function')
    expect(typeof i.state).toBe('string')
  })
})
