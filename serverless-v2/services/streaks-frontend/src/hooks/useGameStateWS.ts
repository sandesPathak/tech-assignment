import { useEffect, useRef, useState, useCallback } from 'react'
import type { TableState } from '../types/poker.types'

const STEP_NAMES = [
  'GAME_PREP',                  // 0
  'SETUP_DEALER',               // 1
  'SETUP_SMALL_BLIND',          // 2
  'SETUP_BIG_BLIND',            // 3
  'DEAL_CARDS',                 // 4
  'PRE_FLOP_BETTING_ROUND',     // 5
  'DEAL_FLOP',                  // 6
  'FLOP_BETTING_ROUND',         // 7
  'DEAL_TURN',                  // 8
  'TURN_BETTING_ROUND',         // 9
  'DEAL_RIVER',                 // 10
  'RIVER_BETTING_ROUND',        // 11
  'AFTER_RIVER_BETTING_ROUND',  // 12
  'FIND_WINNERS',               // 13
  'PAY_WINNERS',                // 14
  'RECORD_STATS_AND_NEW_HAND',  // 15
  'ADD_ONS_AND_CHARGING',       // 16
]

type WireGame = {
  handStep: number | string
  stepName?: string
  gameNo: number
  pot: number
  communityCards: string[]
  dealerSeat: number
  smallBlindSeat: number
  bigBlindSeat: number
  move: number
  currentBet: number
  status: string
  smallBlind: number
  bigBlind: number
  maxSeats: number
  tableName?: string
  lastRaiseSize?: number
  winners?: { seat: number; playerId: number | string }[]
}

type WirePlayer = {
  playerId: number | string
  username: string
  seat: number
  stack: number
  bet: number
  totalBet: number
  status: string
  action: string | null
  cards: string[]
  handRank?: string | null
  winnings?: number
}

function normalizeGame(g: WireGame): TableState['game'] {
  const step = typeof g.handStep === 'string' ? parseInt(g.handStep, 10) : g.handStep
  return {
    handStep: step,
    stepName: g.stepName || STEP_NAMES[step] || `STEP_${step}`,
    gameNo: Number(g.gameNo) || 0,
    pot: Number(g.pot) || 0,
    communityCards: g.communityCards || [],
    dealerSeat: Number(g.dealerSeat) || 0,
    smallBlindSeat: Number(g.smallBlindSeat) || 0,
    bigBlindSeat: Number(g.bigBlindSeat) || 0,
    move: Number(g.move) || 0,
    currentBet: Number(g.currentBet) || 0,
    status: g.status || 'in_progress',
    smallBlind: Number(g.smallBlind) || 0,
    bigBlind: Number(g.bigBlind) || 0,
    maxSeats: Number(g.maxSeats) || 6,
    tableName: g.tableName || '',
    lastRaiseSize: Number(g.lastRaiseSize) || 0,
    winners: (g.winners || []).map((w) => ({ seat: Number(w.seat), playerId: Number(w.playerId) || 0 })),
  }
}

function normalizePlayers(ps: WirePlayer[]): TableState['players'] {
  return (ps || []).map((p) => ({
    playerId: typeof p.playerId === 'string' ? Number(p.playerId.replace(/\D/g, '')) || 0 : p.playerId,
    username: p.username || `Seat ${p.seat}`,
    seat: Number(p.seat) || 0,
    stack: Number(p.stack) || 0,
    bet: Number(p.bet) || 0,
    totalBet: Number(p.totalBet) || 0,
    status: String(p.status ?? '1'),
    action: p.action || '',
    cards: Array.isArray(p.cards) ? p.cards : [],
    handRank: p.handRank || '',
    winnings: Number(p.winnings) || 0,
  }))
}

const GATEWAY_HTTP = (import.meta.env.VITE_GATEWAY_HTTP_URL as string) || 'http://localhost:3002'
const GATEWAY_WS = (import.meta.env.VITE_GATEWAY_WS_URL as string) || 'ws://localhost:3002'

interface UseGameStateOpts {
  stake?: string
  playerId: string
  username: string
  /** When set, target this exact tableId (skip auto-pick from lobby). */
  tableId?: string | null
  /** When true, connect as a spectator — no seat-claim, no /sit. */
  spectate?: boolean
}

