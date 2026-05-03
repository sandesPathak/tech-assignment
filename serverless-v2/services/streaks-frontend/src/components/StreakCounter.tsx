import { useEffect, useRef } from 'react';
import { Card, CardContent, Box, Typography } from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import StyleIcon from '@mui/icons-material/Style';
import gsap from 'gsap';
import { createLobbyIconTileSx, createLobbyPanelSx, lobbyPalette } from '../styles/lobbyChrome';

export interface StreakCounterProps {
  type: 'login' | 'play';
  count: number;
  label: string;
  best?: number;
}

function getFlameScale(count: number): number {
  if (count > 30) return 2.0;
  if (count >= 15) return 1.6;
  if (count >= 8) return 1.3;
  return 1.0;
}

function getFlameColor(count: number): string {
  if (count > 30) return '#FF3D00';
  if (count >= 15) return '#FF6D00';
  if (count >= 8) return '#FF9100';
  return '#FF9800';
}

function StreakCounter({ type, count, label, best }: StreakCounterProps) {
  const isLogin = type === 'login';
  const iconBg = isLogin
    ? 'linear-gradient(180deg, rgba(255,107,53,0.12), rgba(255,68,68,0.06))'
    : 'linear-gradient(180deg, rgba(124,58,237,0.12), rgba(109,40,217,0.06))';
  const iconColor = isLogin ? getFlameColor(count) : '#A78BFA';
  const scale = isLogin ? getFlameScale(count) : 1.0;

  const cardRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);

  // Card entrance animation
  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(cardRef.current,
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', delay: type === 'login' ? 0 : 0.15 }
    );
  }, [type]);

  // Number counting animation
  useEffect(() => {
    if (!countRef.current) return;
    const obj = { val: prevCount.current };
    gsap.to(obj, {
      val: count,
      duration: 1.2,
      ease: 'power2.out',
      onUpdate: () => {
        if (countRef.current) {
          countRef.current.textContent = String(Math.round(obj.val));
        }
      },
    });

    // Punch scale on the icon when count increases
    if (count > prevCount.current && iconRef.current) {
      gsap.fromTo(iconRef.current,
        { scale: 1.4, rotation: -15 },
        { scale, rotation: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)' }
      );
    }

    prevCount.current = count;
  }, [count, scale]);

  const accent = isLogin ? '#FF6B35' : '#A78BFA';

  return (
    <Card
      ref={cardRef}
      data-testid={`streak-counter-${type}`}
      sx={{ ...createLobbyPanelSx(accent), opacity: 0 }}
    >
      <CardContent sx={{ p: 2.5, position: 'relative', zIndex: 1 }}>
        <Box display="flex" alignItems="center" gap={2.5}>
          <Box sx={createLobbyIconTileSx(accent, iconBg)}>
            <Box ref={iconRef} sx={{ display: 'flex', transform: `scale(${scale})`, filter: `drop-shadow(0 0 6px ${accent}80)` }}>
              {isLogin ? (
                <LocalFireDepartmentIcon
                  data-testid="flame-icon"
                  sx={{ fontSize: 32, color: iconColor }}
                />
              ) : (
                <StyleIcon data-testid="cards-icon" sx={{ fontSize: 32, color: iconColor }} />
              )}
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: lobbyPalette.textDim, fontWeight: 700, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase' }}>
              {label}
            </Typography>
            <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1.2, letterSpacing: -0.5 }}>
              <span ref={countRef}>0</span>{' '}
              <Typography component="span" sx={{ fontSize: 20, fontWeight: 700, color: lobbyPalette.textDim }}>
                days
              </Typography>
            </Typography>
            {best !== undefined && (
              <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600, fontSize: 12 }}>
                Best: {best} days
              </Typography>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default StreakCounter;
export { getFlameScale, getFlameColor };
