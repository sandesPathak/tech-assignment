import { Card, CardContent, Box, Typography, Chip } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import type { NextMilestone } from '../types/streaks.types';

export interface MilestoneProgressProps {
  type: 'login' | 'play';
  currentStreak: number;
  nextMilestone: NextMilestone | null;
}

const MILESTONE_DAYS = [3, 7, 14, 30, 60, 90];

function getPreviousMilestoneDays(nextMilestoneDays: number): number {
  const index = MILESTONE_DAYS.indexOf(nextMilestoneDays);
  if (index <= 0) return 0;
  return MILESTONE_DAYS[index - 1];
}

function MilestoneProgress({ type, currentStreak, nextMilestone }: MilestoneProgressProps) {
  const isLogin = type === 'login';
  const label = isLogin ? 'Next Login Milestone' : 'Next Play Milestone';
  const gradient = isLogin
    ? 'linear-gradient(90deg, #FF6B35, #FF4444)'
    : 'linear-gradient(90deg, #7C3AED, #6D28D9)';
  const badgeBg = isLogin ? 'rgba(255,107,53,0.08)' : 'rgba(124,58,237,0.08)';
  const badgeColor = isLogin ? '#FF6B35' : '#A78BFA';

  if (!nextMilestone) {
    return (
      <Card data-testid={`milestone-progress-${type}`}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <EmojiEventsIcon sx={{ color: '#FBBF24', fontSize: 20 }} data-testid="trophy-icon" />
            <Typography variant="body2" sx={{ color: '#C4C7D4', fontWeight: 600, fontSize: 14 }}>
              {label}
            </Typography>
          </Box>
          <Typography variant="body1" fontWeight={600} data-testid={`milestone-max-${type}`}>
            All milestones reached!
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const previousDays = getPreviousMilestoneDays(nextMilestone.days);
  const range = nextMilestone.days - previousDays;
  const progress = range > 0 ? Math.min(((currentStreak - previousDays) / range) * 100, 100) : 0;

  return (
    <Card
      data-testid={`milestone-progress-${type}`}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        bgcolor: 'rgba(26,29,39,0.85)',
        transition: 'transform .25s, border-color .25s, box-shadow .25s',
        '&:hover': {
          transform: 'translateY(-2px)',
          borderColor: `${badgeColor}55`,
          boxShadow: `0 0 24px ${badgeColor}1A`,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(closest-side at 100% 0%, ${badgeColor}1F, transparent 65%)`,
        },
      }}
    >
      <CardContent sx={{ position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={1}>
            <EmojiEventsIcon sx={{ color: '#FBBF24', fontSize: 20, filter: 'drop-shadow(0 0 6px rgba(251,191,36,0.6))' }} data-testid="trophy-icon" />
            <Typography sx={{ color: '#C4C7D4', fontWeight: 700, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {label}
            </Typography>
          </Box>
          <Chip
            label={`${nextMilestone.daysRemaining} days left`}
            size="small"
            sx={{
              bgcolor: badgeBg,
              border: `1px solid ${badgeColor}55`,
              color: badgeColor,
              fontWeight: 700,
              fontSize: 12,
              height: 26,
            }}
          />
        </Box>

        {/* Progress bar */}
        <Box sx={{ width: '100%', height: 10, borderRadius: 5, bgcolor: 'rgba(42,45,58,0.7)', mb: 2, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          <Box
            data-testid={`milestone-progress-bar-${type}`}
            sx={{
              width: `${progress}%`,
              height: '100%',
              borderRadius: 5,
              background: gradient,
              boxShadow: `0 0 12px ${badgeColor}80`,
              transition: 'width 0.6s ease',
            }}
          />
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography sx={{ color: '#8B8FA3', fontSize: 13, fontWeight: 500 }} data-testid={`milestone-message-${type}`}>
            {nextMilestone.days}-day milestone
          </Typography>
          <Typography sx={{ color: '#FBBF24', fontSize: 13, fontWeight: 600 }}>
            {nextMilestone.reward} bonus points
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

export default MilestoneProgress;
export { getPreviousMilestoneDays, MILESTONE_DAYS };