export function useGameStateWS({ stake = '1-2', playerId, username, tableId: forceTableId = null, spectate = false }: UseGameStateOpts) {
  const [tableState, setTableState] = useState<TableState | null>(null)
  const [tableId, setTableId] = useState<string | null>(null)
  const [mySeat, setMySeat] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)

  const connect = useCallback(async () => {
    if (connectingRef.current || wsRef.current) return
    connectingRef.current = true
    setLoading(true)
    setError(null)
    try {
      // 1. resolve target table — explicit > first-open at stake
      let targetTable = forceTableId
      let maxSeats = 6
      if (!targetTable) {
        const lobbyRes = await fetch(`${GATEWAY_HTTP}/lobby/${encodeURIComponent(stake)}`)
        if (!lobbyRes.ok) throw new Error(`lobby ${lobbyRes.status}`)
        const lobby = await lobbyRes.json()
        const pick = spectate
          ? (lobby.tables || [])[0]
          : (lobby.tables || []).find((t: { openSeats: number }) => t.openSeats > 0)
        if (!pick) throw new Error('no_table')
        targetTable = pick.tableId as string
        maxSeats = Number(pick.maxSeats) || 6
      } else {
        // fetch maxSeats for the requested table
        const lobbyRes = await fetch(`${GATEWAY_HTTP}/lobby/${encodeURIComponent(stake)}`)
        if (lobbyRes.ok) {
          const lobby = await lobbyRes.json()
          const t = (lobby.tables || []).find((x: { tableId: string }) => x.tableId === targetTable)
          if (t) maxSeats = Number(t.maxSeats) || 6
        }
      }

      const onSocketMessage = (ev: MessageEvent) => {
        let msg: any
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
        if (msg.t === 's2c.snapshot') {
          const game = normalizeGame(msg.state?.game)
          const players = normalizePlayers(msg.state?.players)
          setTableState({ game, players })
          setLoading(false)
        } else if (msg.t === 's2c.delta') {
          setTableState((prev) => {
            const baseGame = prev?.game
            const basePlayers = prev?.players || []
            const game = msg.payload?.game ? normalizeGame(msg.payload.game) : baseGame
            const players = msg.payload?.players ? normalizePlayers(msg.payload.players) : basePlayers
            if (!game) return prev
            return { game, players }
          })
          setLoading(false)
        } else if (msg.t === 's2c.error') {
          setError(msg.message || msg.code || 'gateway_error')
        }
      }

      // 2a. SPECTATOR PATH — mint a no-seat token, open the WS, join.
      if (spectate) {
        const tokRes = await fetch(`${GATEWAY_HTTP}/spectator-token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tableId: targetTable }),
        })
        if (!tokRes.ok) throw new Error(`spectator_token ${tokRes.status}`)
        const { token } = await tokRes.json()
        const url = `${GATEWAY_WS}/table/${encodeURIComponent(targetTable!)}?token=${encodeURIComponent(token)}`
        const ws = new WebSocket(url)
        wsRef.current = ws
        setTableId(targetTable)
        setMySeat(null)
        ws.onopen = () => {
          ws.send(JSON.stringify({ t: 'c2s.join', tableId: targetTable, lastSeq: 0 }))
        }
        ws.onmessage = onSocketMessage
        ws.onclose = () => { wsRef.current = null }
        ws.onerror = () => setError('ws_error')
        return
      }

      // 2b. PLAY PATH — claim a seat.
      let seatToTake = 1
      for (let s = 1; s <= maxSeats; s += 1) {
        seatToTake = s
        try {
          const claimRes = await fetch(`${GATEWAY_HTTP}/seat-claim`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              stake,
              tableId: targetTable,
              seat: s,
              userId: playerId,
            }),
          })
          if (claimRes.ok) {
            const claim = await claimRes.json()
            // 3. open WS with joinToken
            const url = `${GATEWAY_WS}/table/${encodeURIComponent(targetTable)}?token=${encodeURIComponent(claim.joinToken)}`
            const ws = new WebSocket(url)
            wsRef.current = ws
            setTableId(targetTable)
            setMySeat(s)
            ws.onopen = () => {
              ws.send(JSON.stringify({
                t: 'c2s.join',
                tableId: targetTable,
                seat: s,
                lastSeq: 0,
                joinToken: claim.joinToken,
                username,
              }))
            }
            ws.onmessage = (ev) => {
              let msg: any
              try { msg = JSON.parse(ev.data) } catch { return }
              if (msg.t === 's2c.snapshot') {
                const game = normalizeGame(msg.state?.game)
                const players = normalizePlayers(msg.state?.players)
                setTableState({ game, players })
                setLoading(false)
              } else if (msg.t === 's2c.delta') {
                setTableState((prev) => {
                  const baseGame = prev?.game
                  const basePlayers = prev?.players || []
                  const game = msg.payload?.game ? normalizeGame(msg.payload.game) : baseGame
                  const players = msg.payload?.players ? normalizePlayers(msg.payload.players) : basePlayers
                  if (!game) return prev
                  return { game, players }
                })
              } else if (msg.t === 's2c.error') {
                setError(msg.message || msg.code || 'gateway_error')
              }
            }
            ws.onclose = () => { wsRef.current = null }
            ws.onerror = () => setError('ws_error')
            return
          }
          // seat taken — try the next one
        } catch (_e) { /* try next */ }
      }
      throw new Error(`could not claim a seat (tried 1..${maxSeats})`)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    } finally {
      connectingRef.current = false
    }
  }, [stake, playerId, username, forceTableId, spectate])

  useEffect(() => {
    connect()
    return () => {
      try { wsRef.current?.close() } catch { /* */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stake, playerId, forceTableId, spectate])

  const sendAction = useCallback(async (seat: number, action: string, amount?: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== ws.OPEN || !tableId) return null
    ws.send(JSON.stringify({
      t: 'c2s.action',
      tableId,
      seat,
      action,
      amount: amount ?? 0,
    }))
    return tableState
  }, [tableId, tableState])

  // Auto-advance is server-driven; expose no-ops for compatibility with the legacy UI.
  const advance = useCallback(async () => tableState, [tableState])
  const refresh = useCallback(async () => tableState, [tableState])
  const reset = useCallback(async () => tableState, [tableState])

  return {
    tableState,
    loading,
    error,
    refresh,
    advance,
    sendAction,
    reset,
    tableId,
    mySeat,
  }
}
