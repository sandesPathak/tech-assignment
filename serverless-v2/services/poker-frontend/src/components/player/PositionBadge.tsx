import { Box, Typography } from '@mui/material';

interface PositionBadgeProps {
  position: 'D' | 'SB' | 'BB';
}

const COLORS: Record<string, string> = {
  D: '#FFD700',
  SB: '#60A5FA',
  BB: '#F87171',
};

function PositionBadge({ position }: PositionBadgeProps) {
  return (
    <Box
      data-testid={`badge-${position}`}
      sx={{
        bgcolor: COLORS[position],
        color: '#000',
        borderRadius: '50%',
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        fontWeight: 800,
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
      }}
    >
      <Typography sx={{ fontSize: 9, fontWeight: 800, lineHeight: 1, color: '#000' }}>
        {position}
      </Typography>
    </Box>
  );
}

export default PositionBadge;
