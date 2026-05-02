import { Box, Typography } from '@mui/material';
import CardGroup from '../cards/CardGroup';
import PositionBadge from './PositionBadge';
import ActionBadge from './ActionBadge';
import type { Player, GameState } from '../../types/poker.types';
import { SHOWDOWN_STEPS } from '../../types/poker.types';

interface PlayerSeatProps {
  player: Player;
  game: GameState;
}

const AVATAR_COLORS = ['#e53935', '#43A047', '#1E88E5', '#FB8C00', '#8E24AA', '#00ACC1'];

function PlayerSeat({ player, game }: PlayerSeatProps) {
  const isDealer = game.dealerSeat === player.seat;
  const isSB = game.smallBlindSeat === player.seat;
  const isBB = game.bigBlindSeat === player.seat;
  const isFolded = player.status === '11';
  const isAllIn = player.status === '12';
  const isShowdown = SHOWDOWN_STEPS.includes(game.stepName);
  const hasCards = player.cards && player.cards.length > 0;
  const showCardsFaceUp = isShowdown && !isFolded && hasCards;
  const isWinner = player.winnings > 0;
  const isActing = game.move === player.seat && player.status === '1' && game.stepName.includes('BETTING');
  const avatarColor = AVATAR_COLORS[(player.seat - 1) % AVATAR_COLORS.length];

  // Show cards after DEAL_CARDS step (step 4+)
  const cardsDealt = game.handStep >= 4;

  return (
    <Box
      data-testid={`player-seat-${player.seat}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        opacity: isFolded ? 0.35 : 1,
        transition: 'opacity 0.3s ease',
        minWidth: 110,
      }}
    >
      {/* Name + badges */}
      <Box display="flex" alignItems="center" gap={0.5}>
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 700,
            color: isAllIn ? '#FF9800' : isWinner ? '#4ADE80' : '#fff',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}
        >
          {player.username}
        </Typography>
        {isDealer && <PositionBadge position="D" />}
        {isSB && <PositionBadge position="SB" />}
        {isBB && <PositionBadge position="BB" />}
      </Box>

      {/* Avatar circle */}
      <Box
        sx={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          border: `3px solid ${isWinner ? '#4ADE80' : isActing ? '#FFD700' : avatarColor}`,
          bgcolor: '#141e2b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isWinner
            ? '0 0 20px rgba(74,222,128,0.6)'
            : isActing
              ? '0 0 16px rgba(255,215,0,0.5)'
              : '0 2px 12px rgba(0,0,0,0.5)',
          transition: 'all 0.3s ease',
        }}
      >
        <Typography sx={{ fontSize: 22, fontWeight: 800, color: avatarColor }}>
          {player.username.charAt(0).toUpperCase()}
        </Typography>
      </Box>

      {/* Hole cards */}
      {cardsDealt && hasCards && !isFolded && (
        <CardGroup
          cards={showCardsFaceUp ? player.cards : player.cards}
          faceDown={!showCardsFaceUp}
          size="small"
        />
      )}

      {/* Stack */}
      <Box
        sx={{
          bgcolor: 'rgba(0,0,0,0.6)',
          borderRadius: 1.5,
          px: 1.5,
          py: 0.25,
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#FFD700' }}>
          ${player.stack.toFixed(2)}
        </Typography>
      </Box>

      {/* Bet chips */}
      {player.bet > 0 && (
        <Box display="flex" alignItems="center" gap={0.5}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#e53935', border: '1px solid #fff' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#90CAF9' }}>
            ${player.bet.toFixed(2)}
          </Typography>
        </Box>
      )}

      {/* Action badge */}
      {player.action && <ActionBadge action={player.action} />}

      {/* Hand rank at showdown */}
      {isShowdown && player.handRank && !isFolded && (
        <Box sx={{ bgcolor: 'rgba(0,0,0,0.7)', borderRadius: 1, px: 1, py: 0.25 }}>
          <Typography sx={{ fontSize: 10, color: '#FBBF24', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>
            {player.handRank}
          </Typography>
        </Box>
      )}

      {/* Winnings */}
      {isWinner && (
        <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#4ADE80', textShadow: '0 0 8px rgba(74,222,128,0.5)' }}>
          +${player.winnings.toFixed(2)}
        </Typography>
      )}
    </Box>
  );
}

export default PlayerSeat;
