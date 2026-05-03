import { useState, useEffect, useRef } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { keyframes } from '@mui/system';
import CardGroup from '../cards/CardGroup';
import PositionBadge from './PositionBadge';
import ActionBadge from './ActionBadge';
import type { Player, GameState } from '../../../types/poker.types';
import { SHOWDOWN_STEPS } from '../../../types/poker.types';

interface PlayerSeatProps {
  player: Player;
  game: GameState;
  timerProgress?: number;
  timeLeft?: number;
  isHero?: boolean;
  avatarSrc?: string | null;
}

const AVATAR_COLORS = ['#e53935', '#43A047', '#1E88E5', '#FB8C00', '#8E24AA', '#00ACC1'];

const pulse = keyframes`
  0% { box-shadow: 0 0 8px rgba(255,215,0,0.4); }
  50% { box-shadow: 0 0 20px rgba(255,215,0,0.8); }
  100% { box-shadow: 0 0 8px rgba(255,215,0,0.4); }
`;

const popIn = keyframes`
  0% { transform: scale(0.8); opacity: 0; }
  60% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const actionFlash = keyframes`
  0% { transform: scale(1); }
  30% { transform: scale(1.15); }
  100% { transform: scale(1); }
`;

const winnerPulse = keyframes`
  0% { transform: scale(1); box-shadow: 0 0 10px rgba(74,222,128,0.4); }
  25% { transform: scale(1.12); box-shadow: 0 0 30px rgba(74,222,128,0.8); }
  50% { transform: scale(1); box-shadow: 0 0 10px rgba(74,222,128,0.4); }
  75% { transform: scale(1.08); box-shadow: 0 0 25px rgba(255,215,0,0.6); }
  100% { transform: scale(1); box-shadow: 0 0 10px rgba(74,222,128,0.4); }
`;

const winningsFloat = keyframes`
  0% { transform: translateY(0) scale(0.5); opacity: 0; }
  20% { transform: translateY(-4px) scale(1.2); opacity: 1; }
  40% { transform: translateY(-8px) scale(1); opacity: 1; }
  100% { transform: translateY(-2px) scale(1); opacity: 1; }
`;

const chipRain = keyframes`
  0% { transform: translateY(-10px) rotate(0deg); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translateY(6px) rotate(360deg); opacity: 0; }
`;

const heroPulse = keyframes`
  0% { box-shadow: 0 0 12px rgba(255,179,0,0.3); }
  50% { box-shadow: 0 0 22px rgba(255,179,0,0.6); }
  100% { box-shadow: 0 0 12px rgba(255,179,0,0.3); }
