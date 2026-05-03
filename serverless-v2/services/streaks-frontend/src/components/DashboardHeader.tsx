import { Typography, Box, Button, IconButton, Chip, Avatar, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Tooltip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import FireAnimation from './FireAnimation';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import LogoutIcon from '@mui/icons-material/Logout';
import BarChartIcon from '@mui/icons-material/BarChart';
import PersonIcon from '@mui/icons-material/Person';
import ShareIcon from '@mui/icons-material/Share';
import VipBadge from './VipBadge';
import { useLoadingOverlay } from '../context/LoadingOverlayContext';
import { useState } from 'react';
import { APP_FONT_STACK } from '../theme';
import { lobbyPalette } from '../styles/lobbyChrome';
import type { VipTier } from '../types/streaks.types';

interface DashboardHeaderProps {
  tier: VipTier;
  data: {
    comboActive: boolean;
    comboMultiplier: number;
  } | null;
  user: { displayName?: string | null; email?: string | null } | null;
  todayCheckedIn: boolean;
  isExcluded: boolean | "" | null;
  selfExcludedUntil: string | null;
  onCheckIn: () => void;
  onShareOpen: () => void;
  signOut: () => void;
}

function DashboardHeader({ tier, data, user, todayCheckedIn, isExcluded, selfExcludedUntil, onCheckIn, onShareOpen, signOut }: DashboardHeaderProps) {
  const navigate = useNavigate();
  const { play: playLoadingOverlay } = useLoadingOverlay();
  const [profileAnchor, setProfileAnchor] = useState<null | HTMLElement>(null);

  const handlePlayPoker = () => {
    if (isExcluded) return;
    playLoadingOverlay('Taking your seat', '/lobby');
  };

  return (
    <Box
      display="flex"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      justifyContent="space-between"
      flexDirection={{ xs: 'column', sm: 'row' }}
      gap={2}
      sx={{ position: 'relative', zIndex: 1 }}
    >
      <Box display="flex" alignItems="center" gap={1.5}>
        <FireAnimation size={36} containerWidth={64} />
        <Typography
          variant="h4"
          fontWeight={800}
          sx={{
            fontSize: { xs: '1.5rem', sm: '2.125rem' },
            letterSpacing: -0.5,
            fontFamily: APP_FONT_STACK,
            background: 'linear-gradient(135deg, #FFFFFF 0%, #FFE4D6 50%, #FFB199 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Daily Streaks
        </Typography>
        {data && <VipBadge tier={tier} />}
        {data?.comboActive && (
          <Chip
            label={`${data.comboMultiplier.toFixed(1)}x Combo`}
            size="small"
            sx={{
              fontWeight: 700,
              fontSize: 11,
              color: lobbyPalette.orange,
              bgcolor: 'rgba(255,107,53,0.12)',
              border: '1px solid rgba(255,107,53,0.35)',
              borderRadius: 999,
              animation: 'pulse 2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.7 },
              },
            }}
          />
        )}
        {data && (
          <Tooltip title="Share Your Streak">
            <IconButton
              onClick={() => onShareOpen()}
              size="small"
              sx={{
                color: lobbyPalette.textDim,
                border: `1px solid ${lobbyPalette.border}`,
                borderRadius: 2.5,
                bgcolor: 'rgba(255,255,255,0.03)',
                '&:hover': { color: lobbyPalette.orange, borderColor: lobbyPalette.orange, bgcolor: 'rgba(255,107,53,0.08)' },
              }}
            >
              <ShareIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box display="flex" gap={1.5} width={{ xs: '100%', sm: 'auto' }}>
        <Tooltip title={isExcluded ? `Self-excluded until ${new Date(selfExcludedUntil!).toLocaleDateString()}` : ''}>
          <span>
            <Button
              variant="contained"
              startIcon={<SportsEsportsIcon />}
              onClick={handlePlayPoker}
              disabled={!!isExcluded}
              sx={{
                background: 'linear-gradient(135deg, #1F7A2A, #2E9B40)',
                border: '1px solid rgba(74,222,128,0.24)',
                boxShadow: '0 14px 28px rgba(0,0,0,0.28)',
                borderRadius: 3.5,
                px: { xs: 2, sm: 3 },
                py: 1.35,
                fontWeight: 700,
                textTransform: 'none',
                flex: { xs: 1, sm: 'none' },
                '&:hover': {
                  background: 'linear-gradient(135deg, #208C30, #35B24A)',
                },
                '&.Mui-disabled': {
                  color: lobbyPalette.textDim,
                  background: 'linear-gradient(135deg, #2A2D3A, #2A2D3A)',
                },
              }}
            >
              {isExcluded ? 'Excluded' : 'Play Poker'}
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="contained"
          startIcon={<CheckCircleIcon />}
          onClick={onCheckIn}
          disabled={todayCheckedIn}
          sx={{
            background: todayCheckedIn
              ? 'linear-gradient(135deg, #183123, #1C3B28)'
              : 'linear-gradient(135deg, #FF8A1F, #FF6B35)',
            border: todayCheckedIn
              ? '1px solid rgba(74,222,128,0.24)'
              : '1px solid rgba(255,138,31,0.28)',
            boxShadow: '0 14px 28px rgba(0,0,0,0.28)',
            borderRadius: 3.5,
            px: { xs: 2, sm: 3 },
            py: 1.35,
            fontWeight: 700,
            textTransform: 'none',
            flex: { xs: 1, sm: 'none' },
            '&:hover': {
              background: todayCheckedIn
                ? 'linear-gradient(135deg, #183123, #1C3B28)'
                : 'linear-gradient(135deg, #FF962D, #FF733A)',
            },
            '&.Mui-disabled': {
              color: lobbyPalette.green,
              background: 'linear-gradient(135deg, #183123, #1C3B28)',
              border: '1px solid rgba(76,175,80,0.3)',
            },
          }}
        >
          {todayCheckedIn ? 'Checked In' : 'Check In Today'}
        </Button>
        <IconButton
          onClick={(e) => setProfileAnchor(e.currentTarget)}
          sx={{ p: 0.5 }}
        >
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: lobbyPalette.orange,
              fontSize: 15,
              fontWeight: 700,
              border: `2px solid ${lobbyPalette.border}`,
              boxShadow: '0 0 18px rgba(255,107,53,0.2)',
            }}
          >
            {(user?.displayName || user?.email || '?').charAt(0).toUpperCase()}
          </Avatar>
        </IconButton>
        <Menu
          anchorEl={profileAnchor}
          open={!!profileAnchor}
          onClose={() => setProfileAnchor(null)}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          PaperProps={{
            sx: {
              bgcolor: '#1A1D27',
              border: `1px solid ${lobbyPalette.border}`,
              borderRadius: 3,
              mt: 1,
              minWidth: 220,
              '& .MuiMenuItem-root': { fontSize: 13, color: '#fff', py: 1.2 },
              '& .MuiMenuItem-root:hover': { bgcolor: '#141720' },
            },
          }}
        >
          {/* User info */}
          <Box sx={{ px: 2, py: 1.5 }}>
            <Box display="flex" alignItems="center" gap={1.5}>
              <Avatar sx={{ width: 40, height: 40, bgcolor: '#FF6B35', fontSize: 16, fontWeight: 700 }}>
                {(user?.displayName || user?.email || '?').charAt(0).toUpperCase()}
              </Avatar>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                  {user?.displayName || 'Player'}
                </Typography>
                <Typography sx={{ fontSize: 11, color: '#8B8FA3' }}>
                  {user?.email || ''}
                </Typography>
              </Box>
            </Box>
          </Box>
          <Divider sx={{ borderColor: '#2A2D3A' }} />
          <MenuItem onClick={() => { setProfileAnchor(null); navigate('/admin'); }}>
            <ListItemIcon><BarChartIcon sx={{ color: '#60A5FA', fontSize: 20 }} /></ListItemIcon>
            <ListItemText>Admin Analytics</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setProfileAnchor(null); }}>
            <ListItemIcon><PersonIcon sx={{ color: '#8B8FA3', fontSize: 20 }} /></ListItemIcon>
            <ListItemText>Profile</ListItemText>
          </MenuItem>
          <Divider sx={{ borderColor: '#2A2D3A' }} />
          <MenuItem onClick={() => { setProfileAnchor(null); signOut(); }}>
            <ListItemIcon><LogoutIcon sx={{ color: '#EF5350', fontSize: 20 }} /></ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: '#EF5350' } }}>Sign Out</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
}

export default DashboardHeader;
