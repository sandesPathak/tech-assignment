import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Card, CardContent, Button, Chip, Skeleton } from '@mui/material';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import { useMissions } from '../hooks/useMissions';
import Celebration from './Celebration';
import gsap from 'gsap';
import { createLobbyInsetSx, createLobbyPanelSx, createLobbyPillSx, lobbyPalette } from '../styles/lobbyChrome';

function MissionsPanel() {
  const { missions, pointsEarnedToday, loading, claimMission } = useMissions();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const barsAnimated = useRef(false);

  const handleClaim = async (missionId: string) => {
    setClaiming(missionId);
    try {
      await claimMission(missionId);
      setCelebrating(true);
    } catch (err) {
      console.error('Failed to claim mission:', err);
    } finally {
      setClaiming(null);
    }
  };

  // Staggered card entrance + progress bar fill
  useEffect(() => {
    if (loading || !listRef.current || barsAnimated.current) return;
    barsAnimated.current = true;

    const cards = listRef.current.querySelectorAll<HTMLElement>('[data-mission]');
    const bars = listRef.current.querySelectorAll<HTMLElement>('[data-bar]');

    // Stagger cards in
    gsap.fromTo(cards,
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, stagger: 0.12, ease: 'power3.out' }
    );

    // Animate progress bars from 0 to their target width
    bars.forEach((bar) => {
      const target = bar.getAttribute('data-bar') || '0';
      gsap.fromTo(bar,
        { width: '0%' },
        { width: `${target}%`, duration: 1, delay: 0.4, ease: 'power2.out' }
      );
    });
  }, [loading, missions]);

  if (loading) {
    return (
      <Card sx={createLobbyPanelSx(lobbyPalette.orange)}>
        <CardContent sx={{ p: 3 }}>
          <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Celebration active={celebrating} label="CLAIMED!" onComplete={() => setCelebrating(false)} />
    <Card
      sx={createLobbyPanelSx(lobbyPalette.orange)}
    >
      <CardContent sx={{ p: 3, position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={1}>
            <TrackChangesIcon sx={{ color: '#FF6B35', fontSize: 24, filter: 'drop-shadow(0 0 8px rgba(255,107,53,0.6))' }} />
            <Typography variant="h6" fontWeight={800} color="#fff" sx={{ letterSpacing: -0.3 }}>
              Daily Missions
            </Typography>
          </Box>
          <Chip
            icon={<StarIcon sx={{ fontSize: 14 }} />}
            label={`${pointsEarnedToday} pts today`}
            size="small"
            sx={createLobbyPillSx(lobbyPalette.gold, 'rgba(251,191,36,0.10)')}
          />
        </Box>

        <Box ref={listRef} display="flex" flexDirection="column" gap={2}>
          {(missions ?? []).map((mission) => {
            const pct = mission.target > 0 ? Math.min((mission.progress / mission.target) * 100, 100) : 0;
            const isCompleted = mission.status === 'completed';
            const isClaimed = mission.status === 'claimed';
            const barColor = isClaimed ? '#4ADE80' : isCompleted ? '#FFB300' : '#FF6B35';
            const barGradient = isClaimed
              ? 'linear-gradient(90deg, #16A34A, #4ADE80)'
              : isCompleted
              ? 'linear-gradient(90deg, #FBBF24, #FFB300)'
              : 'linear-gradient(90deg, #FF6B35, #FBBF24)';
            const accentBorder = isClaimed
              ? 'rgba(74,222,128,0.35)'
              : isCompleted
              ? 'rgba(255,179,0,0.4)'
              : 'rgba(255,107,53,0.25)';

            return (
              <Box
                key={mission.missionId}
                data-mission
                sx={{
                  ...createLobbyInsetSx(barColor, isClaimed ? 'rgba(20,49,31,0.66)' : isCompleted ? 'rgba(57,42,8,0.72)' : 'rgba(12,14,22,0.76)'),
                  p: 2,
                  pl: 2.25,
                  opacity: 0,
                  transition: 'transform .2s, border-color .2s',
                  '&:hover': { transform: 'translateY(-2px)', borderColor: barColor },
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: isClaimed ? '#4ADE80' : isCompleted ? '#FFB300' : '#fff' }}>
                    {isClaimed && <CheckCircleIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />}
                    {mission.title}
                  </Typography>
                  <Chip
                    label={`+${mission.reward}`}
                    size="small"
                    sx={createLobbyPillSx(isClaimed ? lobbyPalette.green : lobbyPalette.gold, isClaimed ? 'rgba(27,94,32,0.7)' : 'rgba(42,45,58,0.8)')}
                  />
                </Box>
                <Typography sx={{ fontSize: 11, color: '#8B8FA3', mb: 1 }}>
                  {mission.description}
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  {/* Custom progress bar for GSAP animation */}
                  <Box sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: 'rgba(42,45,58,0.7)', overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }}>
                    <Box
                      data-bar={pct}
                      sx={{
                        height: '100%',
                        width: 0,
                        borderRadius: 4,
                        background: barGradient,
                        boxShadow: `0 0 10px ${barColor}66`,
                      }}
                    />
                  </Box>
                  <Typography sx={{ fontSize: 11, color: '#8B8FA3', minWidth: 35, textAlign: 'right' }}>
                    {mission.progress}/{mission.target}
                  </Typography>
                  {isCompleted && !isClaimed && (
                    <Button
                      size="small"
                      onClick={() => handleClaim(mission.missionId)}
                      disabled={claiming === mission.missionId}
                      sx={{
                        minWidth: 60,
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#000',
                        bgcolor: '#FFB300',
                        borderRadius: 2,
                        textTransform: 'none',
                        py: 0.25,
                        '&:hover': { bgcolor: '#FFC107' },
                      }}
                    >
                      Claim
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </CardContent>
    </Card>
    </>
  );
}

export default MissionsPanel;
