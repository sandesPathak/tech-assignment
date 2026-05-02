import { Box, Typography } from '@mui/material';
import type { LogEntry } from '../../hooks/useHandHistory';

interface HandHistoryLogProps {
  entries: LogEntry[];
}

const TYPE_COLORS: Record<string, string> = {
  step: '#FF9800',
  info: '#78909C',
  winner: '#4ADE80',
  error: '#EF5350',
};

function HandHistoryLog({ entries }: HandHistoryLogProps) {
  return (
    <Box
      data-testid="hand-history"
      sx={{
        bgcolor: '#0d1117',
        borderRadius: 2,
        border: '1px solid #1e2a3a',
        p: 1.5,
        maxHeight: 200,
        overflowY: 'auto',
        fontFamily: 'monospace',
      }}
    >
      <Typography sx={{ color: '#546E7A', fontSize: 11, fontWeight: 700, mb: 1 }}>
        HAND HISTORY
      </Typography>
      {entries.length === 0 ? (
        <Typography sx={{ color: '#37474F', fontSize: 11 }}>
          No actions yet. Click &quot;Next Step&quot; to begin.
        </Typography>
      ) : (
        entries.map((entry) => (
          <Typography
            key={entry.id}
            sx={{
              color: TYPE_COLORS[entry.type] || '#78909C',
              fontSize: 11,
              lineHeight: 1.6,
              '&:hover': { bgcolor: '#1a2332' },
            }}
          >
            {entry.message}
          </Typography>
        ))
      )}
    </Box>
  );
}

export default HandHistoryLog;
