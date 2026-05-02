import { Card, CardContent, Box, Typography, Chip } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';

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
      sx={{
        position: 'relative',
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        bgcolor: 'rgba(26,29,39,0.85)',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(closest-side at 0% 0%, rgba(255,215,0,0.10), transparent 60%)',
        },
      }}
    >
      <CardContent sx={{ position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(180deg, rgba(255,215,0,0.15), rgba(251,191,36,0.06))',
              border: '1px solid rgba(255,215,0,0.3)',
              boxShadow: '0 0 18px rgba(255,215,0,0.18), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
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
                color="success"
                size="small"
                data-testid="login-best-indicator"
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
                color="success"
                size="small"
                data-testid="play-best-indicator"
              />
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default PersonalBest;
