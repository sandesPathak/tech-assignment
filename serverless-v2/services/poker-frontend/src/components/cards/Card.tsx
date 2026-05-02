import { Box, Typography } from '@mui/material';
import { parseCard, SUIT_SYMBOLS, SUIT_COLORS } from '../../types/poker.types';
import type { CardSuit } from '../../types/poker.types';

interface CardProps {
  card?: string;
  faceDown?: boolean;
  size?: 'small' | 'medium';
}

function Card({ card, faceDown, size = 'medium' }: CardProps) {
  const w = size === 'small' ? 36 : 52;
  const h = size === 'small' ? 50 : 72;
  const fontSize = size === 'small' ? 11 : 14;
  const suitSize = size === 'small' ? 14 : 18;

  if (!card && !faceDown) {
    return (
      <Box
        sx={{
          width: w,
          height: h,
          borderRadius: 1.5,
          border: '1px dashed #3a4a5a',
          bgcolor: 'transparent',
        }}
      />
    );
  }

  if (faceDown || !card) {
    return (
      <Box
        data-testid="card-back"
        sx={{
          width: w,
          height: h,
          borderRadius: 1.5,
          background: 'linear-gradient(135deg, #1a3a6a, #2a4a8a)',
          border: '2px solid #3a5a9a',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            width: w - 10,
            height: h - 10,
            borderRadius: 1,
            border: '1px solid #4a6aaa44',
            background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, #ffffff08 3px, #ffffff08 4px)',
          }}
        />
      </Box>
    );
  }

  const { rank, suit } = parseCard(card);
  const color = SUIT_COLORS[suit as CardSuit] || '#212121';
  const symbol = SUIT_SYMBOLS[suit as CardSuit] || '';

  return (
    <Box
      data-testid={`card-${card}`}
      sx={{
        width: w,
        height: h,
        borderRadius: 1.5,
        bgcolor: '#FFFFFF',
        border: '1px solid #ddd',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Typography sx={{ fontSize, fontWeight: 800, color, lineHeight: 1 }}>
        {rank}
      </Typography>
      <Typography sx={{ fontSize: suitSize, color, lineHeight: 1 }}>
        {symbol}
      </Typography>
    </Box>
  );
}

export default Card;
