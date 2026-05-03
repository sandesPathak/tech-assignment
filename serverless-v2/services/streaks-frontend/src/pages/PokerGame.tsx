import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Typography, CircularProgress, Alert, IconButton, Button } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import BlockIcon from '@mui/icons-material/Block'
import PokerTable from '../components/poker/table/PokerTable'
import GameControls from '../components/poker/controls/GameControls'
import ActionButtons from '../components/poker/controls/ActionButtons'
import PhaseIndicator from '../components/poker/info/PhaseIndicator'
import HandHistoryLog from '../components/poker/info/HandHistoryLog'
import Celebration from '../components/Celebration'
import WinCelebration from '../components/poker/WinCelebration'
import { useGameStateWS } from '../hooks/useGameStateWS'
import { useHandHistory } from '../hooks/useHandHistory'
import { useTurnTimer } from '../hooks/useTurnTimer'
import { PHASE_LABELS } from '../types/poker.types'
import { getResponsibleGaming } from '../api/streaks.api'
import { notifyHandCompleted } from '../api/poker.api'

const GATEWAY_HTTP = (import.meta.env.VITE_GATEWAY_HTTP_URL as string) || 'http://localhost:3002'

function PokerGame() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stake = searchParams.get('stake') || '1-2'
  const requestedTableId = searchParams.get('tableId')
  const spectate = searchParams.get('spectate') === '1'
  const playerId = localStorage.getItem('playerId') || `guest-${Date.now()}`
  const displayName = localStorage.getItem('displayName') || 'Hero'
  const { tableState, loading, error, sendAction, mySeat } = useGameStateWS({
    stake,
    playerId,
    username: displayName,
    tableId: requestedTableId,
    spectate,
  })
  const { entries, addEntry } = useHandHistory()
  const prevStepRef = useRef<string | null>(null)
  const [celebrating, setCelebrating] = useState(false)
  const [winCelebrating, setWinCelebrating] = useState(false)
  const [winAmount, setWinAmount] = useState(0)
  const [winnerName, setWinnerName] = useState('')
  const [selfExcludedUntil, setSelfExcludedUntil] = useState<string | null>(null)
  const [exclusionChecked, setExclusionChecked] = useState(false)

  const ADMIN_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN as string) || ''
  const adminHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (ADMIN_TOKEN) h['x-admin-token'] = ADMIN_TOKEN
    return h
  }, [ADMIN_TOKEN])

  // Auto-fill empty seats with bots if the human is seated alone.
  // Fires once per (tableId, stake) per page-mount, ~2.5s after first snapshot
  // so a real human/bot already mid-join has time to land first.
  const filledRef = useRef(false)
  useEffect(() => {
    if (spectate) return
    if (filledRef.current) return
    if (!tableState) return
    if (!requestedTableId) return
    const tableId = requestedTableId
    const t = setTimeout(() => {
      const seated = tableState.players.filter((p) => p.seat != null).length
      if (seated > 1) return
      filledRef.current = true
      const maxSeats = tableState.game.maxSeats || 6
      const want = Math.min(8, Math.max(2, maxSeats - 1))
      fetch(`${GATEWAY_HTTP}/admin/fill-table`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ tableId, stake, count: want }),
      }).catch(() => { /* non-critical */ })
    }, 2500)
    return () => clearTimeout(t)
  }, [tableState, requestedTableId, stake, spectate, adminHeaders])

  // Manual "Spawn Bots" button. Endpoint dedupes per-table within 30s,
  // so we mirror that lock client-side to keep the button visibly busy.
  const [spawning, setSpawning] = useState(false)
  const handleSpawnBots = useCallback(async () => {
    if (!requestedTableId || spawning) return
    setSpawning(true)
    try {
      const seated = tableState?.players.filter((p) => p.seat != null).length ?? 0
      const maxSeats = tableState?.game.maxSeats || 6
      const want = Math.min(8, Math.max(1, maxSeats - seated))
      await fetch(`${GATEWAY_HTTP}/admin/fill-table`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ tableId: requestedTableId, stake, count: want }),
      })
    } catch { /* non-critical */ }
    setTimeout(() => setSpawning(false), 28_000)
  }, [requestedTableId, stake, tableState, spawning, adminHeaders])

  useEffect(() => {
    getResponsibleGaming()
      .then((data) => {
        setSelfExcludedUntil(data.selfExcludedUntil)
        setExclusionChecked(true)
      })
      .catch(() => setExclusionChecked(true))
  }, [])

  const isExcluded = selfExcludedUntil && new Date(selfExcludedUntil) > new Date()

  const handleAction = useCallback(async (seat: number, action: string, amount?: number) => {
    const result = await sendAction(seat, action, amount)
    if (result) {
      const player = result.players.find((p) => p.seat === seat)
      const name = player?.username || `Seat ${seat}`
      const amountStr = amount ? ` $${amount}` : ''
      addEntry(`${name}: ${action.toUpperCase()}${amountStr}`, 'step')
    }
  }, [sendAction, addEntry])

  const isBettingStep = tableState?.game.stepName.includes('BETTING') ?? false
  const actingSeat = isBettingStep && tableState
    ? (() => {
        const seat = tableState.game.move
        const player = tableState.players.find((p) => p.seat === seat && p.status === '1')
        return player ? seat : null
      })()
    : null

  const handleTimeout = useCallback((seat: number) => {
    // NEVER auto-fold the human player. The 15s client-side timer is a
    // safety net for stuck bot/spectator seats, not a hand-pressure
    // feature aimed at the user. Folding the user without their consent
    // is the bug that made the engine appear to "play on their behalf".
    if (mySeat != null && Number(seat) === Number(mySeat)) return
    // For other seats: also skip. The bots have their own action loop;
    // a single client shouldn't be racing them to fold their hand. The
    // gateway's seat-spoof guard would reject this anyway.
    return
  }, [mySeat])

  const { timeLeft, progress } = useTurnTimer(actingSeat, handleTimeout)

  // Hand transition + celebrations
  useEffect(() => {
    if (!tableState) return
    const currentStep = tableState.game.stepName
    if (prevStepRef.current && prevStepRef.current !== currentStep) {
      const label = PHASE_LABELS[currentStep] || currentStep
      addEntry(`Hand #${tableState.game.gameNo} — ${label}`, 'step')
      if (currentStep === 'PAY_WINNERS') {
        const winners = tableState.players.filter((p) => p.winnings > 0)
        winners.forEach((p) => {
          addEntry(`${p.username} wins $${p.winnings.toFixed(2)}${p.handRank ? ` (${p.handRank})` : ''}`, 'winner')
        })
        if (winners.length > 0) {
          const top = winners.reduce((a, b) => (a.winnings > b.winnings ? a : b))
          setWinAmount(top.winnings)
          setWinnerName(top.username)
          setWinCelebrating(true)
          if (top.username === displayName) setCelebrating(true)
        }

        // Streak feedback: when our hero's hand completes, ask the
        // streaks-api directly. The bridge already updates the streak
        // server-side; this call returns whether *this play* was the
        // first one today (streakUpdated=true) so we can toast.
        const heroPlayed = tableState.players.find((p) => String(p.playerId) === String(playerId)
          || (typeof p.playerId === 'number' && String(playerId).endsWith(String(p.playerId))))
        if (heroPlayed && playerId && !spectate) {
          const handId = `${tableState.game.gameNo}-${Date.now()}`
          notifyHandCompleted(playerId, 1, handId).then(({ streakUpdated }) => {
            if (streakUpdated) {
              addEntry('🔥 Daily play streak +1!', 'winner')
              setCelebrating(true)
            }
          }).catch(() => { /* non-critical */ })
        }
      }
      if (prevStepRef.current === 'RECORD_STATS_AND_NEW_HAND' && currentStep === 'GAME_PREP') {
        addEntry('--- New Hand ---', 'info')
      }
    }
    prevStepRef.current = currentStep
  }, [tableState, addEntry, displayName, playerId, spectate])

  if (!exclusionChecked || loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh" bgcolor="#0a0e14">
        <CircularProgress />
      </Box>
    )
  }

  if (isExcluded) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="100vh" bgcolor="#0a0e14" gap={2} p={4}>
        <BlockIcon sx={{ fontSize: 64, color: '#EF5350' }} />
        <Typography variant="h5" fontWeight={700} color="#fff">
          Self-Exclusion Active
        </Typography>
        <Typography color="#8B8FA3" fontSize={14} textAlign="center" maxWidth={400}>
          You are self-excluded until {new Date(selfExcludedUntil!).toLocaleDateString()}.
        </Typography>
        <Button onClick={() => navigate('/')} startIcon={<ArrowBackIcon />} sx={{ color: '#90CAF9', textTransform: 'none', mt: 1 }}>
          Back to Dashboard
        </Button>
      </Box>
    )
  }

  if (error) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="100vh" bgcolor="#0a0e14" gap={2} p={4}>
        <Alert severity="error" sx={{ maxWidth: 500 }}>{error}</Alert>
        <Typography color="text.secondary" fontSize={13}>
          Make sure the new poker stack is running: <code>npm run play</code>
        </Typography>
        <IconButton onClick={() => navigate('/')} sx={{ color: '#90CAF9' }}>
          <ArrowBackIcon /> <Typography sx={{ ml: 1, fontSize: 14 }}>Back to Dashboard</Typography>
        </IconButton>
      </Box>
    )
  }

  if (!tableState) return null

  return (
    <Box sx={{ height: '100vh', bgcolor: '#0a0e14', display: 'flex', overflow: 'hidden' }}>
      <Celebration active={celebrating} onComplete={() => setCelebrating(false)} />
      <WinCelebration active={winCelebrating} amount={winAmount} winnerName={winnerName} onComplete={() => setWinCelebrating(false)} />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <Box sx={{ px: { xs: 1, md: 2 }, py: 1, display: 'flex', alignItems: 'center', bgcolor: '#0d1219', borderBottom: '1px solid #1e2a3a', flexShrink: 0 }}>
          <IconButton onClick={() => navigate('/lobby')} sx={{ color: '#90CAF9', mr: 1 }} size="small">
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Box flex={1} display="flex" justifyContent="center">
            <PhaseIndicator
              handStep={tableState.game.handStep}
              stepName={tableState.game.stepName}
              gameNo={tableState.game.gameNo}
            />
          </Box>
          {spectate ? (
            <Typography color="#90CAF9" fontSize={12} fontWeight={600} sx={{ mr: 1 }}>SPECTATING</Typography>
          ) : mySeat != null ? (
            <Typography color="#8B8FA3" fontSize={12}>Your seat: {mySeat}</Typography>
          ) : null}
          {!spectate && (
            <Button
              size="small"
              onClick={handleSpawnBots}
              disabled={spawning || !requestedTableId}
              sx={{
                color: '#FFB300',
                textTransform: 'none',
                ml: 1,
                border: '1px solid rgba(255,179,0,0.4)',
                bgcolor: 'rgba(255,179,0,0.08)',
                '&:hover': { bgcolor: 'rgba(255,179,0,0.18)' },
                '&.Mui-disabled': { color: 'rgba(255,179,0,0.35)' },
              }}
            >
              {spawning ? 'Bots inbound…' : 'Spawn bots'}
            </Button>
          )}
          <Button size="small" onClick={() => navigate('/lobby')} sx={{ color: '#90CAF9', textTransform: 'none', ml: 1 }}>
            Lobby
          </Button>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PokerTable
            tableState={tableState}
            timerProgress={isBettingStep ? progress : undefined}
            timeLeft={isBettingStep ? timeLeft : undefined}
            heroPlayerId={playerId}
            heroDisplayName={displayName}
            heroSeat={
              spectate
                ? null
                : mySeat
                  ?? tableState.players.find((p) => String(p.playerId) === String(playerId))?.seat
                  ?? null
            }
            tableId={requestedTableId}
          />
        </Box>

        <Box sx={{ flexShrink: 0, bgcolor: '#0d1219', borderTop: '1px solid #1e2a3a', px: { xs: 1, md: 2 }, py: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <ActionButtons
            game={isBettingStep ? tableState.game : undefined}
            players={isBettingStep ? tableState.players : undefined}
            onAction={isBettingStep ? handleAction : undefined}
            mySeat={mySeat}
          />
          <GameControls
            onNextStep={() => { /* server auto-advances */ }}
            onToggleAuto={() => navigate('/lobby')}
            onCycleSpeed={() => {}}
            onReset={() => navigate('/lobby')}
            isPlaying={true}
            speedLabel="LIVE"
          />
        </Box>
      </Box>

      <Box sx={{ width: { md: 220, lg: 250 }, flexShrink: 0, bgcolor: '#0d1117', borderLeft: '1px solid #1e2a3a', p: 1.5, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', minHeight: 0 }}>
        <HandHistoryLog entries={entries} />
      </Box>
    </Box>
  )
}

export default PokerGame
