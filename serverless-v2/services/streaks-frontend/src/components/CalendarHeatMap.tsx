import { useEffect, useRef } from 'react';
import { Box, Typography, Tooltip, Card, CardContent, Skeleton, IconButton } from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useCalendar } from '../hooks/useCalendar';
import type { ActivityType, CalendarDay } from '../types/streaks.types';
import gsap from 'gsap';
import { createLobbyPanelSx, lobbyPalette } from '../styles/lobbyChrome';

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  none: '#2A2D3A',
  login_only: '#A5D6A7',
  played: '#2E7D32',
  freeze: '#42A5F5',
  streak_broken: '#EF5350',
};

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  none: 'No activity',
  login_only: 'Login only',
  played: 'Played',
  freeze: 'Freeze used',
  streak_broken: 'Streak broken',
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getActivityColor(activity: ActivityType): string {
  return ACTIVITY_COLORS[activity] ?? ACTIVITY_COLORS.none;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTextColor(activity: ActivityType): string {
  if (activity === 'played' || activity === 'streak_broken' || activity === 'freeze') return '#FFFFFFCC';
  if (activity === 'login_only') return '#1A1D27';
  return '#555972';
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

/**
 * Build a full monthly grid aligned to weekdays.
 * Returns 5-6 weeks of days, with leading/trailing empty slots for alignment.
 */
function buildMonthGrid(month: string, activityDays: CalendarDay[]): (CalendarDay | null)[][] {
  const [year, mon] = month.split('-').map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay = new Date(year, mon, 0); // last day of month
  const daysInMonth = lastDay.getDate();

  // Monday = 0, Sunday = 6
  const startDow = (firstDay.getDay() + 6) % 7; // convert Sun=0 to Mon=0

  const byDate = new Map<string, CalendarDay>();
  for (const d of activityDays) byDate.set(d.date, d);

  const grid: (CalendarDay | null)[][] = [];
  let week: (CalendarDay | null)[] = [];

  // Leading empty slots
  for (let i = 0; i < startDow; i++) week.push(null);

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entry = byDate.get(dateStr) || {
      date: dateStr,
      activity: 'none' as ActivityType,
      loginStreak: 0,
      playStreak: 0,
    };
    week.push(entry);

    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
  }

  // Trailing empty slots
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    grid.push(week);
  }

  return grid;
}

function getMonthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(year, mon - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function CalendarHeatMap() {
  const { days, month, loading, error, nextMonth, prevMonth } = useCalendar();
  const gridRef = useRef<HTMLDivElement>(null);
  const isCurrentMonth = month === getCurrentMonth();

  const grid = buildMonthGrid(month, days);

  // Animate cells on month change
  useEffect(() => {
    if (loading || !gridRef.current) return;
    const cells = gridRef.current.querySelectorAll<HTMLElement>('[data-cal-cell]');
    gsap.fromTo(cells,
      { scale: 0.6, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.3, stagger: 0.012, ease: 'back.out(1.2)' }
    );
  }, [month, loading, days]);

  return (
    <Card data-testid="calendar-heat-map" sx={createLobbyPanelSx(lobbyPalette.blue)}>
      <CardContent sx={{ p: 3, position: 'relative', zIndex: 1 }}>
        {/* Header with navigation */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2.5}>
          <Box display="flex" alignItems="center" gap={1}>
            <CalendarTodayIcon sx={{ color: '#60A5FA', fontSize: 20 }} />
            <Typography variant="h6" fontWeight={600} fontSize={16}>
              Activity
            </Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={0.5}>
            <IconButton onClick={prevMonth} size="small" sx={{ color: '#8B8FA3', '&:hover': { color: '#fff' } }}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Typography sx={{ color: '#fff', fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>
              {getMonthLabel(month)}
            </Typography>
            <IconButton
              onClick={nextMonth}
              size="small"
              disabled={isCurrentMonth}
              sx={{ color: isCurrentMonth ? '#333' : '#8B8FA3', '&:hover': { color: '#fff' } }}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {error && (
          <Typography color="error" variant="body2" data-testid="calendar-error">
            {error}
          </Typography>
        )}

        {loading ? (
          <Box data-testid="calendar-loading">
            <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
          </Box>
        ) : (
          <Box ref={gridRef} data-testid="calendar-grid">
            {/* Weekday headers */}
            <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" gap="4px" mb={1}>
              {WEEKDAY_LABELS.map((day) => (
                <Typography key={day} sx={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#555972', letterSpacing: 0.4 }}>
                  {day}
                </Typography>
              ))}
            </Box>

            {/* Calendar grid — proper month alignment */}
            <Box display="flex" flexDirection="column" gap="4px">
              {grid.map((week, wi) => (
                <Box key={wi} display="grid" gridTemplateColumns="repeat(7, 1fr)" gap="4px">
                  {week.map((day, di) => {
                    if (!day) {
                      return <Box key={`empty-${wi}-${di}`} sx={{ aspectRatio: '1.6', minHeight: 40 }} />;
                    }
                    const dayNum = new Date(day.date + 'T00:00:00').getDate();
                    const today = isToday(day.date);
                    return (
                      <Tooltip
                        key={day.date}
                        title={`${formatDate(day.date)} — ${ACTIVITY_LABELS[day.activity] ?? 'No activity'}`}
                        arrow
                      >
                        <Box
                          data-testid={`calendar-cell-${day.date}`}
                          data-activity={day.activity}
                          data-cal-cell
                          sx={{
                            minHeight: 40,
                            borderRadius: 2,
                            backgroundColor: getActivityColor(day.activity),
                            border: '1px solid rgba(255,255,255,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'opacity 0.2s ease, transform 0.15s ease',
                            '&:hover': { opacity: 0.8, transform: 'scale(1.08)' },
                            ...(today && {
                              boxShadow: '0 0 0 2px #60A5FA',
                            }),
                          }}
                        >
                          <Typography
                            sx={{
                              color: getTextColor(day.activity),
                              fontWeight: today ? 800 : 600,
                              fontSize: 12,
                            }}
                          >
                            {dayNum}
                          </Typography>
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* Legend */}
        {!loading && (
          <Box display="flex" flexWrap="wrap" gap={2.5} mt={2.5} justifyContent="center" data-testid="calendar-legend">
            {Object.entries(ACTIVITY_LABELS).map(([activity, label]) => (
              <Box key={activity} display="flex" alignItems="center" gap={0.75}>
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: 0.75,
                    backgroundColor: ACTIVITY_COLORS[activity as ActivityType],
                  }}
                />
                <Typography variant="caption" sx={{ color: '#8B8FA3', fontSize: 11 }}>
                  {label}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default CalendarHeatMap;
export { ACTIVITY_COLORS, ACTIVITY_LABELS, getActivityColor, formatDate };
