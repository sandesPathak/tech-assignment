import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Typography, CircularProgress, Alert, IconButton, Button, Avatar, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import BlockIcon from '@mui/icons-material/Block'
import LogoutIcon from '@mui/icons-material/Logout'
import BarChartIcon from '@mui/icons-material/BarChart'
import PersonIcon from '@mui/icons-material/Person'
import PokerTable from '../components/poker/table/PokerTable'
import GameControls from '../components/poker/controls/GameControls'
import ActionButtons from '../components/poker/controls/ActionButtons'
import PhaseIndicator from '../components/poker/info/PhaseIndicator'
import HandHistoryLog from '../components/poker/info/HandHistoryLog'
import Celebration from '../components/Celebration'
import WinCelebration from '../components/poker/WinCelebration'
import FireAnimation from '../components/FireAnimation'
import { useAuth } from '../hooks/useAuth'
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
  const { user, signOut } = useAuth()
  const [profileAnchor, setProfileAnchor] = useState<null | HTMLElement>(null)
  const stake = searchParams.get('stake') || '1-2'
  const requestedTableId = searchParams.get('tableId')
  const spectate = searchParams.get('spectate') === '1'
  const [playerId] = useState(() => {
    const existing = localStorage.getItem('playerId')
    if (existing) return existing
    const generated = `guest-${Date.now()}`
    localStorage.setItem('playerId', generated)
    return generated
  })
  const displayName = (user?.displayName?.trim() || localStorage.getItem('displayName') || 'Hero')
  const { tableState, loading, error, sendAction, mySeat, tableId: connectedTableId, reconnect } = useGameStateWS({
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

  const heroById = tableState?.players.find((p) => String(p.playerId) === String(playerId)) ?? null
  const heroOwnsClaimedSeat = !!(
    mySeat != null
    && tableState?.players.some(
      (p) => Number(p.seat) === Number(mySeat) && String(p.playerId) === String(playerId),
    )
  )
  const heroInTable = !!heroById || heroOwnsClaimedSeat
  const isSeatedPlayer = !spectate && mySeat != null && heroInTable
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const pendingLeaveActionRef = useRef<null | (() => void)>(null)
  const requestLeaveConfirm = useCallback((action: () => void) => {
    if (!isSeatedPlayer) {
      action()
      return
    }
    pendingLeaveActionRef.current = action
    setLeaveConfirmOpen(true)
  }, [isSeatedPlayer])
  const navigateSafely = useCallback((to: string) => {
    requestLeaveConfirm(() => navigate(to))
  }, [requestLeaveConfirm, navigate])
  const confirmLeaveNow = useCallback(() => {
    const action = pendingLeaveActionRef.current
    pendingLeaveActionRef.current = null
    setLeaveConfirmOpen(false)
    if (action) action()
  }, [])
  const cancelLeaveNow = useCallback(() => {
    pendingLeaveActionRef.current = null
    setLeaveConfirmOpen(false)
  }, [])

  // Auto-fill empty seats with bots if the human is seated alone.
  // Fires once per (tableId, stake) per page-mount, ~2.5s after first snapshot
  // so a real human/bot already mid-join has time to land first.
  const filledRef = useRef(false)
  useEffect(() => {
    if (spectate) return
    if (filledRef.current) return
    if (!tableState) return
    if (mySeat == null) return
    if (!heroInTable) return
    const tableId = connectedTableId || requestedTableId
    if (!tableId) return
    const t = setTimeout(() => {
      const seated = tableState.players.filter((p) => p.seat != null).length
      // Fill only after hero is seated and alone (or table has one total seat).
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
  }, [tableState, connectedTableId, requestedTableId, mySeat, heroInTable, stake, spectate, adminHeaders])

  // Manual "Spawn Bots" button. Endpoint dedupes per-table within 30s,
  // so we mirror that lock client-side to keep the button visibly busy.
  const [spawning, setSpawning] = useState(false)

  // Self-heal on entry: if we have a claimed seat but our player row
  // never appears in tableState, force a reconnect/seat-claim cycle.
  const rejoinAttemptsRef = useRef(0)
  const rejoinTimerRef = useRef<number | null>(null)
  const missingSinceRef = useRef<number | null>(null)
  useEffect(() => {
    if (rejoinTimerRef.current) {
      window.clearTimeout(rejoinTimerRef.current)
      rejoinTimerRef.current = null
    }
    if (spectate || loading || !tableState || mySeat == null) return
    if (heroInTable) {
      rejoinAttemptsRef.current = 0
      missingSinceRef.current = null
      return
    }
    if (missingSinceRef.current == null) missingSinceRef.current = Date.now()
    const missingMs = Date.now() - missingSinceRef.current
    // Give gateway /sit retries time to settle first. Reconnecting too
    // early can cancel the in-flight seat sync and trap users in limbo.
    if (missingMs < 12_000) return
    if (rejoinAttemptsRef.current >= 3) return
    const delayMs = 2000 + rejoinAttemptsRef.current * 3000
    rejoinTimerRef.current = window.setTimeout(() => {
      rejoinAttemptsRef.current += 1
      addEntry('Rejoining seat…', 'info')
      reconnect({ avoidSeats: mySeat != null ? [Number(mySeat)] : [] })
    }, delayMs)
    return () => {
      if (rejoinTimerRef.current) {
        window.clearTimeout(rejoinTimerRef.current)
        rejoinTimerRef.current = null
      }
    }
  }, [spectate, loading, tableState, mySeat, heroInTable, reconnect, addEntry])

  const handleSpawnBots = useCallback(async () => {
    const targetTableId = connectedTableId || requestedTableId
    if (!targetTableId || spawning || !heroInTable) return
    setSpawning(true)
    try {
      const seated = tableState?.players.filter((p) => p.seat != null).length ?? 0
      const maxSeats = tableState?.game.maxSeats || 6
      const want = Math.min(8, Math.max(1, maxSeats - seated))
      await fetch(`${GATEWAY_HTTP}/admin/fill-table`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ tableId: targetTableId, stake, count: want }),
      })
    } catch { /* non-critical */ }
    setTimeout(() => setSpawning(false), 28_000)
  }, [connectedTableId, requestedTableId, stake, tableState, spawning, adminHeaders, heroInTable])

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
    // The gateway owns turn expiry so every client sees the same result.
    // The UI timer is informational only.
    if (mySeat != null && Number(seat) === Number(mySeat)) return
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
        <Button onClick={() => navigateSafely('/')} startIcon={<ArrowBackIcon />} sx={{ color: '#90CAF9', textTransform: 'none', mt: 1 }}>
          Back to Dashboard
        </Button>
      </Box>
    )
  }

  if (error) {
    const errorText = error === 'table_full'
      ? 'This table is full right now. Pick another table or wait for the next open seat.'
      : error
    return (
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="100vh" bgcolor="#0a0e14" gap={2} p={4}>
        <Alert severity="error" sx={{ maxWidth: 500 }}>{errorText}</Alert>
        <Typography color="text.secondary" fontSize={13}>
          Make sure the new poker stack is running: <code>npm run play</code>
        </Typography>
        <IconButton onClick={() => navigateSafely('/')} sx={{ color: '#90CAF9' }}>
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
          <IconButton onClick={() => navigateSafely('/lobby')} sx={{ color: '#90CAF9', mr: 1 }} size="small">
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Box
            onClick={() => navigateSafely('/')}
            sx={{ display: 'flex', alignItems: 'center', mr: 2, cursor: 'pointer' }}
          >
            <FireAnimation size={24} containerWidth={36} />
          </Box>
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
          <Button size="small" onClick={() => navigateSafely('/lobby')} sx={{ color: '#90CAF9', textTransform: 'none', ml: 1 }}>
            Lobby
          </Button>
          <IconButton
            onClick={(e) => setProfileAnchor(e.currentTarget)}
            sx={{ p: 0.5, ml: 1 }}
          >
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: '#FF6B35',
                fontSize: 13,
                fontWeight: 700,
                border: '2px solid #2A2D3A',
              }}
            >
              {(user?.displayName || user?.email || displayName || '?').charAt(0).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={profileAnchor}
            open={!!profileAnchor}
            onClose={() => setProfileAnchor(null)}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            PaperProps={{
              sx: {
                bgcolor: '#1A1D27',
                border: '1px solid #2A2D3A',
                borderRadius: 3,
                mt: 1,
                minWidth: 220,
                '& .MuiMenuItem-root': { fontSize: 13, color: '#fff', py: 1.2 },
                '& .MuiMenuItem-root:hover': { bgcolor: '#141720' },
              },
            }}
          >
            <Box sx={{ px: 2, py: 1.5 }}>
              <Box display="flex" alignItems="center" gap={1.5}>
                <Avatar sx={{ width: 40, height: 40, bgcolor: '#FF6B35', fontSize: 16, fontWeight: 700 }}>
                  {(user?.displayName || user?.email || displayName || '?').charAt(0).toUpperCase()}
                </Avatar>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                    {user?.displayName || displayName || 'Player'}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: '#8B8FA3' }}>
                    {user?.email || ''}
                  </Typography>
                </Box>
              </Box>
            </Box>
            <Divider sx={{ borderColor: '#2A2D3A' }} />
            <MenuItem onClick={() => { setProfileAnchor(null); navigateSafely('/'); }}>
              <ListItemIcon><PersonIcon sx={{ color: '#8B8FA3', fontSize: 20 }} /></ListItemIcon>
              <ListItemText>Dashboard</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setProfileAnchor(null); navigateSafely('/admin'); }}>
              <ListItemIcon><BarChartIcon sx={{ color: '#60A5FA', fontSize: 20 }} /></ListItemIcon>
              <ListItemText>Admin Analytics</ListItemText>
            </MenuItem>
            <Divider sx={{ borderColor: '#2A2D3A' }} />
            <MenuItem onClick={() => {
              requestLeaveConfirm(() => {
                setProfileAnchor(null)
                signOut()
              })
            }}>
              <ListItemIcon><LogoutIcon sx={{ color: '#EF5350', fontSize: 20 }} /></ListItemIcon>
              <ListItemText sx={{ '& .MuiTypography-root': { color: '#EF5350' } }}>Sign Out</ListItemText>
            </MenuItem>
          </Menu>
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
                : tableState.players.find((p) => String(p.playerId) === String(playerId))?.seat
                  ?? (heroOwnsClaimedSeat ? mySeat : null)
                  ?? null
            }
            tableId={connectedTableId || requestedTableId}
          />
        </Box>

        {!spectate && (
          <Box sx={{ flexShrink: 0, bgcolor: '#0d1219', borderTop: '1px solid #1e2a3a', px: { xs: 1, md: 2 }, py: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <ActionButtons
              game={isBettingStep ? tableState.game : undefined}
              players={isBettingStep ? tableState.players : undefined}
              onAction={isBettingStep ? handleAction : undefined}
              mySeat={mySeat}
            />
            <GameControls
              onNextStep={() => { /* server auto-advances */ }}
              onToggleAuto={() => { /* live mode only on this screen */ }}
              onCycleSpeed={() => {}}
              onReset={() => { /* table reset is not a player control */ }}
              isPlaying={true}
              speedLabel="LIVE"
              disabled
            />
          </Box>
        )}
      </Box>

      <Box sx={{ width: { md: 220, lg: 250 }, flexShrink: 0, bgcolor: '#0d1117', borderLeft: '1px solid #1e2a3a', p: 1.5, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', minHeight: 0 }}>
        <HandHistoryLog entries={entries} />
      </Box>

      <Dialog
        open={leaveConfirmOpen}
        onClose={cancelLeaveNow}
        BackdropProps={{
          sx: {
            background: 'rgba(6, 11, 20, 0.58)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          },
        }}
        PaperProps={{
          sx: {
            background:
              'linear-gradient(145deg, rgba(15,23,42,0.92) 0%, rgba(11,19,38,0.9) 60%, rgba(255,107,53,0.18) 100%)',
            color: '#e6edf3',
            border: '1px solid rgba(56,189,248,0.28)',
            borderRadius: 3,
            boxShadow: '0 18px 44px rgba(0,0,0,0.55), 0 0 24px rgba(255,107,53,0.22)',
            minWidth: { xs: 320, sm: 420 },
            overflow: 'hidden',
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              opacity: 0.45,
              background:
                'radial-gradient(circle at 18% 20%, rgba(34,211,238,0.22), transparent 50%), radial-gradient(circle at 84% 78%, rgba(255,107,53,0.26), transparent 52%)',
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 900, pb: 0.5, letterSpacing: 0.2, position: 'relative' }}>
          Leave Table?
        </DialogTitle>
        <DialogContent sx={{ pt: '4px !important' }}>
          <Typography sx={{ color: '#b8c4d4', fontSize: 14.5, position: 'relative' }}>
            You are seated at this table. If you leave now, your hand may auto-fold on your turn.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, pt: 1, position: 'relative' }}>
          <Button
            onClick={cancelLeaveNow}
            sx={{
              color: '#c4d2df',
              textTransform: 'none',
              border: '1px solid rgba(148,163,184,0.38)',
              bgcolor: 'rgba(148,163,184,0.08)',
              '&:hover': { bgcolor: 'rgba(148,163,184,0.16)', borderColor: 'rgba(148,163,184,0.58)' },
            }}
          >
            Stay
          </Button>
          <Button
            onClick={confirmLeaveNow}
            variant="contained"
            sx={{
              bgcolor: '#FF6B35',
              '&:hover': { bgcolor: '#ea580c' },
              textTransform: 'none',
              fontWeight: 800,
              boxShadow: '0 0 15px rgba(249,115,22,0.35)',
            }}
          >
            Leave Table
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default PokerGame
