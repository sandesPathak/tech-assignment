import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Card, CardContent, Tabs, Tab, Skeleton, Chip, Avatar } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { useLeaderboard } from '../hooks/useLeaderboard';
import type { VipTier } from '../types/streaks.types';
import gsap from 'gsap';
import { createLobbyPanelSx, createLobbyPillSx, lobbyPalette } from '../styles/lobbyChrome';

const TIER_COLORS: Record<VipTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  platinum: '#E5E4E2',
};

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

function LeaderboardPanel() {
  const [tab, setTab] = useState(0);
  const types = ['combined', 'login', 'play'];
  const { leaderboard, playerRank, loading } = useLeaderboard(types[tab]);
  const listRef = useRef<HTMLDivElement>(null);

  // Staggered entrance animation for leaderboard rows
  useEffect(() => {
    if (loading || !listRef.current) return;
    const rows = listRef.current.querySelectorAll<HTMLElement>('[data-lb-row]');
    if (rows.length === 0) return;

    gsap.fromTo(rows,
      { x: -30, opacity: 0 },
      {
        x: 0,
        opacity: 1,
        duration: 0.4,
        stagger: 0.06,
        ease: 'power3.out',
        clearProps: 'transform',
      }
    );
  }, [leaderboard, loading]);

  if (loading) {
    return (
      <Card sx={createLobbyPanelSx(lobbyPalette.gold)}>
        <CardContent sx={{ p: 3 }}>
          <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={createLobbyPanelSx(lobbyPalette.gold)}>
      <CardContent sx={{ p: 3, position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <EmojiEventsIcon sx={{ color: '#FFD700', fontSize: 24 }} />
          <Typography variant="h6" fontWeight={700} color="#fff">
            Leaderboard
          </Typography>
        </Box>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{
            mb: 2,
            minHeight: 32,
            '& .MuiTab-root': { minHeight: 32, fontSize: 12, fontWeight: 600, color: '#8B8FA3', textTransform: 'none', py: 0.5 },
            '& .Mui-selected': { color: '#FF6B35' },
            '& .MuiTabs-indicator': { bgcolor: '#FF6B35' },
          }}
        >
          <Tab label="Combined" />
          <Tab label="Login" />
          <Tab label="Play" />
        </Tabs>

        <Box ref={listRef} display="flex" flexDirection="column" gap={1}>
          {leaderboard.slice(0, 10).map((entry) => {
            const isMe = entry.playerId === localStorage.getItem('playerId');
            return (
              <Box
                key={entry.playerId}
                data-lb-row
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  p: 1,
                  borderRadius: 2,
                  bgcolor: isMe ? 'rgba(255,107,53,0.1)' : 'rgba(20,23,32,0.86)',
                  border: isMe ? '1px solid rgba(255,107,53,0.3)' : '1px solid rgba(255,255,255,0.04)',
                  opacity: 0,
                }}
              >
                <Typography
                  sx={{
                    width: 24,
                    fontSize: entry.rank <= 3 ? 16 : 13,
                    fontWeight: 800,
                    color: entry.rank <= 3 ? RANK_COLORS[entry.rank - 1] : '#8B8FA3',
                    textAlign: 'center',
                  }}
                >
                  {entry.rank <= 3 ? ['\u{1F947}', '\u{1F948}', '\u{1F949}'][entry.rank - 1] : `#${entry.rank}`}
                </Typography>
                <Avatar
                  sx={{
                    width: 28,
                    height: 28,
                    fontSize: 12,
                    fontWeight: 700,
                    bgcolor: TIER_COLORS[entry.tier],
                    color: '#000',
                  }}
                >
                  {entry.displayName.charAt(0).toUpperCase()}
                </Avatar>
                <Box flex={1} minWidth={0}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: isMe ? '#FF6B35' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.displayName}{isMe ? ' (You)' : ''}
                  </Typography>
                </Box>
                <Chip
                  label={entry.score}
                  size="small"
                  sx={createLobbyPillSx(lobbyPalette.gold, 'rgba(42,45,58,0.82)')}
                />
              </Box>
            );
          })}
        </Box>

        {/* Show player's rank if not in top 10 */}
        {playerRank && playerRank.rank > 10 && (
          <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed #2A2D3A' }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1,
                borderRadius: 2,
                bgcolor: 'rgba(255,107,53,0.1)',
                border: '1px solid rgba(255,107,53,0.3)',
              }}
            >
              <Typography sx={{ width: 24, fontSize: 13, fontWeight: 800, color: '#8B8FA3', textAlign: 'center' }}>
                #{playerRank.rank}
              </Typography>
              <Avatar sx={{ width: 28, height: 28, fontSize: 12, fontWeight: 700, bgcolor: TIER_COLORS[playerRank.tier], color: '#000' }}>
                {playerRank.displayName.charAt(0).toUpperCase()}
              </Avatar>
              <Box flex={1}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#FF6B35' }}>
                  {playerRank.displayName} (You)
                </Typography>
              </Box>
              <Chip
                label={playerRank.score}
                size="small"
                sx={createLobbyPillSx(lobbyPalette.gold, 'rgba(42,45,58,0.82)')}
              />
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default LeaderboardPanel;
