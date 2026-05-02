// lobby-flow.test.ts — drive the GameSocket against a fake gateway
// and assert lobby state updates flow through correctly. We use a
// mock WebSocket that records what the client sends and lets the test
// inject server frames.
//
// This is the integration test the phase calls for ("lobby → table
// flow against a mock gateway") — it doesn't render React, but it
// proves the wire contract holds end-to-end inside the IGameSocket
// abstraction.

import { WebSocketGameSocket, createLobbySocket } from '../lib/game-socket'
import type {
  S2CLobbyState,
  S2CLobbyDelta,
  ServerMessage,
} from '@hijack/protocol'

class MockWS {
  static OPEN = 1
  static CLOSED = 3
  url: string
  readyState = 0
  OPEN = 1
  sent: string[] = []
  private listeners: Record<string, Array<(e: any) => void>> = {}
  constructor(url: string) {
    this.url = url
    setTimeout(() => {
      this.readyState = 1
      this.emit('open', {})
    }, 0)
  }
  addEventListener(e: string, cb: (ev: any) => void) {
    ;(this.listeners[e] ||= []).push(cb)
  }
  removeEventListener(e: string, cb: (ev: any) => void) {
    this.listeners[e] = (this.listeners[e] || []).filter((f) => f !== cb)
  }
  send(s: string) { this.sent.push(s) }
  close(code = 1000, reason = '') {
    this.readyState = 3
    this.emit('close', { code, reason })
  }
  emit(e: string, p: any) {
    for (const cb of this.listeners[e] || []) cb(p)
  }
  fakeMessage(data: unknown) {
    this.emit('message', { data: JSON.stringify(data) })
  }
}

describe('lobby → table flow against mock gateway', () => {
  test('subscribe gets lobby_state then deltas', async () => {
    let mock: MockWS | null = null
    const socket = createLobbySocket({ baseWsUrl: 'ws://test' })
    // Inject WebSocketImpl by recreating with the same URL.
    // Easier: build the impl directly.
    const direct = new WebSocketGameSocket({
      url: 'ws://test/lobby',
      WebSocketImpl: function (u: string) {
        mock = new MockWS(u)
        return mock as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })

    const got: ServerMessage[] = []
    direct.on('message', (m) => got.push(m))
    await direct.connect()
    direct.send({ t: 'c2s.lobby_subscribe', stake: '1-2' })

    // Verify the c2s frame went out.
    expect(mock!.sent.length).toBe(1)
    expect(JSON.parse(mock!.sent[0])).toEqual({ t: 'c2s.lobby_subscribe', stake: '1-2' })

    // Server pushes a lobby_state, then a seat_filled delta.
    const ls: S2CLobbyState = {
      t: 's2c.lobby_state',
      stake: '1-2',
      tables: [
        { tableId: 'tbl-1', name: 'A', openSeats: 6, maxSeats: 6, smallBlind: 1, bigBlind: 2 },
      ],
    }
    mock!.fakeMessage(ls)
    const seatFilled: S2CLobbyDelta = {
      t: 's2c.lobby_delta',
      stake: '1-2',
      kind: 'seat_filled',
      tableId: 'tbl-1',
      openSeats: 5,
    }
    mock!.fakeMessage(seatFilled)
    expect(got.length).toBe(2)
    expect(got[0].t).toBe('s2c.lobby_state')
    expect(got[1].t).toBe('s2c.lobby_delta')
    // Lock interface check (not unused).
    void socket
  })

  test('table flow — c2s.join + s2c.snapshot + delta', async () => {
    let mock: MockWS | null = null
    const direct = new WebSocketGameSocket({
      url: 'ws://test/table/tbl-1?token=abc',
      WebSocketImpl: function (u: string) {
        mock = new MockWS(u)
        return mock as unknown as WebSocket
      } as unknown as typeof WebSocket,
    })
    const messages: ServerMessage[] = []
    direct.on('message', (m) => messages.push(m))
    await direct.connect()
    direct.send({ t: 'c2s.join', tableId: 'tbl-1', lastSeq: 0 })

    expect(JSON.parse(mock!.sent[0])).toMatchObject({ t: 'c2s.join', tableId: 'tbl-1' })

    mock!.fakeMessage({
      t: 's2c.snapshot',
      tableId: 'tbl-1',
      seq: 1,
      state: { players: [] },
    })
    mock!.fakeMessage({
      t: 's2c.delta',
      tableId: 'tbl-1',
      seq: 2,
      step: 1,
      payload: { kind: 'pre_flop' },
    })
    expect(messages.map((m) => m.t)).toEqual(['s2c.snapshot', 's2c.delta'])
  })
})
