import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Typography, Card, CardContent, Stack, CircularProgress, Button, Chip, Dialog, DialogTitle, DialogContent, IconButton, Tooltip } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import CloseIcon from '@mui/icons-material/Close'
import { useAuth } from '../hooks/useAuth'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import VisibilityIcon from '@mui/icons-material/Visibility'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import CasinoIcon from '@mui/icons-material/Casino'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import LeaderboardIcon from '@mui/icons-material/Leaderboard'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import BoltIcon from '@mui/icons-material/Bolt'
import StopIcon from '@mui/icons-material/Stop'
import GroupIcon from '@mui/icons-material/Group'
import PaymentsIcon from '@mui/icons-material/Payments'
import gsap from 'gsap'

const GATEWAY_HTTP = (import.meta.env.VITE_GATEWAY_HTTP_URL as string) || 'http://localhost:3002'

interface TableRow {
  tableId: string
  name: string
  openSeats: number
  maxSeats: number
  smallBlind: number
  bigBlind: number
}
interface StakeBlock {
  stake: string
  meta: { id: string; name: string; smallBlind: number; bigBlind: number; maxSeats: number }
  tables: TableRow[]
}

const STAKES = ['1-2', '5-10', '25-50']
const TIER_LABEL: Record<string, string> = {
  '1-2': 'MICRO',
  '5-10': 'LOW',
  '25-50': 'MID',
}

type TierFilter = 'ALL' | 'MICRO' | 'LOW' | 'MID' | 'HIGH'

interface AdminStats {
  totalTables: number
  totalSeated: number
  openSeats: number
  swarmRunning: boolean
}

// Theme tokens — matched to Daily Streaks dashboard palette
const C = {
  bg: '#0F1117',
  surface: 'rgba(26, 29, 39, 0.6)',
  surfaceSolid: '#1A1D27',
  surfaceLow: '#141720',
  surfaceHigh: '#1A1D27',
  border: '#2A2D3A',
  borderHi: 'rgba(255,107,53,0.5)',
  text: '#FFFFFF',
  textDim: '#8B8FA3',
  cyan: '#FF6B35',
  cyanSoft: 'rgba(255,107,53,0.15)',
  orange: '#FF6B35',
  orangeSoft: 'rgba(255,107,53,0.15)',
  green: '#4ADE80',
  red: '#EF5350',
}

const AVATAR_COUNT = 24
const AVATAR_KEY = 'hijack:avatarId'

