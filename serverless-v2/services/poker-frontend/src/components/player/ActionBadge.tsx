import { Chip } from '@mui/material';

interface ActionBadgeProps {
  action: string;
}

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  fold: { bg: '#78909C', color: '#fff' },
  check: { bg: '#4CAF50', color: '#fff' },
  call: { bg: '#2196F3', color: '#fff' },
  bet: { bg: '#FF9800', color: '#fff' },
  raise: { bg: '#FF5722', color: '#fff' },
  allin: { bg: '#e53935', color: '#fff' },
};

function ActionBadge({ action }: ActionBadgeProps) {
  if (!action) return null;

  const style = ACTION_COLORS[action] || { bg: '#555', color: '#fff' };
  const label = action === 'allin' ? 'ALL IN' : action.toUpperCase();

  return (
    <Chip
      label={label}
      size="small"
      data-testid={`action-${action}`}
      sx={{
        bgcolor: style.bg,
        color: style.color,
        fontWeight: 700,
        fontSize: 10,
        height: 20,
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
}

export default ActionBadge;
