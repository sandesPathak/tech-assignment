import { useState, useEffect } from 'react';
import { Container, Box, Grid, Alert, Skeleton, Card, CardContent, Button } from '@mui/material';
import StreakCounter from '../components/StreakCounter';
import MilestoneProgress from '../components/MilestoneProgress';
import FreezeStatus from '../components/FreezeStatus';
import CalendarHeatMap from '../components/CalendarHeatMap';
import RewardHistory from '../components/RewardHistory';
import PersonalBest from '../components/PersonalBest';
import MissionsPanel from '../components/MissionsPanel';
import LeaderboardPanel from '../components/LeaderboardPanel';
import ResponsibleGaming from '../components/ResponsibleGaming';
import ErrorBoundary from '../components/ErrorBoundary';
import { getVipTier } from '../components/VipBadge';
import Celebration from '../components/Celebration';
import ShareCard from '../components/ShareCard';
import DashboardHeader from '../components/DashboardHeader';
import WelcomeCard from '../components/WelcomeCard';
import { useStreaks } from '../hooks/useStreaks';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { checkIn, getResponsibleGaming } from '../api/streaks.api';
import { APP_FONT_STACK } from '../theme';
import { createLobbyPanelSx, lobbyHeroSx, lobbyPageSx } from '../styles/lobbyChrome';

function Dashboard() {
  const { data, loading, error, refetch } = useStreaks();
  const { user, signOut } = useAuth();
  const { showToast } = useToast();
  const tier = data ? getVipTier(data.loginStreak, data.playStreak) : 'bronze';
  const [celebrating, setCelebrating] = useState(false);
  const [selfExcludedUntil, setSelfExcludedUntil] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    getResponsibleGaming()
      .then((data) => setSelfExcludedUntil(data.selfExcludedUntil))
      .catch(() => {});
  }, []);

  const isExcluded = selfExcludedUntil && new Date(selfExcludedUntil) > new Date();

  const todayCheckedIn = (() => {
    if (!data) return false;
    const todayUTC = new Date().toISOString().slice(0, 10);
    return data.lastLoginDate === todayUTC;
  })();

  const handleCheckIn = async () => {
    if (todayCheckedIn) return;
    try {
      await checkIn();
      setCelebrating(true);
      showToast('Checked in! Streak updated.', 'success');
      refetch();
    } catch {
      showToast('Check-in failed. Try again.', 'error');
    }
  };

  const streakAtRisk = (() => {
    if (!data || data.loginStreak === 0) return false;
    const todayUTC = new Date().toISOString().slice(0, 10);
    return data.lastLoginDate !== todayUTC && data.loginStreak > 0;
  })();

  return (
    <Box
      sx={{
        ...lobbyPageSx,
        fontFamily: APP_FONT_STACK,
      }}
    >
      <Celebration active={celebrating} onComplete={() => setCelebrating(false)} />
      <Container maxWidth="xl" disableGutters>
        <Box sx={lobbyHeroSx}>
          <DashboardHeader
            tier={tier}
            data={data}
            user={user}
            todayCheckedIn={todayCheckedIn}
            isExcluded={isExcluded}
            selfExcludedUntil={selfExcludedUntil}
            onCheckIn={handleCheckIn}
            onShareOpen={() => setShareOpen(true)}
            signOut={signOut}
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }} data-testid="error-alert">
            {error}
          </Alert>
        )}

        {streakAtRisk && (
          <Alert
            severity="warning"
            sx={{ mb: 3, borderRadius: 3, bgcolor: 'rgba(255,152,0,0.1)', border: '1px solid rgba(255,152,0,0.3)' }}
            action={
              <Button color="inherit" size="small" onClick={handleCheckIn} sx={{ fontWeight: 700, textTransform: 'none' }}>
                Check In Now
              </Button>
            }
          >
            Your {data!.loginStreak}-day login streak is at risk! Check in before midnight UTC to keep it alive.
          </Alert>
        )}

        {data && data.loginStreak === 0 && data.playStreak === 0 && <WelcomeCard />}

        {loading && (
          <Grid container spacing={3} data-testid="loading-skeleton">
            {[1, 2, 3].map((i) => (
              <Grid item xs={12} sm={4} key={i}>
                <Card sx={createLobbyPanelSx()}>
                  <CardContent>
                    <Skeleton variant="rectangular" height={80} />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {data && !loading && (
          <Box display="flex" flexDirection="column" gap={3}>
            {/* Row 1: Stat Cards */}
            <Grid container spacing={3} data-testid="streak-counters">
              <Grid item xs={12} sm={4}>
                <StreakCounter
                  type="login"
                  count={data.loginStreak}
                  label="Login Streak"
                  best={data.bestLoginStreak}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StreakCounter
                  type="play"
                  count={data.playStreak}
                  label="Play Streak"
                  best={data.bestPlayStreak}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <FreezeStatus />
              </Grid>
            </Grid>

            {/* Row 2: Missions + Personal Best */}
            <Grid container spacing={3}>
              <Grid item xs={12} md={8}>
                <ErrorBoundary fallbackMessage="Missions unavailable">
                  <MissionsPanel />
                </ErrorBoundary>
              </Grid>
              <Grid item xs={12} md={4}>
                <PersonalBest
                  bestLoginStreak={data.bestLoginStreak}
                  bestPlayStreak={data.bestPlayStreak}
                  currentLoginStreak={data.loginStreak}
                  currentPlayStreak={data.playStreak}
                />
              </Grid>
            </Grid>

            {/* Row 3: Milestone Progress */}
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <MilestoneProgress
                  type="login"
                  currentStreak={data.loginStreak}
                  nextMilestone={data.nextLoginMilestone}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <MilestoneProgress
                  type="play"
                  currentStreak={data.playStreak}
                  nextMilestone={data.nextPlayMilestone}
                />
              </Grid>
            </Grid>

            {/* Row 4: Calendar + Leaderboard */}
            <Grid container spacing={3}>
              <Grid item xs={12} md={8}>
                <ErrorBoundary fallbackMessage="Calendar unavailable">
                  <CalendarHeatMap />
                </ErrorBoundary>
              </Grid>
              <Grid item xs={12} md={4}>
                <ErrorBoundary fallbackMessage="Leaderboard unavailable">
                  <LeaderboardPanel />
                </ErrorBoundary>
              </Grid>
            </Grid>

            {/* Row 5: Rewards + Responsible Gaming */}
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <RewardHistory />
              </Grid>
              <Grid item xs={12} md={6}>
                <ErrorBoundary fallbackMessage="Settings unavailable">
                  <ResponsibleGaming />
                </ErrorBoundary>
              </Grid>
            </Grid>
          </Box>
        )}
      </Container>
      <ShareCard open={shareOpen} onClose={() => setShareOpen(false)} />
    </Box>
  );
}

export default Dashboard;
