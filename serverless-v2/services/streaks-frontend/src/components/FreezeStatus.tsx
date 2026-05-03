import { Card, CardContent, Box, Typography, Alert, Skeleton } from '@mui/material';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import { useFreezes } from '../hooks/useFreezes';
import { createLobbyIconTileSx, createLobbyPanelSx, lobbyPalette } from '../styles/lobbyChrome';

function isFreezeActiveToday(history: { date: string }[]): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return history.some((entry) => entry.date === today);
}

function formatSource(source: string): string {
  return source
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function FreezeStatus() {
  const { data, loading, error } = useFreezes();
  const accent = '#60A5FA';

  if (error) {
    return (
      <Alert severity="error" data-testid="freeze-error">
        {error}
      </Alert>
    );
  }

  if (loading || !data) {
    return (
      <Card data-testid="freeze-loading" sx={createLobbyPanelSx(accent)}>
        <CardContent>
          <Skeleton variant="rectangular" height={80} />
        </CardContent>
      </Card>
    );
  }

  const freezeActive = isFreezeActiveToday(data.history ?? []);

  return (
    <Card
      data-testid="freeze-status"
      sx={createLobbyPanelSx(accent)}
    >
      <CardContent sx={{ p: 2.5, position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" gap={2.5}>
          <Box sx={createLobbyIconTileSx(accent, 'linear-gradient(180deg, rgba(59,130,246,0.16), rgba(37,99,235,0.06))')}>
            <AcUnitIcon data-testid="freeze-icon" sx={{ fontSize: 32, color: accent, filter: `drop-shadow(0 0 6px ${accent}80)` }} />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: lobbyPalette.textDim, fontWeight: 700, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase' }}>
              Streak Freezes
            </Typography>
            <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1.2, letterSpacing: -0.5 }} data-testid="freeze-count">
              {data.freezesAvailable}{' '}
              <Typography component="span" sx={{ fontSize: 20, fontWeight: 700, color: lobbyPalette.textDim }}>
                available
              </Typography>
            </Typography>
            <Typography variant="caption" sx={{ color: accent, fontWeight: 600, fontSize: 12 }}>
              {freezeActive ? 'Freeze active today' : '1 free monthly reset'}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default FreezeStatus;
export { isFreezeActiveToday, formatSource };
