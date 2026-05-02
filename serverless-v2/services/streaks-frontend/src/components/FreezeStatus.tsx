import { Card, CardContent, Box, Typography, Alert, Skeleton } from '@mui/material';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import { useFreezes } from '../hooks/useFreezes';

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

  if (error) {
    return (
      <Alert severity="error" data-testid="freeze-error">
        {error}
      </Alert>
    );
  }

  if (loading || !data) {
    return (
      <Card data-testid="freeze-loading">
        <CardContent>
          <Skeleton variant="rectangular" height={80} />
        </CardContent>
      </Card>
    );
  }

  const freezeActive = isFreezeActiveToday(data.history ?? []);

  const accent = '#60A5FA';

  return (
    <Card
      data-testid="freeze-status"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        bgcolor: 'rgba(26,29,39,0.85)',
        transition: 'transform .25s, border-color .25s, box-shadow .25s',
        '&:hover': {
          transform: 'translateY(-3px)',
          borderColor: `${accent}66`,
          boxShadow: `0 0 24px ${accent}1F`,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(closest-side at 100% 0%, ${accent}24, transparent 70%)`,
          opacity: 0.7,
        },
      }}
    >
      <CardContent sx={{ position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" gap={2.5}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: 4,
              background: 'linear-gradient(180deg, rgba(59,130,246,0.12), rgba(37,99,235,0.06))',
              border: `1px solid ${accent}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: `0 0 18px ${accent}24, inset 0 1px 0 rgba(255,255,255,0.04)`,
            }}
          >
            <AcUnitIcon data-testid="freeze-icon" sx={{ fontSize: 32, color: accent, filter: `drop-shadow(0 0 6px ${accent}80)` }} />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              Streak Freezes
            </Typography>
            <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1.2, letterSpacing: -0.5 }} data-testid="freeze-count">
              {data.freezesAvailable}{' '}
              <Typography component="span" sx={{ fontSize: 20, fontWeight: 700, color: 'text.secondary' }}>
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
