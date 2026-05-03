import { Card, CardContent, Box, Typography, Chip } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { createLobbyIconTileSx, createLobbyPanelSx, lobbyPalette } from '../styles/lobbyChrome';

export interface PersonalBestProps {
  bestLoginStreak: number;
  bestPlayStreak: number;
  currentLoginStreak: number;
  currentPlayStreak: number;
}

function PersonalBest({
  bestLoginStreak,
  bestPlayStreak,
  currentLoginStreak,
  currentPlayStreak,
}: PersonalBestProps) {
  const isLoginBest = currentLoginStreak > 0 && currentLoginStreak >= bestLoginStreak;
  const isPlayBest = currentPlayStreak > 0 && currentPlayStreak >= bestPlayStreak;

  return (
    <Card
      data-testid="personal-best"
      sx={createLobbyPanelSx(lobbyPalette.gold)}
    >
      <CardContent sx={{ p: 3, position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Box sx={{ ...createLobbyIconTileSx(lobbyPalette.gold, 'linear-gradient(180deg, rgba(255,215,0,0.15), rgba(251,191,36,0.06))'), width: 44, height: 44, borderRadius: 2.5 }}>
            <EmojiEventsIcon sx={{ fontSize: 26, color: '#FFD700', filter: 'drop-shadow(0 0 6px rgba(255,215,0,0.8))' }} data-testid="trophy-icon" />
          </Box>
          <Typography variant="h6" fontWeight={800} sx={{ letterSpacing: -0.3 }}>
            Personal Best
          </Typography>
        </Box>

        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" alignItems="center" gap={1} data-testid="best-login">
            <Typography variant="body1">
              Best login streak: <strong>{bestLoginStreak} days</strong>
            </Typography>
            {isLoginBest && (
              <Chip
                label="Current best!"
                size="small"
                data-testid="login-best-indicator"
                sx={{
                  height: 24,
                  fontSize: 11,
                  fontWeight: 700,
                  color: lobbyPalette.green,
                  bgcolor: 'rgba(74,222,128,0.12)',
                  border: '1px solid rgba(74,222,128,0.32)',
                }}
              />
            )}
          </Box>

          <Box display="flex" alignItems="center" gap={1} data-testid="best-play">
            <Typography variant="body1">
              Best play streak: <strong>{bestPlayStreak} days</strong>
            </Typography>
            {isPlayBest && (
              <Chip
                label="Current best!"
                size="small"
                data-testid="play-best-indicator"
                sx={{
                  height: 24,
                  fontSize: 11,
                  fontWeight: 700,
                  color: lobbyPalette.green,
                  bgcolor: 'rgba(74,222,128,0.12)',
                  border: '1px solid rgba(74,222,128,0.32)',
                }}
              />
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default PersonalBest;