function PokerLobby() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [avatarId, setAvatarId] = useState<string>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(AVATAR_KEY) : null
    return stored ?? '1'
  })
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const displayName =
    user?.displayName?.trim() ||
    (user?.email ? user.email.split('@')[0] : '') ||
    'Player'
  const handlePickAvatar = (id: string) => {
    setAvatarId(id)
    try { localStorage.setItem(AVATAR_KEY, id) } catch { /* ignore */ }
    setAvatarPickerOpen(false)
  }
  const [data, setData] = useState<StakeBlock[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [spawning, setSpawning] = useState(false)
  const [tier, setTier] = useState<TierFilter>('ALL')
  const tablesGridRef = useRef<HTMLDivElement | null>(null)
  const lastStatsRef = useRef<AdminStats | null>(null)
  const statTablesRef = useRef<HTMLSpanElement | null>(null)
  const statSeatedRef = useRef<HTMLSpanElement | null>(null)
  const statOpenRef = useRef<HTMLSpanElement | null>(null)

  // Count-up animation when stats change
  useEffect(() => {
    if (!stats) return
    const prev = lastStatsRef.current
    const tweenCount = (el: HTMLElement | null, from: number, to: number) => {
      if (!el) return
      const obj = { v: from }
      gsap.to(obj, {
        v: to,
        duration: 0.6,
        ease: 'power2.out',
        onUpdate: () => { el.textContent = String(Math.round(obj.v)) },
      })
    }
    tweenCount(statTablesRef.current, prev?.totalTables ?? stats.totalTables, stats.totalTables)
    tweenCount(statSeatedRef.current, prev?.totalSeated ?? stats.totalSeated, stats.totalSeated)
    tweenCount(statOpenRef.current,   prev?.openSeats   ?? stats.openSeats,   stats.openSeats)
    lastStatsRef.current = stats
  }, [stats])

  async function spawnSwarm(total: number) {
    setSpawning(true)
    try {
      await fetch(`${GATEWAY_HTTP}/admin/swarm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ total, ramp: 100 }),
      })
    } finally {
      setSpawning(false)
    }
  }
  async function stopSwarm() {
    await fetch(`${GATEWAY_HTTP}/admin/swarm/stop`, { method: 'POST' })
  }

  useEffect(() => {
    let cancelled = false
    async function pull() {
      try {
        const blocks = await Promise.all(
          STAKES.map(async (s) => {
            const r = await fetch(`${GATEWAY_HTTP}/lobby/${encodeURIComponent(s)}`)
            if (!r.ok) throw new Error(`lobby ${s}: ${r.status}`)
            return r.json() as Promise<StakeBlock>
          })
        )
        if (!cancelled) {
          setData(blocks)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
          setLoading(false)
        }
      }
    }
    async function pullStats() {
      try {
        const r = await fetch(`${GATEWAY_HTTP}/admin/stats`)
        if (r.ok && !cancelled) setStats(await r.json())
      } catch { /* ignore */ }
    }
    pull()
    pullStats()
    const id = setInterval(() => { pull(); pullStats(); }, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Stagger-fade-in table cards on initial load + on data refresh.
  useEffect(() => {
    if (!tablesGridRef.current) return
    const cards = tablesGridRef.current.querySelectorAll('[data-table-card]')
    if (cards.length === 0) return
    gsap.fromTo(
      cards,
      { opacity: 0, y: 18, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out', stagger: 0.05 }
    )
  }, [data.length, tier])

  const filteredBlocks = useMemo(() => {
    if (tier === 'ALL') return data
    return data.filter((b) => TIER_LABEL[b.stake] === tier)
  }, [data, tier])

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh" bgcolor={C.bg}>
        <CircularProgress sx={{ color: C.cyan }} />
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, color: C.text, position: 'relative' }}>
      {/* Top app bar */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          height: 64,
          px: { xs: 2, md: 3 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'rgba(2, 6, 23, 0.7)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Button
            onClick={() => navigate('/')}
            startIcon={<ArrowBackIcon />}
            sx={{ color: C.cyan, textTransform: 'none', minWidth: 0 }}
          >
            Back
          </Button>
          <Typography
            sx={{
              fontWeight: 900,
              fontStyle: 'italic',
              fontSize: { xs: 18, md: 22 },
              color: C.orange,
              letterSpacing: 0.5,
              textShadow: '0 0 10px rgba(249,115,22,0.45)',
            }}
          >
            HIJACK POKER
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              gap: 1,
              bgcolor: C.surfaceHigh,
              borderRadius: 999,
              px: 1.5,
              py: 0.5,
            }}
          >
            <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: C.text, fontSize: 14 }}>
              ${stats ? (stats.totalSeated * 100).toLocaleString() : '0.00'}
            </Typography>
            <Box
              sx={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                color: C.cyan,
                bgcolor: C.surfaceLow,
                px: 1,
                py: 0.25,
                borderRadius: 999,
              }}
            >
              LIVE
            </Box>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
        {/* Side nav (lg+) */}
        <Box
          component="nav"
          sx={{
            display: { xs: 'none', lg: 'flex' },
            flexDirection: 'column',
            width: 240,
            position: 'sticky',
            top: 64,
            alignSelf: 'flex-start',
            height: 'calc(100vh - 64px)',
            bgcolor: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRight: `1px solid ${C.border}`,
          }}
        >
          <Box sx={{ p: 3, borderBottom: `1px solid ${C.border}`, textAlign: 'center' }}>
            <Tooltip title="Change avatar" placement="bottom">
              <Box
                onClick={() => setAvatarPickerOpen(true)}
                sx={{
                  position: 'relative',
                  width: 72,
                  height: 72,
                  mx: 'auto',
                  mb: 1.5,
                  cursor: 'pointer',
                  '&:hover .pl-edit-badge': { opacity: 1 },
                }}
              >
                <Box
                  component="img"
                  src={`/avatars/${avatarId}.svg`}
                  alt={displayName}
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    border: `2px solid ${C.cyan}`,
                    display: 'block',
                    boxShadow: '0 0 18px rgba(255,107,53,0.35)',
                    bgcolor: C.surfaceLow,
                  }}
                />
                <Box
                  className="pl-edit-badge"
                  sx={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    bgcolor: C.cyan,
                    color: '#0F1117',
                    border: '2px solid #0F1117',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.9,
                    transition: 'opacity .15s',
                    '& svg': { fontSize: 14 },
                  }}
                >
                  <EditIcon />
                </Box>
              </Box>
            </Tooltip>
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: 15,
                color: '#fff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={displayName}
            >
              {displayName.toUpperCase()}
            </Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.cyan, mt: 0.5 }}>
              ELITE TIER
            </Typography>
          </Box>
          <Box sx={{ flex: 1, py: 2, px: 1, overflowY: 'auto' }}>
            <SideLink icon={<CasinoIcon />} label="Lobby" active />
            <SideLink icon={<EmojiEventsIcon />} label="Dashboard" onClick={() => navigate('/')} />
            <SideLink icon={<LeaderboardIcon />} label="Leaderboard" onClick={() => navigate('/admin')} />
            <SideLink icon={<AdminPanelSettingsIcon />} label="Admin" onClick={() => navigate('/admin/players')} />
          </Box>
          <Box sx={{ p: 2, borderTop: `1px solid ${C.border}` }}>
            <Button
              fullWidth
              onClick={() => {
                const first = data.find((b) => b.tables.some((t) => t.openSeats > 0))
                const t = first?.tables.find((x) => x.openSeats > 0)
                if (first && t) navigate(`/play?stake=${first.stake}&tableId=${t.tableId}`)
              }}
              sx={{
                color: C.cyan,
                border: `1px solid ${C.borderHi}`,
                bgcolor: 'rgba(255,255,255,0.04)',
                textTransform: 'none',
                fontWeight: 700,
                py: 1,
                boxShadow: '0 0 15px rgba(14,165,233,0.2)',
                '&:hover': { bgcolor: 'rgba(34,211,238,0.12)' },
              }}
            >
              Quick Join
            </Button>
          </Box>
        </Box>

        {/* Main content */}
        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 4 }, overflowX: 'hidden' }}>
          <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
            {error && (
              <Box
                sx={{
                  mb: 3,
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'rgba(248,113,113,0.08)',
                  border: '1px solid rgba(248,113,113,0.4)',
                  color: C.red,
                }}
              >
                {error}
              </Box>
            )}

            {/* Hero banner */}
            <Box
              sx={{
                position: 'relative',
                borderRadius: 3,
                overflow: 'hidden',
                minHeight: 240,
                mb: 4,
                p: { xs: 3, md: 4 },
                display: 'flex',
                alignItems: 'flex-end',
                background:
                  'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(11,19,38,0.85) 50%, rgba(255,107,53,0.18) 100%)',
                border: `1px solid ${C.border}`,
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  opacity: 0.35,
                  background:
                    'radial-gradient(circle at 18% 28%, rgba(255,107,53,0.4), transparent 50%), radial-gradient(circle at 82% 72%, rgba(255,107,53,0.45), transparent 50%)',
                },
              }}
            >
              <HeroDealAnimation />
              <Box sx={{ position: 'relative', zIndex: 5, width: '100%', maxWidth: { md: '56%' } }}>
                <Box
                  sx={{
                    display: 'inline-block',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 2,
                    color: C.orange,
                    bgcolor: C.orangeSoft,
                    border: '1px solid rgba(255,107,53,0.4)',
                    borderRadius: 1,
                    px: 1,
                    py: 0.5,
                    mb: 1.5,
                  }}
                >
                  WELCOME
                </Box>
                <Typography sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 700, color: '#fff', mb: 1, letterSpacing: -0.5 }}>
                  NEON FELT IS LIVE
                </Typography>
                <Typography sx={{ color: C.textDim, maxWidth: 560, fontSize: 15 }}>
                  Pick a stake, claim a seat, and the matchmaker spins up a fresh table the moment one fills.
                </Typography>
              </Box>
            </Box>

            {/* Stress-test / live cluster panel */}
            <Card
              sx={{
                bgcolor: C.surface,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: `1px solid ${C.border}`,
                borderRadius: 3,
                mb: 4,
              }}
            >
              <CardContent>
                <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} spacing={2} flexWrap="wrap" useFlexGap>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <BoltIcon sx={{ color: C.cyan, fontSize: 18 }} />
                      <Typography sx={{ fontWeight: 700, fontSize: 11, letterSpacing: 2, color: C.cyan }}>
                        LIVE CLUSTER
                      </Typography>
                      {stats?.swarmRunning && (
                        <Box
                          sx={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: 1,
                            color: C.orange,
                            bgcolor: C.orangeSoft,
                            border: '1px solid rgba(249,115,22,0.4)',
                            borderRadius: 1,
                            px: 1,
                            py: 0.25,
                          }}
                        >
                          SWARM RUNNING
                        </Box>
                      )}
                    </Stack>
                    <Typography sx={{ color: C.textDim, fontSize: 13 }}>
                      <Box component="span" ref={statTablesRef} sx={{ color: C.cyan, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 18 }}>0</Box>{' '}
                      <Box component="span" sx={{ mr: 1.5 }}>tables</Box>
                      <Box component="span" ref={statSeatedRef} sx={{ color: C.green, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 18 }}>0</Box>{' '}
                      <Box component="span" sx={{ mr: 1.5 }}>seated</Box>
                      <Box component="span" ref={statOpenRef} sx={{ color: C.orange, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 18 }}>0</Box>{' '}
                      <Box component="span">open</Box>
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => spawnSwarm(500)}
                      disabled={spawning}
                      sx={{
                        textTransform: 'none',
                        borderColor: C.borderHi,
                        color: C.cyan,
                        '&:hover': { borderColor: C.cyan, bgcolor: 'rgba(34,211,238,0.08)' },
                      }}
                    >
                      +500 bots
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => spawnSwarm(2000)}
                      disabled={spawning}
                      sx={{
                        textTransform: 'none',
                        borderColor: C.borderHi,
                        color: C.cyan,
                        '&:hover': { borderColor: C.cyan, bgcolor: 'rgba(34,211,238,0.08)' },
                      }}
                    >
                      +2000 bots
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => spawnSwarm(10000)}
                      disabled={spawning}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        bgcolor: C.orange,
                        color: '#fff',
                        boxShadow: '0 0 15px rgba(249,115,22,0.35)',
                        '&:hover': { bgcolor: '#ea580c' },
                      }}
                    >
                      Spawn 10,000 bot swarm
                    </Button>
                    {stats?.swarmRunning && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={stopSwarm}
                        startIcon={<StopIcon />}
                        sx={{
                          textTransform: 'none',
                          borderColor: 'rgba(248,113,113,0.5)',
                          color: C.red,
                          '&:hover': { borderColor: C.red, bgcolor: 'rgba(248,113,113,0.08)' },
                        }}
                      >
                        Stop swarm
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Cash games header + tier filter */}
            <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={2} mb={2}>
              <Typography sx={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: -0.3 }}>
                CASH GAMES
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, bgcolor: C.surfaceHigh, p: 0.5, borderRadius: 2 }}>
                {(['ALL', 'MICRO', 'LOW', 'MID', 'HIGH'] as TierFilter[]).map((t) => (
                  <Button
                    key={t}
                    onClick={() => setTier(t)}
                    sx={{
                      textTransform: 'none',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      px: 1.5,
                      py: 0.5,
                      minWidth: 0,
                      borderRadius: 1,
                      color: tier === t ? C.cyan : C.textDim,
                      bgcolor: tier === t ? C.surfaceLow : 'transparent',
                      '&:hover': { color: '#fff', bgcolor: tier === t ? C.surfaceLow : 'rgba(255,255,255,0.04)' },
                    }}
                  >
                    {t}
                  </Button>
                ))}
              </Box>
            </Stack>

            {/* Tables grid grouped by stake */}
            <Stack spacing={4} ref={tablesGridRef}>
              {filteredBlocks.length === 0 && (
                <Typography sx={{ color: C.textDim, fontStyle: 'italic' }}>
                  No tables for this tier yet.
                </Typography>
              )}
              {filteredBlocks.map((block) => {
                const tierLabel = TIER_LABEL[block.stake] ?? 'STAKES'
                return (
                  <Box key={block.stake}>
                    <Stack direction="row" alignItems="baseline" spacing={1.5} mb={1.5}>
                      <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>
                        {block.meta.name}
                      </Typography>
                      <Chip
                        label={tierLabel}
                        size="small"
                        sx={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: 1.5,
                          color: tierLabel === 'MID' ? C.orange : C.cyan,
                          bgcolor: tierLabel === 'MID' ? C.orangeSoft : C.cyanSoft,
                          border: `1px solid ${tierLabel === 'MID' ? 'rgba(249,115,22,0.4)' : C.borderHi}`,
                          height: 20,
                        }}
                      />
                      <Typography sx={{ color: C.textDim, fontSize: 13 }}>
                        Blinds ${block.meta.smallBlind}/${block.meta.bigBlind} · seats {block.meta.maxSeats}
                      </Typography>
                    </Stack>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                          md: 'repeat(3, minmax(0, 1fr))',
                        },
                        gap: 2,
                      }}
                    >
                      {block.tables.length === 0 && (
                        <Typography sx={{ color: '#666', fontStyle: 'italic' }}>No active tables.</Typography>
                      )}
                      {block.tables.map((t) => (
                        <TableCard
                          key={t.tableId}
                          row={t}
                          tierLabel={tierLabel}
                          onPlay={() => navigate(`/play?stake=${block.stake}&tableId=${t.tableId}`)}
                          onWatch={() => navigate(`/play?stake=${block.stake}&tableId=${t.tableId}&spectate=1`)}
                        />
                      ))}
                    </Box>
                  </Box>
                )
              })}
            </Stack>
          </Box>
        </Box>
      </Box>

      {/* Avatar picker — bundled SVG set 1..24 */}
      <Dialog
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: C.surfaceSolid,
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            color: C.text,
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>Choose your avatar</Typography>
            <Typography sx={{ fontSize: 12, color: C.textDim }}>Pick one — it sticks to your profile.</Typography>
          </Box>
          <IconButton onClick={() => setAvatarPickerOpen(false)} sx={{ color: C.textDim }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 1.5,
            }}
          >
            {Array.from({ length: AVATAR_COUNT }, (_, i) => String(i + 1)).map((id) => {
              const selected = id === avatarId
              return (
                <Box
                  key={id}
                  onClick={() => handlePickAvatar(id)}
                  sx={{
                    position: 'relative',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    p: 0.5,
                    bgcolor: selected ? C.cyanSoft : 'transparent',
                    border: `2px solid ${selected ? C.cyan : 'transparent'}`,
                    transition: 'all .15s',
                    '&:hover': { bgcolor: C.cyanSoft, transform: 'scale(1.05)' },
                  }}
                >
                  <Box
                    component="img"
                    src={`/avatars/${id}.svg`}
                    alt={`Avatar ${id}`}
                    sx={{ width: '100%', height: 'auto', display: 'block', borderRadius: '50%', bgcolor: C.surfaceLow }}
                  />
                </Box>
              )
            })}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}

function SideLink({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1,
        mx: 0.5,
        my: 0.5,
        borderRadius: 1.5,
        cursor: onClick ? 'pointer' : 'default',
        color: active ? C.cyan : C.textDim,
        bgcolor: active ? 'rgba(34,211,238,0.1)' : 'transparent',
        borderRight: active ? `2px solid ${C.cyan}` : '2px solid transparent',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        transition: 'all 0.2s',
        '&:hover': onClick ? { bgcolor: 'rgba(255,255,255,0.04)', color: C.cyan } : {},
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', '& svg': { fontSize: 20 } }}>{icon}</Box>
      {label}
    </Box>
  )
}

function TableCard({
  row,
  tierLabel,
  onPlay,
  onWatch,
}: {
  row: TableRow
  tierLabel: string
  onPlay: () => void
  onWatch: () => void
}) {
  const seated = row.maxSeats - row.openSeats
  const full = row.openSeats === 0
  // Deterministic suit triplet per table so the background stays stable.
  const SUITS = ['♠', '♥', '♦', '♣']
  let h = 0
  for (let i = 0; i < row.tableId.length; i += 1) h = (h * 31 + row.tableId.charCodeAt(i)) >>> 0
  const s1 = SUITS[h % 4]
  const s2 = SUITS[(h >> 3) % 4]
  const s3 = SUITS[(h >> 5) % 4]
  return (
    <Card
      data-table-card
      onMouseEnter={(e) => gsap.to(e.currentTarget, { y: -4, duration: 0.18, ease: 'power2.out' })}
      onMouseLeave={(e) => gsap.to(e.currentTarget, { y: 0, duration: 0.22, ease: 'power2.out' })}
      sx={{
        position: 'relative',
        bgcolor: C.surface,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${C.border}`,
        borderRadius: 3,
        overflow: 'hidden',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: C.borderHi,
          boxShadow: '0 0 20px rgba(34,211,238,0.15)',
        },
        '&:hover .suit-bg .suit': { opacity: 0.32 },
        '@keyframes lobbyDrift': {
          '0%, 100%': { transform: 'translateY(0) rotate(-6deg)', opacity: 0.16 },
          '50%':      { transform: 'translateY(-10px) rotate(2deg)', opacity: 0.26 },
        },
      }}
    >
      {/* Faded drifting suit glyphs on the right side */}
      <Box
        className="suit-bg"
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: '60%',
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, #000 50%, #000 100%)',
          maskImage: 'linear-gradient(to right, transparent 0%, #000 50%, #000 100%)',
          '& .suit': {
            position: 'absolute',
            color: C.orange,
            opacity: 0.16,
            lineHeight: 1,
            fontWeight: 900,
            willChange: 'transform, opacity',
            transition: 'opacity .25s',
          },
        }}
      >
        <Box className="suit" sx={{ right: '8%',  top: '12%',    fontSize: 96, animation: 'lobbyDrift 6s ease-in-out infinite' }}>{s1}</Box>
        <Box className="suit" sx={{ right: '38%', top: '48%',    fontSize: 56, animation: 'lobbyDrift 7s ease-in-out -1.5s infinite' }}>{s2}</Box>
        <Box className="suit" sx={{ right: '18%', bottom: '6%',  fontSize: 72, animation: 'lobbyDrift 8s ease-in-out -3s infinite' }}>{s3}</Box>
      </Box>
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          px: 2,
          py: 1.5,
          bgcolor: C.surfaceLow,
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.name}
          </Typography>
          <Typography sx={{ color: C.textDim, fontSize: 12 }}>No Limit Hold&rsquo;em</Typography>
        </Box>
        <Box
          sx={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: tierLabel === 'MID' ? C.orange : C.cyan,
            bgcolor: tierLabel === 'MID' ? C.orangeSoft : C.cyanSoft,
            border: `1px solid ${tierLabel === 'MID' ? 'rgba(249,115,22,0.4)' : C.borderHi}`,
            borderRadius: 1,
            px: 1,
            py: 0.25,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {tierLabel} STAKES
        </Box>
      </Box>
      <CardContent sx={{ position: 'relative', zIndex: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <PaymentsIcon sx={{ color: C.textDim, fontSize: 18 }} />
            <Typography sx={{ color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
              ${row.smallBlind} / ${row.bigBlind}
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <GroupIcon sx={{ color: C.textDim, fontSize: 18 }} />
            <Typography sx={{ color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
              {seated} / {row.maxSeats}
            </Typography>
          </Stack>
        </Stack>

        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
          {Array.from({ length: row.maxSeats }).map((_, i) => {
            const filled = i < seated
            return (
              <Box
                key={i}
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: filled ? C.cyan : C.textDim,
                  bgcolor: filled ? C.cyanSoft : 'transparent',
                  border: filled ? `1px solid ${C.cyan}` : '1px dashed rgba(148,163,184,0.4)',
                }}
              >
                {filled ? `P${i + 1}` : ''}
              </Box>
            )
          })}
        </Box>

        <Stack direction="row" spacing={1} sx={{ pt: 1.5, borderTop: `1px solid ${C.border}` }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<PlayArrowIcon />}
            disabled={full}
            onClick={onPlay}
            sx={{
              flex: 1,
              textTransform: 'none',
              fontWeight: 700,
              letterSpacing: 1,
              bgcolor: full ? C.surfaceHigh : 'rgba(255,255,255,0.04)',
              color: full ? C.textDim : C.cyan,
              border: `1px solid ${full ? 'transparent' : C.borderHi}`,
              boxShadow: 'none',
              '&:hover': {
                bgcolor: full ? C.surfaceHigh : 'rgba(34,211,238,0.12)',
                boxShadow: full ? 'none' : '0 0 15px rgba(34,211,238,0.25)',
              },
              '&.Mui-disabled': { color: C.textDim },
            }}
          >
            {full ? 'Full' : 'Play'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<VisibilityIcon />}
            onClick={onWatch}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              letterSpacing: 1,
              color: C.cyan,
              borderColor: C.border,
              '&:hover': { borderColor: C.borderHi, bgcolor: 'rgba(34,211,238,0.06)' },
            }}
          >
            Watch
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

// Hero "live community deal" animation — plays a flop/turn/river loop on the
// right side of the hero banner. Pure CSS keyframes, ~6s loop.
function HeroDealAnimation() {
  const cards: Array<{ rank: string; suit: '♠' | '♥' | '♦' | '♣'; tx: number; delay: string }> = [
    { rank: '10', suit: '♥', tx: -440, delay: '0.10s' },
    { rank: 'J',  suit: '♥', tx: -356, delay: '0.30s' },
    { rank: 'Q',  suit: '♥', tx: -272, delay: '0.50s' },
    { rank: 'K',  suit: '♥', tx: -188, delay: '1.50s' },
    { rank: 'A',  suit: '♥', tx: -104, delay: '2.30s' },
  ]
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: { xs: 0, md: '52%' },
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0%, #000 35%, #000 100%)',
        maskImage: 'linear-gradient(to right, transparent 0%, #000 35%, #000 100%)',
        '@keyframes heroDeal': {
          '0%':   { transform: 'translate(0, 0) scale(0.55) rotateY(180deg) rotate(-8deg)', opacity: 0 },
          '3%':   { opacity: 1 },
          '10%':  { transform: 'translate(var(--tx), -8px) scale(1.02) rotateY(180deg) rotate(2deg)', opacity: 1 },
          '14%':  { transform: 'translate(var(--tx), 0) scale(1) rotateY(180deg) rotate(0deg)' },
          '20%':  { transform: 'translate(var(--tx), 0) scale(1) rotateY(0deg) rotate(0deg)' },
          '62%':  { transform: 'translate(var(--tx), 0) scale(1) rotateY(0deg) rotate(0deg)', opacity: 1 },
          '72%':  { transform: 'translate(var(--tx), -6px) scale(1.04) rotateY(0deg) rotate(0deg)', opacity: 1 },
          '82%':  { transform: 'translate(var(--tx), 30px) scale(0.85) rotateY(0deg) rotate(0deg)', opacity: 0 },
          '100%': { transform: 'translate(0, 0) scale(0.55) rotateY(180deg) rotate(-8deg)', opacity: 0 },
        },
        '@keyframes heroDeckPulse': {
          '0%, 100%': { filter: 'drop-shadow(0 0 0 rgba(255,107,53,0))' },
          '8%, 32%':  { filter: 'drop-shadow(0 0 12px rgba(255,107,53,0.6))' },
          '50%':      { filter: 'drop-shadow(0 0 0 rgba(255,107,53,0))' },
        },
        '@keyframes heroBoardGlow': {
          '0%, 50%, 100%': { opacity: 0, transform: 'scaleX(0.9)' },
          '62%, 72%':       { opacity: 0.9, transform: 'scaleX(1)' },
          '82%':            { opacity: 0 },
        },
      }}
    >
      {/* Winning-hand glow that pulses when board is full */}
      <Box
        sx={{
          position: 'absolute',
          left: '4%',
          right: '12%',
          top: '50%',
          height: 130,
          mt: '-65px',
          borderRadius: 4,
          background: 'radial-gradient(closest-side, rgba(255,107,53,0.28), transparent 70%)',
          animation: 'heroBoardGlow 6s ease-in-out infinite',
          opacity: 0,
        }}
      />

      {/* Idle deck (back-of-card stack) */}
      <Box
        sx={{
          position: 'absolute',
          right: 24,
          top: '50%',
          mt: '-56px',
          width: 80,
          height: 112,
          animation: 'heroDeckPulse 6s ease-in-out infinite',
        }}
      >
        {[ -3, 0, 3 ].map((rot, i) => (
          <Box
            key={i}
            sx={{
              position: 'absolute',
              inset: 0,
              transform: `translate(${i * -3}px, ${i * 1}px) rotate(${rot}deg)`,
            }}
          >
            <CardBack />
          </Box>
        ))}
      </Box>

      {/* Dealt cards — each animates from the deck to its slot */}
      {cards.map((c, i) => (
        <Box
          key={i}
          style={{ ['--tx' as string]: `${c.tx}px`, animationDelay: c.delay }}
          sx={{
            position: 'absolute',
            right: 24,
            top: '50%',
            mt: '-56px',
            width: 80,
            height: 112,
            transformStyle: 'preserve-3d',
            animation: 'heroDeal 6s ease-in-out infinite both',
            willChange: 'transform, opacity',
          }}
        >
          <CardBack />
          <CardFace rank={c.rank} suit={c.suit} />
        </Box>
      ))}
    </Box>
  )
}

