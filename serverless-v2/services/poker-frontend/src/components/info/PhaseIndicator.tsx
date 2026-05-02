import { Box, Typography, Chip } from '@mui/material';
import { PHASE_LABELS } from '../../types/poker.types';

interface PhaseIndicatorProps {
  handStep: number;
  stepName: string;
  gameNo: number;
}

function PhaseIndicator({ stepName, gameNo }: PhaseIndicatorProps) {
  const label = PHASE_LABELS[stepName] || stepName;

  return (
    <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
      <Chip
        label={`Hand #${gameNo}`}
        size="small"
        sx={{
          bgcolor: '#1E88E5',
          color: '#fff',
          fontWeight: 700,
          fontSize: 12,
        }}
      />
      <Typography
        data-testid="phase-label"
        sx={{ color: '#B0BEC5', fontSize: 14, fontWeight: 600 }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export default PhaseIndicator;
