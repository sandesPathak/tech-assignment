import { Typography, Box, Button, IconButton, Chip, Avatar, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Tooltip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import LogoutIcon from '@mui/icons-material/Logout';
import BarChartIcon from '@mui/icons-material/BarChart';
import PersonIcon from '@mui/icons-material/Person';
import ShareIcon from '@mui/icons-material/Share';
import VipBadge from './VipBadge';
import PokerLoadingOverlay from './PokerLoadingOverlay';
import { useState } from 'react';

interface DashboardHeaderProps {
  tier: string;
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
  const [profileAnchor, setProfileAnchor] = useState<null | HTMLElement>(null);
  const [loaderOpen, setLoaderOpen] = useState(false);

  const handlePlayPoker = () => {
    if (isExcluded) return;
    setLoaderOpen(true);
  };

  return (
    <>
    <PokerLoadingOverlay
      open={loaderOpen}
      status="Taking your seat"
      onComplete={() => navigate('/lobby')}
    />
    <Box
      display="flex"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      justifyContent="space-between"
      flexDirection={{ xs: 'column', sm: 'row' }}
      gap={2}
      mb={4}
    >
      <Box display="flex" alignItems="center" gap={1.5}>
        <LocalFireDepartmentIcon sx={{ fontSize: 36, color: 'primary.main', filter: 'drop-shadow(0 0 12px rgba(255,107,53,0.7))' }} />
        <Typography
          variant="h4"
          fontWeight={800}
          sx={{
            fontSize: { xs: '1.5rem', sm: '2.125rem' },
            letterSpacing: -0.5,
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
              color: '#FF6B35',
              bgcolor: 'rgba(255,107,53,0.15)',
              border: '1px solid rgba(255,107,53,0.3)',
              borderRadius: 2,
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
                color: '#8B8FA3',
                border: '1px solid #2A2D3A',
                borderRadius: 2,
                '&:hover': { color: '#FF6B35', borderColor: '#FF6B35', bgcolor: 'rgba(255,107,53,0.08)' },
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
                background: 'linear-gradient(135deg, #1B5E20, #2E7D32)',
                borderRadius: 3,
                px: { xs: 2, sm: 3 },
                py: 1.5,
                fontWeight: 600,
                textTransform: 'none',
                flex: { xs: 1, sm: 'none' },
                '&:hover': {
                  background: 'linear-gradient(135deg, #1B5E20, #388E3C)',
                },
                '&.Mui-disabled': {
                  color: '#8B8FA3',
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
              ? 'linear-gradient(135deg, #2A2D3A, #2A2D3A)'
              : 'linear-gradient(135deg, #FF6B35, #FF4444)',
            borderRadius: 3,
            px: { xs: 2, sm: 3 },
            py: 1.5,
            fontWeight: 600,
            textTransform: 'none',
            flex: { xs: 1, sm: 'none' },
            '&:hover': {
              background: todayCheckedIn
                ? 'linear-gradient(135deg, #2A2D3A, #2A2D3A)'
                : 'linear-gradient(135deg, #FF5722, #E53935)',
            },
            '&.Mui-disabled': {
              color: '#4CAF50',
              background: 'linear-gradient(135deg, #1A2E1A, #1A2E1A)',
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
              bgcolor: '#FF6B35',
              fontSize: 15,
              fontWeight: 700,
              border: '2px solid #2A2D3A',
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
              border: '1px solid #2A2D3A',
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
    </>
  );
}

export default DashboardHeader;
