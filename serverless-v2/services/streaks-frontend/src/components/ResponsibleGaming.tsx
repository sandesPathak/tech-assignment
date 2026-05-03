import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Switch, FormControlLabel,
  Select, MenuItem, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, Alert,
} from '@mui/material';
import ShieldIcon from '@mui/icons-material/Shield';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { getResponsibleGaming, updateResponsibleGaming, selfExclude } from '../api/streaks.api';
import { createLobbyInsetSx, createLobbyPanelSx, lobbyPalette } from '../styles/lobbyChrome';

function ResponsibleGaming() {
  const [settings, setSettings] = useState({
    sessionLimitMinutes: null as number | null,
    dailyHandLimit: null as number | null,
    reminderEnabled: true,
    selfExcludedUntil: null as string | null,
  });
  const [loading, setLoading] = useState(true);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeDays, setExcludeDays] = useState(7);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getResponsibleGaming()
      .then((data) => { setSettings(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async (updates: Record<string, unknown>) => {
    try {
      await updateResponsibleGaming(updates);
      setSettings((prev) => ({ ...prev, ...updates }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save responsible gaming settings:', err);
    }
  };

  const handleSelfExclude = async () => {
    try {
      const result = await selfExclude(excludeDays);
      setSettings((prev) => ({ ...prev, selfExcludedUntil: result.selfExcludedUntil }));
      setExcludeOpen(false);
    } catch (err) {
      console.error('Failed to self-exclude:', err);
    }
  };

  if (loading) return null;

  const isExcluded = settings.selfExcludedUntil && new Date(settings.selfExcludedUntil) > new Date();

  return (
    <>
      <Card sx={createLobbyPanelSx(lobbyPalette.green)}>
        <CardContent sx={{ p: 3, position: 'relative', zIndex: 1 }}>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <ShieldIcon sx={{ color: '#4ADE80', fontSize: 24 }} />
            <Typography variant="h6" fontWeight={700} color="#fff">
              Responsible Gaming
            </Typography>
          </Box>

          {isExcluded && (
            <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
              Self-excluded until {new Date(settings.selfExcludedUntil!).toLocaleDateString()}
            </Alert>
          )}

          {saved && (
            <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
              Settings saved
            </Alert>
          )}

          <Box display="flex" flexDirection="column" gap={2}>
            {/* Session Limit */}
            <Box sx={{ ...createLobbyInsetSx(lobbyPalette.green, 'rgba(20,23,32,0.86)'), p: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#fff', mb: 1 }}>
                Session Time Limit
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#8B8FA3', mb: 1 }}>
                Get reminded when you've been playing too long
              </Typography>
              <Select
                size="small"
                value={settings.sessionLimitMinutes || 0}
                onChange={(e) => {
                  const val = e.target.value === 0 ? null : e.target.value;
                  handleSave({ sessionLimitMinutes: val });
                }}
                sx={{
                  bgcolor: '#1A1D27', color: '#fff', fontSize: 12,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#2A2D3A' },
                  '& .MuiSelect-icon': { color: '#8B8FA3' },
                }}
                fullWidth
              >
                <MenuItem value={0}>No limit</MenuItem>
                <MenuItem value={30}>30 minutes</MenuItem>
                <MenuItem value={60}>1 hour</MenuItem>
                <MenuItem value={120}>2 hours</MenuItem>
                <MenuItem value={240}>4 hours</MenuItem>
              </Select>
            </Box>

            {/* Play Reminders */}
            <Box sx={{ ...createLobbyInsetSx(lobbyPalette.green, 'rgba(20,23,32,0.86)'), p: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.reminderEnabled}
                    onChange={(e) => handleSave({ reminderEnabled: e.target.checked })}
                    sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#4ADE80' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#1B5E20' } }}
                  />
                }
                label={
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Play Responsibly Reminders</Typography>
                    <Typography sx={{ fontSize: 11, color: '#8B8FA3' }}>Periodic reminders during long sessions</Typography>
                  </Box>
                }
                sx={{ m: 0, alignItems: 'flex-start' }}
              />
            </Box>

            {/* Self-Exclusion */}
            <Box sx={{ ...createLobbyInsetSx(lobbyPalette.red, 'rgba(20,23,32,0.86)'), p: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#EF5350', mb: 0.5 }}>
                Self-Exclusion
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#8B8FA3', mb: 1.5 }}>
                Temporarily block yourself from playing. This cannot be easily undone.
              </Typography>
              <Button
                size="small"
                startIcon={<WarningAmberIcon />}
                onClick={() => setExcludeOpen(true)}
                disabled={!!isExcluded}
                sx={{
                  color: '#EF5350',
                  borderColor: '#EF5350',
                  fontSize: 12,
                  textTransform: 'none',
                  fontWeight: 600,
                  border: '1px solid',
                  borderRadius: 2,
                  '&:hover': { bgcolor: 'rgba(239,83,80,0.1)' },
                }}
              >
                {isExcluded ? 'Currently Excluded' : 'Self-Exclude'}
              </Button>
            </Box>
          </Box>

          <Box mt={2} pt={1.5} borderTop="1px solid #2A2D3A">
            <Typography sx={{ fontSize: 10, color: '#666', textAlign: 'center' }}>
              If you or someone you know has a gambling problem, call 1-800-522-4700
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Self-Exclusion Dialog */}
      <Dialog open={excludeOpen} onClose={() => setExcludeOpen(false)} PaperProps={{ sx: { bgcolor: '#1A1D27', borderRadius: 4, border: '1px solid #2A2D3A' } }}>
        <DialogTitle sx={{ color: '#EF5350', fontWeight: 700 }}>
          Self-Exclusion
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#8B8FA3', fontSize: 13, mb: 2 }}>
            This will prevent you from accessing games for the selected period. This action is difficult to reverse — contact support if needed.
          </Typography>
          <Select
            value={excludeDays}
            onChange={(e) => setExcludeDays(Number(e.target.value))}
            fullWidth
            size="small"
            sx={{ bgcolor: '#141720', color: '#fff', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#2A2D3A' } }}
          >
            <MenuItem value={1}>1 day</MenuItem>
            <MenuItem value={7}>7 days</MenuItem>
            <MenuItem value={30}>30 days</MenuItem>
            <MenuItem value={90}>90 days</MenuItem>
            <MenuItem value={180}>6 months</MenuItem>
            <MenuItem value={365}>1 year</MenuItem>
          </Select>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setExcludeOpen(false)} sx={{ color: '#8B8FA3', textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleSelfExclude} sx={{ color: '#EF5350', fontWeight: 700, textTransform: 'none' }}>Confirm Exclusion</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default ResponsibleGaming;
