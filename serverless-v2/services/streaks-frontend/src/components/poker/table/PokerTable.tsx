import { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { keyframes } from '@mui/system';
import CardGroup from '../cards/CardGroup';
import PlayerSeat from '../player/PlayerSeat';
import ChipStack from '../chips/ChipStack';
import type { TableState } from '../../../types/poker.types';

interface PokerTableProps {
  tableState: TableState;
  timerProgress?: number;
  timeLeft?: number;
  heroPlayerId?: string | number | null;
  heroDisplayName?: string | null;
  /** Real seat number the local user is sitting at. Used for visual rotation. */
  heroSeat?: number | null;
  /** Stable id used to deterministically pick the table's visual theme. */
  tableId?: string | null;
}

interface TableTheme {
  feltBg: string;
  feltShadow: string;
  border: string;
  outerShadow: string;
  /** Optional faded suit glyph rendered inside the felt. */
  suitGlyph?: string;
}

const TABLE_THEMES: TableTheme[] = [
  // A — Classic green felt · orange wooden rim (brand-orange variant)
  {
    feltBg: 'radial-gradient(ellipse at 40% 40%, #2d7a4a, #1b5c35, #134528)',
    feltShadow:
      '0 0 50px rgba(0,0,0,0.6), inset 0 0 30px rgba(0,0,0,0.3), inset 0 0 80px rgba(255,107,53,0.06)',
    border: '8px solid #6b3618',
    outerShadow:
      '0 0 0 12px #2a1407, 0 0 30px rgba(255,107,53,0.35), inset 0 2px 0 rgba(255,255,255,0.1)',
  },
  // B — Neon orange ring · deep blue-black felt
  {
    feltBg: 'radial-gradient(ellipse at 40% 40%, #1a2233, #0c1220, #060a14)',
    feltShadow: 'inset 0 0 80px rgba(0,0,0,0.7), inset 0 0 60px rgba(255,107,53,0.06)',
    border: '4px solid #FF6B35',
    outerShadow:
      '0 0 30px rgba(255,107,53,0.55), inset 0 0 20px rgba(255,107,53,0.25)',
  },
  // C — Warm amber/red felt (no green) · gold rim
  {
    feltBg: 'radial-gradient(ellipse at 40% 40%, #4a1f0d, #2a1208, #1a0b06)',
    feltShadow:
      '0 0 50px rgba(0,0,0,0.6), inset 0 0 60px rgba(0,0,0,0.5), inset 0 0 90px rgba(255,107,53,0.18)',
    border: '8px solid #8a5a18',
    outerShadow:
      '0 0 0 10px #2a1a08, 0 0 36px rgba(249,115,22,0.5), inset 0 2px 0 rgba(255,255,255,0.18)',
  },
  // D — Black felt · suit pattern · neon orange ring
  {
    feltBg: 'radial-gradient(ellipse at 40% 40%, #11151d, #06080d, #03050a)',
    feltShadow: 'inset 0 0 80px rgba(0,0,0,0.75), inset 0 0 60px rgba(255,107,53,0.08)',
    border: '3px solid #FF6B35',
    outerShadow:
      '0 0 30px rgba(255,107,53,0.55), inset 0 0 24px rgba(255,107,53,0.25), 0 0 0 6px rgba(255,107,53,0.18)',
    suitGlyph: '♠',
  },
];

function pickTheme(tableId: string | null | undefined): TableTheme {
  if (!tableId) return TABLE_THEMES[0];
  let h = 0;
  for (let i = 0; i < tableId.length; i += 1) h = (h * 31 + tableId.charCodeAt(i)) >>> 0;
  return TABLE_THEMES[h % TABLE_THEMES.length];
}

// 6 seats evenly spaced 60° apart on the felt ellipse, hero at bottom,
// then CLOCKWISE around the screen (= action proceeds D → SB → BB →
// ... in seat-number order matches visual order).
//
// Computed from felt center (350, 220) with rx=275, ry=165 minus an
// avatar-height offset of 40 so the avatar circle visually centres on
// each anchor point.
//
// index 0: S  (bottom-center)
// index 1: SW (lower-left)
// index 2: NW (upper-left)
// index 3: N  (top-center)
// index 4: NE (upper-right)
// index 5: SE (lower-right)
const ORDERED_POSITIONS = [
  { top: 345, left: 350 },  // 0: S  (hero, bottom-center)
  { top: 262, left: 112 },  // 1: SW
  { top:  97, left: 112 },  // 2: NW
  { top:  15, left: 350 },  // 3: N
  { top:  97, left: 588 },  // 4: NE
  { top: 262, left: 588 },  // 5: SE
];

const CANVAS_W = 700;
const CANVAS_H = 440;

const cardSlide = keyframes`
  0% { transform: translateY(-20px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
`;

const POT_CENTER = { top: CANVAS_H * 0.55, left: CANVAS_W * 0.5 };
const flyToPot = (fromTop: number, fromLeft: number) => keyframes`
  0% { transform: translate(${fromLeft - POT_CENTER.left}px, ${fromTop - POT_CENTER.top}px) scale(1); opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translate(0, 0) scale(0.7); opacity: 0; }
`;
const flyFromPot = (toTop: number, toLeft: number) => keyframes`
  0% { transform: translate(0, 0) scale(0.7); opacity: 0; }
  10% { opacity: 1; }
  100% { transform: translate(${toLeft - POT_CENTER.left}px, ${toTop - POT_CENTER.top}px) scale(1.1); opacity: 1; }
`;
const potPulse = keyframes`
  0%, 100% { transform: translateX(-50%) scale(1); }
  50% { transform: translateX(-50%) scale(1.08); }
`;

function PokerTable({ tableState, timerProgress, timeLeft, heroPlayerId, heroDisplayName, heroSeat: heroSeatProp, tableId }: PokerTableProps) {
  const { game, players } = tableState;
  const hasCards = game.communityCards && game.communityCards.length > 0;
  const theme = pickTheme(tableId ?? (game as { tableId?: string }).tableId ?? null);
  // Hero's chosen avatar (saved by PokerLobby's avatar picker).
  const heroAvatarId = typeof window !== 'undefined'
    ? (localStorage.getItem('hijack:avatarId') || '1')
    : '1';
  const avatarFor = (seat: number, isHero: boolean): string =>
    isHero ? `/avatars/${heroAvatarId}.svg` : `/avatars/${((seat - 1) % 24) + 1}.svg`;

  // Track per-seat bet deltas so we can fly chips from seat → pot on raises.
  const lastBetsRef = useRef<Record<number, number>>({});
  const [flyingBets, setFlyingBets] = useState<{ key: number; seat: number; amount: number }[]>([]);
  // Winner pot-to-seat fly state
  const lastWinnersKeyRef = useRef<string>('');
  const [flyingPot, setFlyingPot] = useState<{ key: number; seat: number; amount: number }[]>([]);

  useEffect(() => {
    const next: Record<number, number> = {};
    const newFlies: { key: number; seat: number; amount: number }[] = [];
    for (const p of players) {
      const seat = Number(p.seat);
      const bet = Number(p.bet) || 0;
      next[seat] = bet;
      const prev = lastBetsRef.current[seat] || 0;
      if (bet > prev) {
        newFlies.push({ key: Date.now() + seat, seat, amount: bet - prev });
      }
    }
    lastBetsRef.current = next;
    if (newFlies.length) {
      setFlyingBets((cur) => [...cur, ...newFlies]);
      newFlies.forEach((f) => {
        setTimeout(() => setFlyingBets((cur) => cur.filter((x) => x.key !== f.key)), 700);
      });
    }
  }, [players]);

  useEffect(() => {
    const winners = (game.winners || []).filter((w) => w && w.seat != null);
    if (!winners.length) return;
    const key = winners.map((w) => w.seat).join(',') + ':' + game.gameNo;
    if (lastWinnersKeyRef.current === key) return;
    lastWinnersKeyRef.current = key;
    const share = Math.max(0, Math.floor((Number(game.pot) || 0) / winners.length));
    const flies = winners.map((w, i) => ({ key: Date.now() + i, seat: Number(w.seat), amount: share }));
    setFlyingPot(flies);
    setTimeout(() => setFlyingPot([]), 900);
  }, [game.winners, game.gameNo, game.pot]);

  // Rotate so the local hero (real seat) sits bottom-center. We map
  // VISUAL POSITION → seat number (not array index) so empty seats are
  // correctly skipped on the felt rather than shifting everyone over.
  const maxSeats = Math.max(game.maxSeats || 6, 6);
  const heroSeat = heroSeatProp != null ? Number(heroSeatProp) : 1;
  const playerBySeat = new Map<number, typeof players[number]>();
  for (const p of players) playerBySeat.set(Number(p.seat), p);
  const orderedPlayers: (typeof players[number] | null)[] = [];
  for (let i = 0; i < ORDERED_POSITIONS.length; i += 1) {
    const seatNum = ((heroSeat - 1 + i) % maxSeats) + 1;
    orderedPlayers.push(playerBySeat.get(seatNum) || null);
  }

  return (
    <Box
      data-testid="poker-table"
      sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Box
        sx={{
          position: 'relative',
          width: CANVAS_W,
          height: CANVAS_H,
          flexShrink: 0,
          transform: {
            xs: 'scale(0.52)',
            sm: 'scale(0.7)',
            md: 'scale(0.82)',
            lg: 'scale(0.95)',
            xl: 'scale(1)',
          },
          transformOrigin: 'center center',
        }}
      >
        {/* Table felt */}
        <Box
          sx={{
            position: 'absolute',
            top: 55,
            left: 80,
            width: 540,
            height: 330,
            borderRadius: '50%',
            background: theme.feltBg,
            border: theme.border,
            boxShadow: `${theme.outerShadow}, ${theme.feltShadow}`,
            overflow: 'hidden',
          }}
        >
          {/* Optional faded suit glyphs (theme D) */}
          {theme.suitGlyph && (
            <>
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  left: '8%',
                  top: '14%',
                  fontSize: 160,
                  lineHeight: 1,
                  color: 'rgba(255,107,53,0.07)',
                  fontWeight: 900,
                  pointerEvents: 'none',
                  transform: 'rotate(-12deg)',
                }}
              >
                ♠
              </Box>
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  right: '8%',
                  bottom: '10%',
                  fontSize: 160,
                  lineHeight: 1,
                  color: 'rgba(255,107,53,0.06)',
                  fontWeight: 900,
                  pointerEvents: 'none',
                  transform: 'rotate(8deg)',
                }}
              >
                ♥
              </Box>
            </>
          )}
          {/* Community cards — animated */}
          <Box
            sx={{
              position: 'absolute',
              top: '42%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              gap: 0.5,
              animation: hasCards ? `${cardSlide} 0.5s ease-out` : 'none',
            }}
          >
            {hasCards ? (
              <CardGroup cards={game.communityCards} totalSlots={5} size="small" />
            ) : (
              <CardGroup cards={[]} totalSlots={5} size="small" />
            )}
          </Box>

          {/* Pot chip pile + label */}
          {game.pot > 0 && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            >
              <ChipStack amount={game.pot} size={16} spread />
            </Box>
          )}
          <Box
            data-testid="pot-display"
            sx={{
              position: 'absolute',
              top: '64%',
              left: '50%',
              transform: 'translateX(-50%)',
              bgcolor: 'rgba(0,0,0,0.6)',
              borderRadius: 1.5,
              px: 1.5,
              py: 0.3,
              animation: game.pot > 0 ? `${potPulse} 1.2s ease-in-out` : 'none',
            }}
            key={game.pot}
          >
            <Typography sx={{ color: '#FFD700', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
              {game.pot > 0 ? `POT: $${game.pot.toFixed(2)}` : `Blinds: $${game.smallBlind}/$${game.bigBlind}`}
            </Typography>
          </Box>
        </Box>

        {/* Player seats */}
        {orderedPlayers.map((player, idx) => {
          const pos = ORDERED_POSITIONS[idx];
          if (!pos || !player) return null;
          const isActing = game.move === player.seat && player.status === '1' && game.stepName.includes('BETTING');
          const isHero = player.seat === heroSeat;
          const displayPlayer = isHero && heroDisplayName
            ? { ...player, username: heroDisplayName }
            : player;
          return (
            <Box
              key={player.seat}
              sx={{
                position: 'absolute',
                top: pos.top,
                left: pos.left,
                transform: 'translate(-50%, 0)',
                zIndex: isHero ? 15 : isActing ? 10 : 2,
                transition: 'z-index 0s',
              }}
            >
              <PlayerSeat
                player={displayPlayer}
                game={game}
                timerProgress={isActing ? timerProgress : undefined}
                timeLeft={isActing ? timeLeft : undefined}
                isHero={isHero}
                avatarSrc={avatarFor(player.seat, isHero)}
              />
            </Box>
          );
        })}

        {/* Per-seat bet chip stacks — sit between the player and the pot */}
        {orderedPlayers.map((player, idx) => {
          const pos = ORDERED_POSITIONS[idx];
          if (!pos || !player) return null;
          const bet = Number(player.bet) || 0;
          if (bet <= 0) return null;
          // 35% of the way from seat → pot center
          const chipTop = pos.top + (POT_CENTER.top - pos.top) * 0.35;
          const chipLeft = pos.left + (POT_CENTER.left - pos.left) * 0.35;
          return (
            <Box
              key={`bet-${player.seat}`}
              sx={{
                position: 'absolute',
                top: chipTop,
                left: chipLeft,
                transform: 'translate(-50%, -50%)',
                zIndex: 8,
                pointerEvents: 'none',
              }}
            >
              <ChipStack amount={bet} size={14} />
            </Box>
          );
        })}

        {/* Flying chips: seat → pot on each bet/raise */}
        {flyingBets.map((fly) => {
          const idx = orderedPlayers.findIndex((p) => p && p.seat === fly.seat);
          const pos = idx >= 0 ? ORDERED_POSITIONS[idx] : null;
          if (!pos) return null;
          return (
            <Box
              key={`fly-${fly.key}`}
              sx={{
                position: 'absolute',
                top: POT_CENTER.top,
                left: POT_CENTER.left,
                transform: 'translate(-50%, -50%)',
                zIndex: 20,
                pointerEvents: 'none',
                animation: `${flyToPot(pos.top, pos.left)} 0.65s cubic-bezier(0.4, 0.1, 0.6, 1) forwards`,
              }}
            >
              <ChipStack amount={fly.amount} size={14} />
            </Box>
          );
        })}

        {/* Flying chips: pot → winner on hand end */}
        {flyingPot.map((fly) => {
          const idx = orderedPlayers.findIndex((p) => p && p.seat === fly.seat);
          const pos = idx >= 0 ? ORDERED_POSITIONS[idx] : null;
          if (!pos) return null;
          return (
            <Box
              key={`win-${fly.key}`}
              sx={{
                position: 'absolute',
                top: POT_CENTER.top,
                left: POT_CENTER.left,
                transform: 'translate(-50%, -50%)',
                zIndex: 22,
                pointerEvents: 'none',
                animation: `${flyFromPot(pos.top, pos.left)} 0.85s cubic-bezier(0.2, 0.7, 0.3, 1) forwards`,
              }}
            >
              <ChipStack amount={fly.amount} size={16} spread />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default PokerTable;