`;

function getTimerColor(timeLeft: number): string {
  if (timeLeft > 10) return '#4ADE80';
  if (timeLeft > 5) return '#FBBF24';
  return '#EF5350';
}

function PlayerSeat({ player, game, timerProgress, timeLeft, isHero, avatarSrc }: PlayerSeatProps) {
  const isDealer = game.dealerSeat === player.seat;
  const isSB = game.smallBlindSeat === player.seat;
  const isBB = game.bigBlindSeat === player.seat;
  const isFolded = player.status === '11';
  const isAllIn = player.status === '12';
  const isShowdown = SHOWDOWN_STEPS.includes(game.stepName);
  const hasCards = player.cards && player.cards.length > 0;
  // Cards we received look like real ranks ("AH", "KS"). The gateway
  // replaces other players' cards with the placeholder "??" — that's our
  // signal that we don't actually hold the data and must always render
  // face-down regardless of what isShowdown says.
  const cardsAreRedacted = Array.isArray(player.cards)
    && player.cards.some((c) => typeof c === 'string' && c.startsWith('?'));
  const showCardsFaceUp = isShowdown && !isFolded && hasCards && !cardsAreRedacted;
  const isWinner = player.winnings > 0;
  const isActing = game.move === player.seat && player.status === '1' && game.stepName.includes('BETTING');
  const avatarColor = isHero ? '#FF6B35' : AVATAR_COLORS[(player.seat - 1) % AVATAR_COLORS.length];
  const cardsDealt = game.handStep >= 4;

  // Hero click-to-peek state. Cards stay face-down by default — the user
  // taps them (or any cardholder hot zone) to flip-reveal. Auto-resets
  // each new hand so the previous hand's reveal doesn't leak into the
  // new hole cards. Showdown forces face-up regardless of this flag.
  const [revealed, setRevealed] = useState(false);
  const lastGameNoRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isHero) return;
    if (lastGameNoRef.current !== game.gameNo) {
      lastGameNoRef.current = game.gameNo;
      setRevealed(false);
    }
  }, [game.gameNo, isHero]);
  const heroFaceUp = isHero && !cardsAreRedacted && (revealed || showCardsFaceUp);

  // Hero avatar is meaningfully larger so the user can spot themselves
  // at a glance without leaning on color alone.
  const baseSize = isHero ? 96 : 50;
  const avatarSize = isActing ? baseSize + 8 : baseSize;
  const timerColor = timeLeft !== undefined ? getTimerColor(timeLeft) : '#FFD700';

  return (
    <Box
      data-testid={`player-seat-${player.seat}`}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        opacity: isFolded ? 0.35 : 1,
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        transform: isActing ? 'scale(1.1)' : 'scale(1)',
        minWidth: 90,
        zIndex: isHero ? 15 : isActing ? 10 : isWinner ? 12 : 1,
      }}
    >
      {/* Name + badges */}
      <Box display="flex" alignItems="center" gap={0.5}>
        <Typography
          sx={{
            fontSize: isHero ? 14 : isActing ? 13 : 12,
            fontWeight: isHero ? 800 : 700,
            color: isAllIn ? '#FF9800' : isWinner ? '#4ADE80' : isActing ? '#FFD700' : isHero ? '#FF6B35' : '#fff',
            textShadow: isHero ? '0 0 8px rgba(255,107,53,0.45), 0 1px 3px rgba(0,0,0,0.8)' : '0 1px 3px rgba(0,0,0,0.8)',
            transition: 'all 0.3s ease',
          }}
        >
          {player.username}{isHero && <span style={{ color: '#8B8FA3', fontWeight: 600, fontSize: '0.85em' }}> (You)</span>}
        </Typography>
        {isDealer && <PositionBadge position="D" />}
        {isSB && <PositionBadge position="SB" />}
        {isBB && <PositionBadge position="BB" />}
      </Box>

      {/* Avatar + timer ring */}
      <Box sx={{ position: 'relative', width: avatarSize + 8, height: avatarSize + 8, transition: 'all 0.3s ease' }}>
        {/* Circular timer (only when acting) */}
        {isActing && timerProgress !== undefined && (
          <>
            <CircularProgress
              variant="determinate"
              value={100}
              size={avatarSize + 8}
              thickness={3}
              sx={{ position: 'absolute', top: 0, left: 0, color: '#1e2a3a' }}
            />
            <CircularProgress
              variant="determinate"
              value={timerProgress}
              size={avatarSize + 8}
              thickness={3}
              sx={{
                position: 'absolute', top: 0, left: 0,
                color: timerColor, transition: 'color 0.5s ease',
                '& .MuiCircularProgress-circle': { transition: 'stroke-dashoffset 0.9s linear' },
              }}
            />
          </>
        )}

        {/* Avatar circle */}
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            left: 4,
            width: avatarSize,
            height: avatarSize,
            borderRadius: '50%',
            border: `${isHero ? 4 : 3}px solid ${isWinner ? '#4ADE80' : isActing ? '#FFD700' : avatarColor}`,
            bgcolor: isHero ? '#1a1a2e' : '#141e2b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: isWinner
              ? `${winnerPulse} 1.5s ease-in-out infinite`
              : isActing
                ? `${pulse} 2s ease-in-out infinite`
                : isHero
                  ? `${heroPulse} 3s ease-in-out infinite`
                  : 'none',
            transition: 'all 0.3s ease',
          }}
        >
          {avatarSrc ? (
            <Box
              component="img"
              src={avatarSrc}
              alt=""
              sx={{
                width: '88%',
                height: '88%',
                borderRadius: '50%',
                objectFit: 'cover',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
          ) : (
            <Typography sx={{
              fontSize: isHero ? (isActing ? 38 : 34) : (isActing ? 22 : 18),
              fontWeight: 800,
              color: isWinner ? '#4ADE80' : isActing ? '#FFD700' : avatarColor,
              transition: 'all 0.3s ease',
            }}>
              {player.username.charAt(0).toUpperCase()}
            </Typography>
          )}
        </Box>

        {/* Timer seconds (bottom-right badge) */}
        {isActing && timeLeft !== undefined && (
          <Box
            sx={{
              position: 'absolute', bottom: -2, right: -2,
              bgcolor: timerColor, color: '#000', borderRadius: '50%',
              width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 800,
              boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
              transition: 'background-color 0.5s ease',
            }}
          >
            {timeLeft}
          </Box>
        )}

        {/* Chip rain on winner */}
        {isWinner && (
          <>
            {[...Array(6)].map((_, i) => (
              <Box
                key={i}
                sx={{
                  position: 'absolute',
                  top: -4,
                  left: `${15 + i * 12}%`,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: ['#FFD700', '#4ADE80', '#FF6B35', '#60A5FA', '#E040FB', '#FFAB00'][i],
                  border: '1px solid rgba(255,255,255,0.5)',
                  animation: `${chipRain} ${0.8 + i * 0.15}s ease-in ${i * 0.1}s infinite`,
                  pointerEvents: 'none',
                }}
              />
            ))}
          </>
        )}
      </Box>

      {/* Hole cards. For the hero we render a 3D flip wrapper so a tap
          flips between back-of-card (default) and the real two cards.
          The cards still render face-up at showdown automatically. */}
      {cardsDealt && hasCards && !isFolded && (
        <Box sx={{ animation: `${popIn} 0.4s ease-out` }}>
          {isHero ? (
            <Box
              onClick={() => setRevealed((v) => !v)}
              role="button"
              aria-label={heroFaceUp ? 'Hide your cards' : 'Tap to peek at your cards'}
              title={heroFaceUp ? 'Click to hide' : 'Click to reveal'}
              sx={{
                position: 'relative',
                display: 'inline-block',
                cursor: 'pointer',
                perspective: '600px',
                transition: 'transform 0.2s ease',
                '&:hover': { transform: 'translateY(-2px)' },
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  display: 'inline-block',
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.55s cubic-bezier(0.4, 0.1, 0.2, 1)',
                  transform: heroFaceUp ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
              >
                {/* Back face (default) */}
                <Box
                  sx={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                  }}
                >
                  <CardGroup cards={player.cards} faceDown size="small" />
                </Box>
                {/* Front face (flipped to face the user once revealed) */}
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <CardGroup cards={player.cards} faceDown={false} size="small" />
                </Box>
              </Box>
              {!heroFaceUp && (
                <Typography
                  sx={{
                    position: 'absolute',
                    bottom: -14,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 1,
                    color: '#FFD700',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                  }}
                >
                  TAP TO PEEK
                </Typography>
              )}
            </Box>
          ) : (
            <CardGroup
              cards={player.cards}
              faceDown={!showCardsFaceUp}
              size="small"
            />
          )}
        </Box>
      )}

      {/* Stack */}
      <Box sx={{
        bgcolor: isWinner ? 'rgba(74,222,128,0.15)' : 'rgba(0,0,0,0.6)',
        borderRadius: 1.5,
        px: 1.5,
        py: 0.25,
        border: isWinner ? '1px solid rgba(74,222,128,0.3)' : '1px solid transparent',
        transition: 'all 0.3s ease',
      }}>
        <Typography sx={{ fontSize: isHero ? 13 : 12, fontWeight: 700, color: isWinner ? '#4ADE80' : '#FFD700' }}>
          ${player.stack.toFixed(2)}
        </Typography>
      </Box>

      {/* Bet chips */}
      {player.bet > 0 && (
        <Box display="flex" alignItems="center" gap={0.5} sx={{ animation: `${actionFlash} 0.3s ease-out` }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#e53935', border: '1px solid #fff' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#90CAF9' }}>
            ${player.bet.toFixed(2)}
          </Typography>
        </Box>
      )}

      {/* Action badge */}
      {player.action && (
        <Box sx={{ animation: `${actionFlash} 0.3s ease-out` }}>
          <ActionBadge action={player.action} />
        </Box>
      )}

      {/* Showdown overlay — winnings + hand rank stacked as an absolute
          ribbon over the avatar/cards so they never push siblings down
          into the next seat's anchor. */}
      {(isWinner || (isShowdown && player.handRank && !isFolded)) && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.25,
            pointerEvents: 'none',
            zIndex: 25,
            animation: `${popIn} 0.5s ease-out`,
          }}
        >
          {isWinner && (
            <Box
              sx={{
                bgcolor: 'rgba(0,0,0,0.85)',
                border: '1.5px solid #4ADE80',
                borderRadius: 1.5,
                px: 1,
                py: 0.25,
                animation: `${winningsFloat} 0.6s ease-out forwards`,
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 900,
                  color: '#4ADE80',
                  textShadow: '0 0 8px rgba(74,222,128,0.7)',
                  letterSpacing: 0.3,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.1,
                }}
              >
                +${player.winnings.toFixed(2)}
              </Typography>
            </Box>
          )}
          {isShowdown && player.handRank && !isFolded && (
            <Box sx={{ bgcolor: 'rgba(0,0,0,0.85)', borderRadius: 1, px: 0.75, py: 0.1 }}>
              <Typography
                sx={{
                  fontSize: 9,
                  color: '#FBBF24',
                  fontWeight: 700,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.1,
                }}
              >
                {player.handRank}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

export default PlayerSeat;