function CardBack() {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        borderRadius: '8px',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'rotateY(180deg)',
        background:
          'repeating-linear-gradient(45deg, #FF6B35 0 6px, #2E1411 6px 12px), #2E1411',
        border: '2px solid #FF6B35',
        boxShadow: '0 6px 18px rgba(0,0,0,0.55)',
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 6,
          borderRadius: '4px',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(15,17,23,0.4)',
        },
      }}
    />
  )
}

function CardFace({ rank, suit }: { rank: string; suit: '♠' | '♥' | '♦' | '♣' }) {
  const isRed = suit === '♥' || suit === '♦'
  const color = isRed ? '#DC2626' : '#111111'
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        borderRadius: '8px',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        background: 'linear-gradient(180deg, #FFFFFF 0%, #F4F5F8 100%)',
        border: '1px solid #d8d9e0',
        boxShadow: '0 6px 18px rgba(0,0,0,0.55)',
        overflow: 'hidden',
        color,
      }}
    >
      <Box sx={{ position: 'absolute', top: 6, left: 6, textAlign: 'center', lineHeight: 1, fontFamily: 'Inter, sans-serif', fontWeight: 900 }}>
        <Box sx={{ fontSize: 14 }}>{rank}</Box>
        <Box sx={{ fontSize: 12, mt: '1px' }}>{suit}</Box>
      </Box>
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 44,
          lineHeight: 1,
        }}
      >
        {suit}
      </Box>
      <Box sx={{ position: 'absolute', bottom: 6, right: 6, textAlign: 'center', lineHeight: 1, fontFamily: 'Inter, sans-serif', fontWeight: 900, transform: 'rotate(180deg)', transformOrigin: 'center' }}>
        <Box sx={{ fontSize: 14 }}>{rank}</Box>
        <Box sx={{ fontSize: 12, mt: '1px' }}>{suit}</Box>
      </Box>
    </Box>
  )
}

export default PokerLobby
